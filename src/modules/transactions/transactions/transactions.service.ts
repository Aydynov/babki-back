import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { getPagination } from 'src/common/utils/pagination.util';
import { normalizeMoney } from 'src/common/money/money';
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
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async findAll(
    userId: string,
    query: ListTransactionsQueryDto,
    model: Model<Transaction> = this.transactionModel,
  ) {
    const foundIds = await this.ensureUserExists(userId);
    const { page, limit, skip } = getPagination(query);
    const filter = this.buildFilter(foundIds.userId, query);

    const [items, total] = await Promise.all([
      model
        .find(filter)
        .sort({ transactionDate: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      model.countDocuments(filter),
    ]);

    return { items: items.map(personalResponse), total, page, limit };
  }

  async findOne(
    userId: string,
    transactionId: string,
    model: Model<Transaction> = this.transactionModel,
    session?: ClientSession,
  ) {
    const accountTransaction = await model
      .findOne({
        _id: transactionId,
        ...personalBudget(new Types.ObjectId(userId)),
        ...activeTransactionFilter,
      })
      .session(session ?? null)
      .lean()
      .exec();

    if (!accountTransaction) {
      throw new NotFoundException(
        `Transaction ${transactionId} for user ${userId} not found.`,
      );
    }

    return personalResponse(accountTransaction);
  }

  async findRevenue(
    userId: string,
    query: ListTransactionsQueryDto,
    model: Model<Transaction> = this.transactionModel,
  ) {
    const foundIds = await this.ensureUserExists(userId);
    const filter = this.buildFilter(foundIds.userId, query);

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
      .sort((left, right) => left.currency.localeCompare(right.currency));

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      totalRevenue:
        currencies.length > 1 ? null : (currencies[0]?.totalRevenue ?? 0),
      currencies,
    };
  }

  async delete(userId: string, transactionId: string) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const transaction = await this.findOne(
          userId,
          transactionId,
          this.transactionModel,
          session,
        );
        if (transaction.type === 'transfer')
          throw new BadRequestException(
            'Use the transfer endpoint to delete a transfer.',
          );
        await this.lockAccounts(
          userId,
          [transaction.accountId.toString()],
          session,
        );
        const deleted = await this.transactionModel.findOneAndUpdate(
          {
            _id: transactionId,
            ...personalBudget(userId),
            ...activeTransactionFilter,
          },
          {
            $set: {
              deletedAt: new Date(),
              deletedBy: new Types.ObjectId(userId),
            },
          },
          { returnDocument: 'after', session },
        );
        if (!deleted)
          throw new NotFoundException(`Transaction ${transactionId} not found`);
        await this.snapshotService.recalculateSnapshotsFromDate(
          userId,
          transaction.accountId.toString(),
          { date: transaction.transactionDate.toISOString() },
          {
            amount:
              transaction.amount * (transaction.type === 'expense' ? 1 : -1),
          },
          session,
        );
        return null;
      });
    } finally {
      await session.endSession();
    }
  }

  async lockAccounts(
    userId: string,
    accountIds: string[],
    session: ClientSession,
  ) {
    for (const id of [...new Set(accountIds)].sort()) {
      const result = await this.accountModel.updateOne(
        { _id: id, ...personalBudget(userId), archivedAt: null },
        { $inc: { mutationVersion: 1 } },
        { session },
      );
      if (!result.matchedCount)
        throw new NotFoundException(`Account ${id} not found.`);
    }
  }

  async hasHistoryByAccountId(
    userId: string,
    accountId: string,
    session: ClientSession,
  ) {
    const accountObjectId = new Types.ObjectId(accountId);
    const found = await this.transactionModel
      .exists({
        ...personalBudget(userId),
        $or: [
          { accountId: accountObjectId },
          { 'source.accountId': accountObjectId },
          { 'destination.accountId': accountObjectId },
        ],
      })
      .session(session);
    return Boolean(found);
  }

  buildFilter(
    userId: Types.ObjectId,
    query: Pick<
      ListTransactionsQueryDto,
      'snapshotId' | 'accountId' | 'fromDate' | 'toDate' | 'transactionType'
    > & { categoryId?: string; currency?: string },
  ) {
    const filter: {
      userId: Types.ObjectId;
      ownerType: 'user';
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
    } = { ...personalBudget(userId), ...activeTransactionFilter };

    if (query.categoryId) {
      filter.category = new Types.ObjectId(query.categoryId);
    }
    if (query.currency) filter.currency = query.currency;

    if (query.snapshotId) {
      const snapshotId = new Types.ObjectId(query.snapshotId);
      if (
        query.transactionType === 'income' ||
        query.transactionType === 'expense'
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
        query.transactionType === 'expense'
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
