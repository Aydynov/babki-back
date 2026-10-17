import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { hasValidMoneyPrecision, normalizeMoney } from 'src/common/money/money';
import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import { getPagination } from '../../common/utils/pagination.util';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from '../expense-categories/schemas/expense-category.schema';
import { lockBudgetExpenseCategory } from '../expense-categories/expense-category-lock';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ClosePlanDto } from './dto/close-plan.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { Plan, PlanDocument } from './schemas/plan.schema';

type PlanQuery = ListPlansQueryDto & { includeArchived?: boolean };
type ClosePlanCommand = ClosePlanDto & { participantId?: string };

@Injectable()
export class PlansService {
  constructor(
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategoryDocument>,
    private readonly expensesService: ExpensesService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(userId: string, dto: CreatePlanDto) {
    this.validateAmount(personalBudget(userId), dto.amount, dto.currency);
    return this.runPersonal(userId, (budget, session) =>
      this.createForBudget(budget, userId, dto, session),
    );
  }

  async createForBudget(
    budget: BudgetContext,
    actorId: string,
    dto: CreatePlanDto,
    session: ClientSession,
  ) {
    this.validateAmount(budget, dto.amount, dto.currency);
    await lockBudgetExpenseCategory(
      this.expenseCategoryModel,
      budget,
      dto.categoryId,
      session,
    );
    const [plan] = await this.planModel.create(
      [
        {
          ...dto,
          ...budgetFilter(budget),
          createdBy: new Types.ObjectId(actorId),
        },
      ],
      { session },
    );
    return plan.toObject();
  }

  async findAll(userId: string, query: ListPlansQueryDto) {
    await this.ensureUserExists(userId);
    const result = await this.listForBudget(personalBudget(userId), query);
    return { ...result, items: result.items.map(personalResponse) };
  }

  async listForBudget(budget: BudgetContext, query: PlanQuery) {
    const { page, limit, skip } = getPagination(query);
    const filter = {
      ...budgetFilter(budget),
      ...(budget.ownerType === 'user' || !query.includeArchived
        ? { archivedAt: null }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
    };
    const [items, total] = await Promise.all([
      this.planModel
        .find(filter)
        .sort(
          budget.ownerType === 'user'
            ? { targetDate: 1, createdAt: -1 }
            : { targetDate: 1, createdAt: -1, _id: -1 },
        )
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.planModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  async findOne(userId: string, planId: string) {
    await this.ensureUserExists(userId);
    return personalResponse(
      await this.getForBudget(personalBudget(userId), planId),
    );
  }

  getForBudget(budget: BudgetContext, planId: string, session?: ClientSession) {
    return this.requirePlan(
      budget,
      planId,
      session,
      budget.ownerType === 'user',
    );
  }

  update(userId: string, planId: string, dto: UpdatePlanDto) {
    return this.runPersonal(userId, (budget, session) =>
      this.updateForBudget(budget, planId, dto, session),
    );
  }

  async updateForBudget(
    budget: BudgetContext,
    planId: string,
    dto: UpdatePlanDto,
    session: ClientSession,
  ) {
    // Personal archived PATCH historically returns null after validating the stored state.
    const current = await this.requirePlan(
      budget,
      planId,
      session,
      budget.ownerType === 'group',
    );
    if (current.status === 'closed')
      throw new BadRequestException('Cannot update a closed plan.');
    if (dto.amount !== undefined)
      this.validateAmount(budget, dto.amount, current.currency);
    if (dto.categoryId)
      await lockBudgetExpenseCategory(
        this.expenseCategoryModel,
        budget,
        dto.categoryId,
        session,
      );
    const payload = Object.fromEntries(
      Object.entries({
        description: dto.description,
        targetDate: dto.targetDate,
        amount: dto.amount,
        categoryId: dto.categoryId,
      }).filter(([, value]) => value !== undefined),
    );
    return this.planModel
      .findOneAndUpdate(
        { _id: planId, ...budgetFilter(budget), archivedAt: null },
        payload,
        { returnDocument: 'after', runValidators: true, session },
      )
      .lean()
      .exec();
  }

  remove(userId: string, planId: string) {
    return this.runPersonal(userId, (budget, session) =>
      this.removeForBudget(budget, planId, session),
    );
  }

  async removeForBudget(
    budget: BudgetContext,
    planId: string,
    session: ClientSession,
  ) {
    const plan = await this.requirePlan(budget, planId, session);
    if (plan.status !== 'active' || plan.expenseId || plan.archivedAt)
      throw new ConflictException(
        'Cannot delete a plan with financial history; archive it instead.',
      );
    const deleted = await this.planModel
      .findOneAndDelete(
        {
          _id: planId,
          ...budgetFilter(budget),
          status: 'active',
          archivedAt: null,
          expenseId: { $exists: false },
        },
        { session },
      )
      .exec();
    if (!deleted)
      throw new ConflictException('Plan state changed; retry the request.');
  }

  archive(userId: string, planId: string) {
    return this.runPersonal(userId, (budget, session) =>
      this.archiveForBudget(budget, planId, session),
    );
  }

  async archiveForBudget(
    budget: BudgetContext,
    planId: string,
    session: ClientSession,
  ) {
    const archived = await this.planModel.findOneAndUpdate(
      { _id: planId, ...budgetFilter(budget), archivedAt: null },
      { $set: { archivedAt: new Date() } },
      { returnDocument: 'after', session },
    );
    if (!archived) throw this.notFound(budget, planId);
  }

  async close(userId: string, planId: string, dto: ClosePlanDto) {
    await this.ensureUserExists(userId);
    const budget = personalBudget(userId);
    // Keep the personal pre-transaction state check and its concurrent-close errors.
    const plan = await this.requirePlan(budget, planId, undefined, true);
    this.validateClose(budget, plan, dto);
    const session = await this.connection.startSession();
    try {
      return personalResponse(
        await session.withTransaction(() =>
          this.executeClose(budget, userId, planId, plan, dto, session),
        ),
      );
    } finally {
      await session.endSession();
    }
  }

  async closeForBudget(
    budget: BudgetContext,
    actorId: string,
    planId: string,
    dto: ClosePlanCommand,
    session: ClientSession,
  ) {
    const plan = await this.requirePlan(budget, planId, session, true);
    this.validateClose(budget, plan, dto);
    return this.executeClose(budget, actorId, planId, plan, dto, session);
  }

  private validateClose(
    budget: BudgetContext,
    plan: Plan,
    dto: ClosePlanCommand,
  ) {
    if (plan.status === 'closed')
      throw new BadRequestException('Plan is already closed.');
    this.validateAmount(budget, dto.amount ?? plan.amount, plan.currency);
  }

  private async executeClose(
    budget: BudgetContext,
    actorId: string,
    planId: string,
    plan: Plan,
    dto: ClosePlanCommand,
    session: ClientSession,
  ) {
    const expense = await this.expensesService.createForBudget(
      budget,
      actorId,
      {
        accountId: dto.accountId,
        categoryId: plan.categoryId.toString(),
        amount: dto.amount ?? plan.amount,
        transactionDate: dto.closingDate ?? new Date().toISOString(),
        description: dto.description ?? plan.description,
        ...(dto.participantId ? { participantId: dto.participantId } : {}),
      },
      session,
      { type: 'plan', id: new Types.ObjectId(planId) },
    );
    if (expense.currency !== plan.currency)
      throw new BadRequestException('Plan and account currencies must match.');
    const closed = await this.planModel
      .findOneAndUpdate(
        {
          _id: planId,
          ...budgetFilter(budget),
          status: 'active',
          archivedAt: null,
        },
        { status: 'closed', closedAt: new Date(), expenseId: expense._id },
        { returnDocument: 'after', runValidators: true, session },
      )
      .lean()
      .exec();
    if (!closed) throw new BadRequestException('Plan is already closed.');
    return closed;
  }

  private validateAmount(
    budget: BudgetContext,
    amount: number,
    currency: string,
  ) {
    if (!hasValidMoneyPrecision(amount, currency))
      throw new BadRequestException('Amount exceeds currency precision.');
    if (budget.ownerType === 'group' && normalizeMoney(amount, currency) <= 0)
      throw new BadRequestException('Amount must be positive.');
  }

  private async requirePlan(
    budget: BudgetContext,
    planId: string,
    session?: ClientSession,
    activeOnly = false,
  ) {
    const query = this.planModel.findOne({
      _id: planId,
      ...budgetFilter(budget),
      ...(activeOnly ? { archivedAt: null } : {}),
    });
    if (session && typeof query.session === 'function') query.session(session);
    const plan = await query.lean().exec();
    if (!plan) throw this.notFound(budget, planId);
    return plan;
  }

  private notFound(budget: BudgetContext, planId: string) {
    return new NotFoundException(
      budget.ownerType === 'user'
        ? `Plan ${planId} for user ${budget.ownerId.toString()} not found.`
        : 'Plan not found',
    );
  }

  private async runPersonal<T>(
    userId: string,
    work: (budget: BudgetContext, session: ClientSession) => Promise<T>,
  ) {
    const session = await this.connection.startSession();
    try {
      return personalResponse(
        await session.withTransaction(async () => {
          await this.ensureUserExists(userId, session);
          return work(personalBudget(userId), session);
        }),
      );
    } finally {
      await session.endSession();
    }
  }

  private async ensureUserExists(userId: string, session?: ClientSession) {
    const query = this.userModel.exists({ _id: userId });
    const found =
      session && typeof query.session === 'function'
        ? await query.session(session)
        : await query;
    if (!found) throw new NotFoundException(`User ${userId} not found.`);
    return found._id;
  }
}
