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
import { lockBudgetExpenseCategory } from '../expense-categories/expense-category-lock';
import { ExpenseCategory } from '../expense-categories/schemas/expense-category.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { ExpenseLimit } from './schemas/expense-limit.schema';
type LimitCreate = {
  categoryId: string;
  total: number;
  currency: string;
  startDate?: string;
  endDate?: string;
};
type LimitUpdate = {
  total?: number;
  startDate?: string;
  endDate?: string;
};
type LimitChanges = {
  total?: number;
  startDate?: string | Date;
  endDate?: string | Date;
};
type LimitQuery = {
  categoryId?: string;
  periodDate?: string;
  currency?: string;
};
type LimitRow = ExpenseLimit & {
  _id: Types.ObjectId;
};
function utcDay(value: string | Date, end = false) {
  const date = new Date(value);
  date.setUTCHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return date;
}
@Injectable()
export class ExpenseLimitsService {
  constructor(
    @InjectModel(ExpenseLimit.name)
    private readonly expenseLimitModel: Model<ExpenseLimit>,
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategory>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<Transaction>,
  ) {}
  async createForBudget(
    budget: BudgetContext,
    dto: LimitCreate,
    session: ClientSession,
  ) {
    this.validatePrecision(dto.total, dto.currency);
    const category = await lockBudgetExpenseCategory(
      this.expenseCategoryModel,
      budget,
      dto.categoryId,
      session,
    );
    const { startDate, endDate } = this.period(budget, dto);
    await this.checkOverlap(
      budget,
      category._id,
      startDate,
      endDate,
      dto.currency,
      undefined,
      session,
    );
    const [created] = await this.expenseLimitModel.create(
      [
        {
          ...budgetFilter(budget),
          category: category._id,
          startDate,
          endDate,
          total: dto.total,
          currency: dto.currency,
        },
      ],
      { session },
    );
    const row = created;
    return this.buildResponse(budget, row.toObject(), session);
  }
  async findAllForBudget(budget: BudgetContext, query: LimitQuery) {
    const filter = {
      ...budgetFilter(budget),
      ...(query.categoryId
        ? { category: new Types.ObjectId(query.categoryId) }
        : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.periodDate
        ? {
            startDate: { $lte: new Date(query.periodDate) },
            endDate: { $gte: new Date(query.periodDate) },
          }
        : {}),
    };
    const lookup = this.expenseLimitModel.find(filter).sort({ startDate: -1 });
    const rows = await lookup.lean().exec();
    return Promise.all(rows.map((row) => this.buildResponse(budget, row)));
  }
  async findOneForBudget(budget: BudgetContext, limitId: string) {
    return this.buildResponse(
      budget,
      await this.limit(budget, limitId, undefined, true),
    );
  }
  async updateForBudget(
    budget: BudgetContext,
    limitId: string,
    dto: LimitUpdate,
    session?: ClientSession,
  ) {
    const old = await this.limit(budget, limitId, session);
    if (dto.total !== undefined)
      this.validatePrecision(dto.total, old.currency!);
    let data: LimitChanges = dto;
    {
      if (!session) throw new Error('Space limit writes require a session');
      const category = await lockBudgetExpenseCategory(
        this.expenseCategoryModel,
        budget,
        old.category.toString(),
        session,
        { allowArchived: true },
      );
      const { startDate, endDate } = this.period(budget, dto, old);
      await this.checkOverlap(
        budget,
        category._id,
        startDate,
        endDate,
        old.currency,
        limitId,
        session,
      );
      data = { total: dto.total ?? old.total, startDate, endDate };
    }
    const lookup = this.expenseLimitModel.findOneAndUpdate(
      { _id: limitId, ...budgetFilter(budget) },
      { $set: data },
      { returnDocument: 'after', runValidators: true, session },
    );
    const limit = await lookup.lean().exec();
    if (!limit) throw this.notFound(budget, limitId);
    return this.buildResponse(budget, limit, session);
  }
  async removeForBudget(
    budget: BudgetContext,
    limitId: string,
    session?: ClientSession,
  ) {
    await this.limit(budget, limitId, session);
    const result = await this.expenseLimitModel
      .deleteOne({ _id: limitId, ...budgetFilter(budget) }, { session })
      .exec();
    if (!result.deletedCount) throw new NotFoundException('Limit not found');
  }
  /** Shared active expense usage within the limit's currency bucket. */
  async findExpenseUsage(
    budget: BudgetContext,
    categoryId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    currency?: string,
    session?: ClientSession,
  ) {
    const sums = await this.transactionModel
      .aggregate<{
        total: number;
      }>([
        {
          $match: {
            ...budgetFilter(budget),
            type: 'expense',
            deletedAt: null,
            category: categoryId,
            transactionDate: { $gte: startDate, $lte: endDate },
            currency,
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .session(session ?? null);
    const total = sums[0]?.total ?? 0;
    return normalizeMoney(total, currency!);
  }
  private async limit(
    budget: BudgetContext,
    limitId: string,
    session?: ClientSession,
    _populate = false,
  ) {
    const lookup = this.expenseLimitModel
      .findOne({ _id: limitId, ...budgetFilter(budget) })
      .session(session ?? null);
    const limit = await lookup.lean().exec();
    if (!limit) throw this.notFound(budget, limitId);
    return limit;
  }
  private period(
    budget: BudgetContext,
    dto: Pick<LimitCreate, 'startDate' | 'endDate'>,
    old?: LimitRow,
  ) {
    const now = new Date();
    const startDate = utcDay(
      dto.startDate ??
        old?.startDate ??
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    );
    const endDate = utcDay(
      dto.endDate ??
        old?.endDate ??
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
      true,
    );
    if (startDate > endDate)
      throw new BadRequestException('Invalid limit period');
    return { startDate, endDate };
  }
  private async checkOverlap(
    budget: BudgetContext,
    category: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    currency?: string,
    id?: string,
    session?: ClientSession,
  ) {
    const overlapping = await this.expenseLimitModel
      .exists({
        ...budgetFilter(budget),
        category,
        startDate: { $lte: endDate },
        endDate: { $gte: startDate },
        currency,
        ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}),
      })
      .session(session ?? null);
    if (overlapping) throw new ConflictException('Limit period overlaps');
  }
  private validatePrecision(total: number, currency: string) {
    if (!hasValidMoneyPrecision(total, currency))
      throw new BadRequestException('Amount exceeds currency precision.');
  }
  private notFound(_budget: BudgetContext, _limitId: string) {
    return new NotFoundException('Limit not found');
  }
  private async buildResponse(
    budget: BudgetContext,
    limit: LimitRow,
    session?: ClientSession,
  ) {
    const usage = await this.findExpenseUsage(
      budget,
      limit.category._id,
      limit.startDate,
      limit.endDate,
      limit.currency,
      session,
    );
    return {
      ...limit,
      rest: normalizeMoney(limit.total - usage, limit.currency!),
    };
  }
}
