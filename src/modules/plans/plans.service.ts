import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { hasValidMoneyPrecision, normalizeMoney } from 'src/common/money/money';
import { getPagination } from '../../common/utils/pagination.util';
import { lockBudgetExpenseCategory } from '../expense-categories/expense-category-lock';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from '../expense-categories/schemas/expense-category.schema';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { ClosePlanDto } from './dto/close-plan.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { Plan, PlanDocument } from './schemas/plan.schema';
type PlanQuery = ListPlansQueryDto & {
  includeArchived?: boolean;
};
type ClosePlanCommand = ClosePlanDto & {
  participantId?: string;
};
@Injectable()
export class PlansService {
  constructor(
    @InjectModel(Plan.name)
    private readonly planModel: Model<PlanDocument>,
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategoryDocument>,
    private readonly expensesService: ExpensesService,
  ) {}
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
  async listForBudget(budget: BudgetContext, query: PlanQuery) {
    const { page, limit, skip } = getPagination(query);
    const filter = {
      ...budgetFilter(budget),
      ...(!query.includeArchived ? { archivedAt: null } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
    };
    const [items, total] = await Promise.all([
      this.planModel
        .find(filter)
        .sort({ targetDate: 1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.planModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
  getForBudget(budget: BudgetContext, planId: string, session?: ClientSession) {
    return this.requirePlan(budget, planId, session, false);
  }
  async updateForBudget(
    budget: BudgetContext,
    planId: string,
    dto: UpdatePlanDto,
    session: ClientSession,
  ) {
    // Personal archived PATCH historically returns null after validating the stored state.
    const current = await this.requirePlan(budget, planId, session, true);
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
    if (normalizeMoney(amount, currency) <= 0)
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
  private notFound(_budget: BudgetContext, _planId: string) {
    return new NotFoundException('Plan not found');
  }
}
