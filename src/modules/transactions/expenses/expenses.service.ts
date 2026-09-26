import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasValidMoneyPrecision } from 'src/common/money/money';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from 'src/modules/accounts-snapshots/accounts-snapshots.service';
import { getPagination } from 'src/common/utils/pagination.util';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from 'src/modules/expense-categories/schemas/expense-category.schema';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { Expense, ExpenseDocument } from '../schemas/expense.schema';
import { TransactionOrigin } from '../schemas/transaction.schema';
import { activeTransactionFilter } from '../transactions/active-transaction.filter';
import { lockPersonalExpenseCategory } from '../../expense-categories/expense-category-lock';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategoryDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionsService: TransactionsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    userId: string,
    createExpenseDto: CreateExpenseDto,
    session?: ClientSession,
    origin?: TransactionOrigin,
  ) {
    if (session)
      return this._doCreate(userId, createExpenseDto, session, origin);
    const s = await this.connection.startSession();
    try {
      return await s.withTransaction(() =>
        this._doCreate(userId, createExpenseDto, s, origin),
      );
    } finally {
      await s.endSession();
    }
  }

  private async _doCreate(
    userId: string,
    dto: CreateExpenseDto,
    session: ClientSession,
    origin?: TransactionOrigin,
  ) {
    const foundIds = await this.transactionsService.resolveActiveAccount(
      userId,
      dto.accountId,
      session,
    );
    if (!hasValidMoneyPrecision(dto.amount, foundIds.account.currency!))
      throw new BadRequestException('Amount exceeds currency precision.');
    await this.transactionsService.lockAccounts(
      userId,
      [foundIds.account._id.toString()],
      session,
    );
    const category = await this.ensureCategoryExists(
      userId,
      dto.categoryId,
      session,
    );
    const snapshot = await this.snapshotsService.findOrCreateByAccountId(
      userId,
      foundIds.account._id.toString(),
      dto.transactionDate,
      session,
    );
    if (!snapshot) throw new NotFoundException('Snapshot not found.');
    const [expense] = await this.expenseModel.create(
      [
        {
          ...personalBudget(foundIds.userId),
          createdBy: foundIds.userId,
          participantId: foundIds.userId,
          accountId: foundIds.account._id,
          snapshotId: snapshot._id,
          category,
          amount: dto.amount,
          currency: foundIds.account.currency,
          transactionDate: dto.transactionDate,
          description: dto.description,
          merchant: dto.merchant,
          items: dto.items ?? [],
          origin,
        },
      ],
      { session },
    );
    await this.snapshotsService.recalculateSnapshotsFromDate(
      userId,
      foundIds.account._id.toString(),
      { date: dto.transactionDate },
      { amount: -dto.amount },
      session,
    );
    return personalResponse(await expense.populate('category'));
  }

  // TODO Добавить сортировку в DTO
  async findAll(userId: string, query: ListExpensesQueryDto) {
    const foundIds = await this.transactionsService.ensureUserExists(userId);

    const { page, limit, skip } = getPagination(query);
    const filter = this.buildFilter(foundIds.userId, query);

    const [items, total] = await Promise.all([
      this.expenseModel
        .find(filter)
        .sort({ transactionDate: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate('category')
        .lean()
        .exec(),
      this.expenseModel.countDocuments(filter),
    ]);

    return {
      items: items.map(personalResponse),
      total,
      page,
      limit,
    };
  }

  async countByFilters(
    userId: string,
    query: Omit<ListExpensesQueryDto, keyof PaginationQueryDto>,
  ) {
    const filter = this.buildFilter(new Types.ObjectId(userId), query);
    return this.expenseModel.countDocuments(filter);
  }

  async countHistoryByFilters(
    userId: string,
    query: Omit<ListExpensesQueryDto, keyof PaginationQueryDto>,
    session?: ClientSession,
  ) {
    const filter = this.buildFilter(new Types.ObjectId(userId), query);
    const { deletedAt: _deletedAt, ...historyFilter } = filter;
    const countQuery = this.expenseModel.countDocuments(historyFilter);
    return session && typeof countQuery.session === 'function'
      ? countQuery.session(session)
      : countQuery;
  }

  async findOne(userId: string, expenseId: string, session?: ClientSession) {
    const foundIds = await this.transactionsService.ensureUserExists(
      userId,
      session,
    );
    const foundExpense = await this.expenseModel
      .findOne({
        _id: expenseId,
        ...personalBudget(foundIds.userId),
        ...activeTransactionFilter,
      })
      .populate('category')
      .session(session ?? null)
      .lean();

    if (!foundExpense) {
      throw new NotFoundException(
        `Expense ${expenseId} for user ${userId} not found.`,
      );
    }

    return personalResponse(foundExpense);
  }

  async findRevenue(userId: string, query: ListExpensesQueryDto) {
    return this.transactionsService.findRevenue(
      userId,
      query,
      this.expenseModel,
    );
  }

  async update(
    userId: string,
    expenseId: string,
    updateExpenseDto: UpdateExpenseDto,
  ) {
    const s = await this.connection.startSession();
    try {
      return await s.withTransaction(async () => {
        const expense = await this.findOne(userId, expenseId, s);

        if (!expense) {
          throw new NotFoundException(`Expense ${expenseId} not found.`);
        }
        if (
          updateExpenseDto.amount !== undefined &&
          (!expense.currency ||
            !hasValidMoneyPrecision(updateExpenseDto.amount, expense.currency))
        )
          throw new BadRequestException('Amount exceeds currency precision.');

        const foundCategoryId = updateExpenseDto.categoryId
          ? await this.ensureCategoryExists(
              userId,
              updateExpenseDto.categoryId,
              s,
            )
          : undefined;
        const updatePayload = Object.fromEntries(
          Object.entries({
            amount: updateExpenseDto.amount,
            description: updateExpenseDto.description,
            merchant: updateExpenseDto.merchant,
            items: updateExpenseDto.items,
            category: foundCategoryId,
          }).filter(([, value]) => value !== undefined),
        );

        await this.transactionsService.lockAccounts(
          userId,
          [expense.accountId.toString()],
          s,
        );
        if (updateExpenseDto.amount !== undefined) {
          const diffAmount = expense.amount - updateExpenseDto.amount;
          await this.snapshotsService.recalculateSnapshotsFromDate(
            userId,
            expense.accountId.toString(),
            { date: expense.transactionDate.toISOString() },
            { amount: diffAmount },
            s,
          );
        }

        // TODO Проверить с пустыми значениями для удаления
        const updatedExpense = await this.expenseModel
          .findOneAndUpdate(
            {
              _id: expenseId,
              ...personalBudget(new Types.ObjectId(userId)),
              ...activeTransactionFilter,
            },
            { $set: updatePayload },
            {
              returnDocument: 'after',
              runValidators: true,
              session: s,
            },
          )
          .populate('category')
          .lean();

        if (!updatedExpense) {
          throw new NotFoundException(
            `Expense ${expenseId} for user ${userId} not found.`,
          );
        }

        return personalResponse(updatedExpense);
      });
    } finally {
      await s.endSession();
    }
  }

  private buildFilter(
    userId: Types.ObjectId,
    query: Partial<ListExpensesQueryDto>,
  ) {
    const filter: { category?: Types.ObjectId; currency?: string } = {};

    if (query.categoryId) {
      filter.category = new Types.ObjectId(query.categoryId);
    }
    if (query.currency) filter.currency = query.currency;

    return {
      ...this.transactionsService.buildFilter(userId, query),
      ...filter,
    };
  }

  private async ensureCategoryExists(
    userId: string,
    categoryId: string,
    session: ClientSession,
  ) {
    const category = await lockPersonalExpenseCategory(
      this.expenseCategoryModel,
      userId,
      categoryId,
      session,
    );
    return category._id;
  }
}
