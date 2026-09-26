import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasValidMoneyPrecision } from 'src/common/money/money';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import { getPagination } from '../../common/utils/pagination.util';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from '../expense-categories/schemas/expense-category.schema';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ClosePlanDto } from './dto/close-plan.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { Plan, PlanDocument, PlanStatus } from './schemas/plan.schema';
import { lockPersonalExpenseCategory } from '../expense-categories/expense-category-lock';

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

  async create(userId: string, createPlanDto: CreatePlanDto) {
    if (!hasValidMoneyPrecision(createPlanDto.amount, createPlanDto.currency))
      throw new BadRequestException('Amount exceeds currency precision.');
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const foundUserId = await this.ensureUserExists(userId, session);
        await lockPersonalExpenseCategory(
          this.expenseCategoryModel,
          userId,
          createPlanDto.categoryId,
          session,
        );
        const [plan] = await this.planModel.create(
          [{ userId: foundUserId, ...createPlanDto }],
          { session },
        );
        return plan.toObject();
      });
    } finally {
      await session.endSession();
    }
  }

  async findAll(
    userId: string,
    query: ListPlansQueryDto,
  ): Promise<PaginatedResponse<Plan>> {
    const foundUserId = await this.ensureUserExists(userId);
    const { page, limit, skip } = getPagination(query);

    const filter: {
      userId: Types.ObjectId;
      archivedAt: null;
      status?: PlanStatus;
      currency?: string;
    } = {
      userId: foundUserId,
      archivedAt: null,
    };
    if (query.status) {
      filter.status = query.status;
    }
    if (query.currency) filter.currency = query.currency;

    const [items, total] = await Promise.all([
      this.planModel
        .find(filter)
        .sort({ targetDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.planModel.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }

  async findOne(userId: string, planId: string) {
    const foundUserId = await this.ensureUserExists(userId);

    const plan = await this.planModel
      .findOne({ _id: planId, userId: foundUserId, archivedAt: null })
      .lean()
      .exec();

    if (!plan) {
      throw new NotFoundException(
        `Plan ${planId} for user ${userId} not found.`,
      );
    }

    return plan;
  }

  async update(userId: string, planId: string, updatePlanDto: UpdatePlanDto) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const foundUserId = await this.ensureUserExists(userId, session);
        const currentPlanQuery = this.planModel.findOne({
          _id: planId,
          userId: foundUserId,
        });
        if (typeof currentPlanQuery.session === 'function') {
          currentPlanQuery.session(session);
        }
        const currentPlan = await currentPlanQuery.lean().exec();

        if (!currentPlan) {
          throw new NotFoundException(
            `Plan ${planId} for user ${userId} not found.`,
          );
        }
        if (currentPlan.status === 'closed') {
          throw new BadRequestException('Cannot update a closed plan.');
        }
        if (
          updatePlanDto.amount !== undefined &&
          !hasValidMoneyPrecision(updatePlanDto.amount, currentPlan.currency)
        )
          throw new BadRequestException('Amount exceeds currency precision.');
        if (updatePlanDto.categoryId) {
          await lockPersonalExpenseCategory(
            this.expenseCategoryModel,
            userId,
            updatePlanDto.categoryId,
            session,
          );
        }
        const updatePayload = Object.fromEntries(
          Object.entries({
            description: updatePlanDto.description,
            targetDate: updatePlanDto.targetDate,
            amount: updatePlanDto.amount,
            categoryId: updatePlanDto.categoryId,
          }).filter(([, value]) => value !== undefined),
        );
        return this.planModel
          .findOneAndUpdate(
            { _id: planId, userId: foundUserId, archivedAt: null },
            updatePayload,
            {
              returnDocument: 'after',
              runValidators: true,
              session,
            },
          )
          .lean()
          .exec();
      });
    } finally {
      await session.endSession();
    }
  }

  async remove(userId: string, planId: string) {
    const foundUserId = await this.ensureUserExists(userId);
    const plan = await this.planModel
      .findOne({ _id: planId, userId: foundUserId })
      .lean()
      .exec();
    if (!plan) {
      throw new NotFoundException(
        `Plan ${planId} for user ${userId} not found.`,
      );
    }
    if (plan.status !== 'active' || plan.expenseId) {
      throw new ConflictException(
        'Cannot delete a plan with financial history; archive it instead.',
      );
    }
    const deleted = await this.planModel
      .findOneAndDelete({
        _id: planId,
        userId: foundUserId,
        status: 'active',
        archivedAt: null,
        expenseId: { $exists: false },
      })
      .exec();
    if (!deleted) {
      throw new ConflictException('Plan state changed; retry the request.');
    }
  }

  async archive(userId: string, planId: string) {
    const foundUserId = await this.ensureUserExists(userId);
    const archived = await this.planModel.findOneAndUpdate(
      { _id: planId, userId: foundUserId, archivedAt: null },
      { $set: { archivedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!archived) {
      throw new NotFoundException(
        `Plan ${planId} for user ${userId} not found.`,
      );
    }
  }

  async close(userId: string, planId: string, closePlanDto: ClosePlanDto) {
    const foundUserId = await this.ensureUserExists(userId);

    const plan = await this.planModel
      .findOne({ _id: planId, userId: foundUserId, archivedAt: null })
      .lean()
      .exec();

    if (!plan) {
      throw new NotFoundException(
        `Plan ${planId} for user ${userId} not found.`,
      );
    }

    if (plan.status === 'closed') {
      throw new BadRequestException('Plan is already closed.');
    }

    const transactionDate =
      closePlanDto.closingDate ?? new Date().toISOString();
    const amount = closePlanDto.amount ?? plan.amount;
    if (!hasValidMoneyPrecision(amount, plan.currency))
      throw new BadRequestException('Amount exceeds currency precision.');
    const description = closePlanDto.description ?? plan.description;

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const expense = await this.expensesService.create(
          userId,
          {
            accountId: closePlanDto.accountId,
            categoryId: plan.categoryId.toString(),
            amount,
            transactionDate,
            description,
          },
          session,
          { type: 'plan', id: new Types.ObjectId(planId) },
        );
        if (expense.currency !== plan.currency)
          throw new BadRequestException(
            'Plan and account currencies must match.',
          );

        const closedPlan = await this.planModel
          .findOneAndUpdate(
            {
              _id: planId,
              userId: foundUserId,
              status: 'active',
              archivedAt: null,
            },
            {
              status: 'closed',
              closedAt: new Date(),
              expenseId: expense._id,
            },
            { returnDocument: 'after', runValidators: true, session },
          )
          .lean()
          .exec();

        if (!closedPlan) {
          throw new BadRequestException('Plan is already closed.');
        }

        return closedPlan;
      });
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

    if (!found) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return found._id;
  }
}
