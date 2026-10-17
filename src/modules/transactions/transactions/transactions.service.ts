import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { getPagination } from 'src/common/utils/pagination.util';
import { hasValidMoneyPrecision, normalizeMoney } from 'src/common/money/money';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { BudgetWriteService } from '../../budgets/budget-write.service';
import {
  Account,
  AccountDocument,
} from 'src/modules/accounts/schemas/accounts.schema';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import {
  Transaction,
  TransactionDocument,
  TransactionType,
} from '../schemas/transaction.schema';
import { activeTransactionFilter } from './active-transaction.filter';

export type FinancialTransaction = Transaction & {
  _id: Types.ObjectId;
  category?: Types.ObjectId;
  participantId?: Types.ObjectId;
};
export type BudgetTransactionQuery = ListTransactionsQueryDto & {
  categoryId?: string;
  participantId?: string;
  currency?: string;
};
export type FinancialChanges = {
  amount?: number;
  description?: string;
  source?: string;
  merchant?: string;
  items?: { name: string; price: number; quantity: number }[];
  category?: Types.ObjectId;
  participantId?: Types.ObjectId;
};

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(Account.name)
    private readonly accountModel: Model<AccountDocument>,
    private readonly snapshotService: AccountsSnapshotsService,
    private readonly write: BudgetWriteService,
  ) {}

  runForBudget<T>(
    budget: BudgetContext,
    actorId: string,
    work: (session: ClientSession) => Promise<T>,
    session?: ClientSession,
  ) {
    // Existing plans/debts own the supplied personal session and already passed access.
    if (session && budget.ownerType === 'user') return work(session);
    return this.write.run(budget, actorId, work, undefined, session);
  }

  async findAll(
    userId: string,
    query: ListTransactionsQueryDto,
    model: Model<Transaction> = this.transactionModel,
  ) {
    const budget = await this.ensureUserExists(userId);
    const result = await this.findAllForBudget(budget, query, undefined, model);
    return { ...result, items: result.items.map(personalResponse) };
  }

  async findAllForBudget(
    budget: BudgetContext,
    query: BudgetTransactionQuery,
    kind?: TransactionType,
    model: Model<Transaction> = this.transactionModel,
    populateCategory = false,
  ) {
    const { page, limit, skip } = getPagination(query);
    const filter = this.buildFilterForBudget(budget, {
      ...query,
      ...(kind ? { transactionType: kind } : {}),
    });
    const lookup = model
      .find(filter)
      .sort({ transactionDate: -1, _id: -1 })
      .skip(skip)
      .limit(limit);
    if (populateCategory) lookup.populate('category');
    const [items, total] = await Promise.all([
      lookup.lean().exec(),
      model.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  async findOne(
    userId: string,
    transactionId: string,
    model: Model<Transaction> = this.transactionModel,
    session?: ClientSession,
  ) {
    return personalResponse(
      await this.findOneForBudget(
        personalBudget(userId),
        transactionId,
        undefined,
        session,
        model,
      ),
    );
  }

  async findOneForBudget(
    budget: BudgetContext,
    transactionId: string,
    kind?: TransactionType,
    session?: ClientSession,
    model: Model<Transaction> = this.transactionModel,
    populateCategory = false,
  ) {
    const lookup = model.findOne({
      _id: transactionId,
      ...budgetFilter(budget),
      ...activeTransactionFilter,
      ...(kind ? { type: kind } : {}),
    });
    if (populateCategory) lookup.populate('category');
    const row = await lookup
      .session(session ?? null)
      .lean<FinancialTransaction>()
      .exec();
    if (!row)
      throw new NotFoundException(
        budget.ownerType === 'group'
          ? 'Transaction not found'
          : `${populateCategory ? 'Expense' : 'Transaction'} ${transactionId} for user ${budget.ownerId.toString()} not found.`,
      );
    return row;
  }

  async findRevenue(
    userId: string,
    query: ListTransactionsQueryDto,
    model: Model<Transaction> = this.transactionModel,
  ) {
    const budget = await this.ensureUserExists(userId);
    return this.findRevenueForBudget(budget, query, undefined, model);
  }

  async findRevenueForBudget(
    budget: BudgetContext,
    query: BudgetTransactionQuery,
    kind?: TransactionType,
    model: Model<Transaction> = this.transactionModel,
  ) {
    const filter = this.buildFilterForBudget(budget, {
      ...query,
      ...(kind ? { transactionType: kind } : {}),
    });
    const aggregate = await model.aggregate<{
      _id: string;
      totalRevenue: number;
    }>([
      { $match: filter },
      {
        $group: {
          _id: '$currency',
          totalRevenue: { $sum: '$amount' },
        },
      },
    ]);
    const currencies = aggregate
      .filter((row) => typeof row._id === 'string')
      .map((row) => ({
        currency: row._id,
        totalRevenue: normalizeMoney(row.totalRevenue, row._id),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      totalRevenue:
        currencies.length > 1 ? null : (currencies[0]?.totalRevenue ?? 0),
      currencies,
    };
  }

  async delete(userId: string, transactionId: string) {
    const budget = personalBudget(userId);
    return this.runForBudget(budget, userId, async (session) => {
      const transaction = await this.findOneForBudget(
        budget,
        transactionId,
        undefined,
        session,
      );
      if (transaction.type === 'transfer')
        throw new BadRequestException(
          'Use the transfer endpoint to delete a transfer.',
        );
      await this.deleteForBudget(budget, userId, transaction, session);
      return null;
    });
  }

  validateMoneyForBudget(
    budget: BudgetContext,
    account: Account,
    values: Pick<FinancialChanges, 'amount' | 'items'>,
  ) {
    if (!account.currency)
      throw new BadRequestException('Account currency is missing.');
    if (
      values.amount !== undefined &&
      !hasValidMoneyPrecision(values.amount, account.currency)
    )
      throw new BadRequestException('Amount exceeds currency precision.');
    if (
      budget.ownerType === 'group' &&
      values.items?.some(
        (item) =>
          item.price <= 0 ||
          !hasValidMoneyPrecision(item.price, account.currency!),
      )
    )
      throw new BadRequestException('Item price exceeds currency precision.');
  }

  async updateForBudget(
    budget: BudgetContext,
    row: FinancialTransaction,
    changes: FinancialChanges,
    session: ClientSession,
    model: Model<Transaction> = this.transactionModel,
    populateCategory = false,
    account?: Account & { _id: Types.ObjectId },
  ) {
    const resolved =
      account ??
      (await this.accountForBudget(budget, row.accountId.toString(), session));
    this.validateMoneyForBudget(budget, resolved, changes);
    await this.lockAccountsForBudget(
      budget,
      [row.accountId.toString()],
      session,
    );
    const lookup = model.findOneAndUpdate(
      { _id: row._id, ...budgetFilter(budget), ...activeTransactionFilter },
      { $set: changes },
      { session, returnDocument: 'after', runValidators: true },
    );
    if (populateCategory) lookup.populate('category');
    const result = await lookup.lean().exec();
    if (!result)
      throw new NotFoundException(
        budget.ownerType === 'group'
          ? 'Transaction not found'
          : `${row.type === 'expense' ? 'Expense' : 'Income'} ${row._id.toString()} for user ${budget.ownerId.toString()} not found.`,
      );
    if (changes.amount !== undefined || budget.ownerType === 'group') {
      const delta =
        ((changes.amount ?? row.amount) - row.amount) *
        (row.type === 'expense' ? -1 : 1);
      await this.snapshotService.applyForBudget(
        resolved,
        row.transactionDate,
        delta,
        session,
      );
    }
    return result;
  }

  async deleteForBudget(
    budget: BudgetContext,
    actorId: string,
    row: FinancialTransaction,
    session: ClientSession,
    account?: Account & { _id: Types.ObjectId },
  ) {
    const resolved =
      account ??
      (await this.accountForBudget(budget, row.accountId.toString(), session));
    await this.lockAccountsForBudget(
      budget,
      [row.accountId.toString()],
      session,
    );
    const deleted = await this.transactionModel.findOneAndUpdate(
      { _id: row._id, ...budgetFilter(budget), ...activeTransactionFilter },
      {
        $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(actorId) },
      },
      { returnDocument: 'after', session },
    );
    if (!deleted)
      throw new NotFoundException(
        budget.ownerType === 'group'
          ? 'Transaction not found'
          : `Transaction ${row._id.toString()} not found`,
      );
    await this.snapshotService.applyForBudget(
      resolved,
      row.transactionDate,
      row.amount * (row.type === 'expense' ? 1 : -1),
      session,
    );
    return deleted.toObject();
  }

  async accountForCreate(
    budget: BudgetContext,
    accountId: string,
    date: Date,
    session: ClientSession,
  ) {
    const account = await this.accountForBudget(budget, accountId, session);
    if (budget.ownerType === 'group' && date < account.openedAt!)
      throw new BadRequestException('Transaction predates wallet');
    return account;
  }

  async accountForBudget(
    budget: BudgetContext,
    accountId: string,
    session: ClientSession,
  ) {
    if (budget.ownerType === 'user')
      return (
        await this.resolveActiveAccount(
          budget.ownerId.toString(),
          accountId,
          session,
        )
      ).account;
    const account = await this.accountModel
      .findOne({ _id: accountId, ...budgetFilter(budget), archivedAt: null })
      .session(session)
      .lean()
      .exec();
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  lockAccounts(userId: string, accountIds: string[], session: ClientSession) {
    return this.lockAccountsForBudget(
      personalBudget(userId),
      accountIds,
      session,
    );
  }

  async lockAccountsForBudget(
    budget: BudgetContext,
    accountIds: string[],
    session: ClientSession,
  ) {
    for (const id of [...new Set(accountIds)].sort()) {
      const result = await this.accountModel.updateOne(
        {
          _id: id,
          ...budgetFilter(budget),
          archivedAt: null,
        },
        { $inc: { mutationVersion: 1 } },
        { session },
      );
      if (!result.matchedCount)
        throw new NotFoundException(
          budget.ownerType === 'group'
            ? 'Account not found'
            : `Account ${id} not found.`,
        );
    }
  }

  hasHistoryByAccountId(
    userId: string,
    accountId: string,
    session: ClientSession,
  ) {
    return this.hasHistoryForBudget(personalBudget(userId), accountId, session);
  }

  async hasHistoryForBudget(
    budget: BudgetContext,
    accountId: string,
    session: ClientSession,
  ) {
    const accountObjectId = new Types.ObjectId(accountId);
    const found = await this.transactionModel
      .exists({
        ...budgetFilter(budget),
        $or: [
          { accountId: accountObjectId },
          { 'source.accountId': accountObjectId },
          { 'destination.accountId': accountObjectId },
        ],
      })
      .session(session);
    return Boolean(found);
  }

  buildFilter(userId: Types.ObjectId, query: BudgetTransactionQuery) {
    return this.buildFilterForBudget(personalBudget(userId), query);
  }

  buildFilterForBudget(budget: BudgetContext, query: BudgetTransactionQuery) {
    const filter: {
      userId?: Types.ObjectId;
      ownerType: 'user' | 'group';
      ownerId: Types.ObjectId;
      type?: TransactionType;
      transactionDate?: {
        $gte?: Date;
        $lte?: Date;
      };
      category?: Types.ObjectId;
      snapshotId?: Types.ObjectId;
      accountId?: Types.ObjectId;
      $or?: Record<string, Types.ObjectId>[];
      $and?: Array<{ $or: Record<string, Types.ObjectId>[] }>;
      deletedAt: null;
      currency?: string;
      participantId?: Types.ObjectId;
    } = { ...budgetFilter(budget), ...activeTransactionFilter };

    if (query.categoryId) {
      filter.category = new Types.ObjectId(query.categoryId);
    }
    if (query.currency) filter.currency = query.currency;
    if (query.participantId)
      filter.participantId = new Types.ObjectId(query.participantId);

    if (query.snapshotId) {
      const snapshotId = new Types.ObjectId(query.snapshotId);
      if (
        query.transactionType === 'income' ||
        query.transactionType === 'expense' ||
        budget.ownerType === 'group'
      )
        filter.snapshotId = snapshotId;
      else
        filter.$or = [
          { snapshotId },
          { 'source.snapshotId': snapshotId },
          { 'destination.snapshotId': snapshotId },
        ];
    }

    if (query.accountId) {
      const accountId = new Types.ObjectId(query.accountId);
      if (
        query.transactionType === 'income' ||
        query.transactionType === 'expense' ||
        budget.ownerType === 'group'
      )
        filter.accountId = accountId;
      else {
        const accountFilters: Record<string, Types.ObjectId>[] = [
          { accountId },
          { 'source.accountId': accountId },
          { 'destination.accountId': accountId },
        ];
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: accountFilters }];
          delete filter.$or;
        } else filter.$or = accountFilters;
      }
    }

    if (query.transactionType) {
      filter.type = query.transactionType;
    }

    if (query.fromDate || query.toDate) {
      const incomeDateFilter: { $gte?: Date; $lte?: Date } = {};

      if (query.fromDate) {
        incomeDateFilter.$gte = new Date(query.fromDate);
      }

      if (query.toDate) {
        incomeDateFilter.$lte = new Date(query.toDate);
      }

      filter.transactionDate = incomeDateFilter;
    }

    return filter;
  }

  async ensureUserExists(
    userId: string,
    session?: ClientSession,
  ): Promise<ReturnType<typeof personalBudget>>;
  async ensureUserExists(userId: string, session?: ClientSession) {
    const foundUser = await this.userModel
      .exists({ _id: userId })
      .session(session ?? null);

    if (!foundUser) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return personalBudget(foundUser._id);
  }

  async resolveActiveAccount(
    userId: string,
    accountId: string,
    session: ClientSession,
  ) {
    const foundIds = await this.ensureUserExists(userId, session);
    const account = await this.accountModel
      .findOne({
        _id: accountId,
        ...personalBudget(foundIds.userId),
        archivedAt: null,
      })
      .session(session)
      .lean()
      .exec();
    if (!account)
      throw new NotFoundException(`Account ${accountId} not found.`);
    if (!account.currency)
      throw new BadRequestException('Personal account currency is missing.');
    return { ...foundIds, account };
  }
}
