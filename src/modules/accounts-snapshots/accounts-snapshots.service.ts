import { personalBudget } from 'src/common/utils/personal-budget.util';
import { getCurrencyMinorUnits } from 'src/common/money/money';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { startOfMonth } from 'date-fns/startOfMonth';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { Account, AccountDocument } from '../accounts/schemas/accounts.schema';
import { CreateAccountSnapshotDto } from './dto/create.dto';
import { UpdateAccountSnapshotQueryDto } from './dto/update-query.dto';
import { UpdateAccountSnapshotDto } from './dto/update.dto';
import {
  AccountSnapshot,
  AccountSnapshotsDocument,
} from './schemas/accounts-snapshots.schema';

export const roundGroupMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export const utcMonthEnd = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);

@Injectable()
export class AccountsSnapshotsService {
  constructor(
    @InjectModel(AccountSnapshot.name)
    private readonly snapshotsModel: Model<AccountSnapshotsDocument>,
    @InjectModel(Account.name)
    private readonly accountsModel: Model<AccountDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionsModel?: Model<Transaction>,
  ) {}

  async balanceForBudget(
    account: Account & { _id: Types.ObjectId },
    date: Date,
    session?: ClientSession,
  ) {
    if (account.ownerType === 'user') {
      return (
        (
          await this.findByAccountId(
            String(account.ownerId),
            String(account._id),
            date.toISOString(),
            session,
          )
        )?.amount ?? 0
      );
    }
    if (account.openedAt && date < account.openedAt) return 0;
    const totals = await this.transactionsModel!.aggregate<{ total: number }>([
      {
        $match: {
          ...budgetFilter(account),
          accountId: account._id,
          deletedAt: null,
          transactionDate: { $lte: date },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'expense'] },
                { $multiply: ['$amount', -1] },
                '$amount',
              ],
            },
          },
        },
      },
    ]).session(session ?? null);
    return roundGroupMoney(
      (account.initialAmount ?? 0) + (totals[0]?.total ?? 0),
    );
  }

  async rebuildForBudget(
    account: Account & { _id: Types.ObjectId },
    from: Date,
    session: ClientSession,
  ) {
    const first = utcMonthEnd(from);
    const existing = await this.snapshotsModel
      .find({ accountId: account._id, date: { $gte: first } })
      .session(session)
      .lean();
    const dates = new Map(existing.map((s) => [s.date.toISOString(), s.date]));
    dates.set(first.toISOString(), first);
    for (const date of dates.values()) {
      const amount = await this.balanceForBudget(account, date, session);
      await this.snapshotsModel.updateOne(
        { accountId: account._id, date },
        { $set: { amount } },
        { upsert: true, session, runValidators: true },
      );
    }
  }

  async prepareForBudget(
    account: Account & { _id: Types.ObjectId },
    date: Date,
    session: ClientSession,
  ) {
    if (account.ownerType === 'user')
      return this.findOrCreateByAccountId(
        String(account.ownerId),
        String(account._id),
        date.toISOString(),
        session,
      );
    await this.rebuildForBudget(account, date, session);
    const snapshot = await this.snapshotsModel
      .findOne({ accountId: account._id, date: utcMonthEnd(date) })
      .session(session);
    if (!snapshot) throw new NotFoundException('Snapshot not found');
    return snapshot;
  }

  async applyForBudget(
    account: Account & { _id: Types.ObjectId },
    date: Date,
    delta: number,
    session: ClientSession,
  ) {
    if (account.ownerType === 'group')
      return this.rebuildForBudget(account, date, session);
    return this.recalculateSnapshotsFromDate(
      String(account.ownerId),
      String(account._id),
      { date: date.toISOString() },
      { amount: delta },
      session,
    );
  }

  async openingForBudget(
    account: Account & { _id: Types.ObjectId },
    session: ClientSession,
  ) {
    if (account.ownerType === 'user')
      return this.create(
        String(account.ownerId),
        String(account._id),
        { amount: account.initialAmount ?? 0, date: account.openedAt! },
        session,
      );
    const [snapshot] = await this.snapshotsModel.create(
      [
        {
          accountId: account._id,
          date: utcMonthEnd(account.openedAt!),
          amount: account.initialAmount,
        },
      ],
      { session },
    );
    return snapshot;
  }

  async timelineForBudget(accountId: Types.ObjectId, session?: ClientSession) {
    return this.snapshotsModel
      .find({ accountId })
      .sort({ date: -1 })
      .limit(20)
      .session(session ?? null)
      .lean();
  }

  async deleteForBudget(
    budget: BudgetContext,
    accountId: string,
    session?: ClientSession,
  ) {
    const owned = await this.ensureAccountExists(budget, accountId, session);
    await this.snapshotsModel.deleteMany({ accountId: owned }, { session });
  }

  async findByAccountId(
    userId: string,
    accountId: string,
    date?: string,
    session?: ClientSession,
  ) {
    const foundAccountId = await this.ensureAccountExists(
      userId,
      accountId,
      session,
    );
    const requestedDate = date ? new Date(date) : new Date();

    const entity = await this.snapshotsModel
      .findOne({
        accountId: foundAccountId,
        date: { $lte: requestedDate },
      })
      .sort({ date: -1 })
      .session(session ?? null)
      .lean();

    if (!entity) {
      return null;
    }

    return entity;
  }

  async findByUserId(userId: string, date?: string) {
    const foundAccounts = await this.findAccounts(userId);
    const requestedDate = date ? new Date(date) : new Date();

    return this.snapshotsModel
      .find({
        accountId: {
          $in: foundAccounts.map((account) => account._id),
        },
        date: { $lte: requestedDate },
      })
      .sort({ date: -1 })
      .lean();
  }

  async findOrCreateByAccountId(
    userId: string,
    accountId: string,
    date?: string,
    session?: ClientSession,
  ) {
    const foundSnapshot = await this.findByAccountId(
      userId,
      accountId,
      date,
      session,
    );
    const resolvedDate = date ? new Date(date) : new Date();
    if (
      !foundSnapshot ||
      foundSnapshot.date.getMonth() !== resolvedDate.getMonth() ||
      foundSnapshot.date.getFullYear() !== resolvedDate.getFullYear()
    ) {
      const [createdSnapshot] = await this.snapshotsModel.create(
        [
          {
            accountId: new Types.ObjectId(accountId),
            amount: foundSnapshot?.amount ?? 0,
            date: startOfMonth(resolvedDate),
          },
        ],
        { session },
      );
      return createdSnapshot.toObject();
    }
    return foundSnapshot;
  }

  async create(
    userId: string,
    accountId: string,
    createSnapshotDto: CreateAccountSnapshotDto,
    session?: ClientSession,
  ): Promise<AccountSnapshotsDocument> {
    if (!session) {
      const ownedSession = await this.accountsModel.db.startSession();
      try {
        return await ownedSession.withTransaction(() =>
          this.create(userId, accountId, createSnapshotDto, ownedSession),
        );
      } finally {
        await ownedSession.endSession();
      }
    }
    const locked = await this.accountsModel.updateOne(
      { _id: accountId, ...personalBudget(userId) },
      { $inc: { mutationVersion: 1 } },
      { session },
    );
    if (!locked.matchedCount)
      throw new NotFoundException(`Account ${accountId} not found.`);
    const createDtoInstance = plainToInstance(
      CreateAccountSnapshotDto,
      createSnapshotDto,
    );
    const foundAccountId = await this.ensureAccountExists(
      userId,
      accountId,
      session,
    );

    const existingEntity = await this.snapshotsModel
      .findOne({ accountId: foundAccountId, date: createDtoInstance.date })
      .session(session ?? null)
      .lean()
      .exec();

    if (existingEntity) {
      throw new ConflictException(
        `Snapshot for account ${accountId} on ${createSnapshotDto.date.toISOString()} already exists.`,
      );
    }

    const [snapshot] = await this.snapshotsModel.create(
      [{ accountId: foundAccountId, ...createDtoInstance }],
      { session },
    );
    return snapshot;
  }

  async recalculateSnapshotsFromDate(
    userId: string,
    accountId: string,
    queryDto: UpdateAccountSnapshotQueryDto,
    updateDto: UpdateAccountSnapshotDto,
    session?: ClientSession,
  ) {
    const entity = await this.snapshotsModel
      .findOne({
        accountId: new Types.ObjectId(accountId),
        date: { $lte: queryDto.date },
      })
      .sort({ date: -1 })
      .session(session ?? null)
      .lean()
      .exec();

    if (!entity) {
      throw new NotFoundException(
        `Snapshot for date ${queryDto.date} not found.`,
      );
    }

    const account = await this.accountsModel
      .findOne({ _id: accountId, ...personalBudget(userId) })
      .session(session ?? null)
      .lean()
      .exec();
    if (!account)
      throw new NotFoundException(
        `Account ${accountId} for user ${userId} not found.`,
      );
    const foundAccountId = account._id;
    const precision = account.currency
      ? getCurrencyMinorUnits(account.currency)
      : 2;

    await this.snapshotsModel.updateMany(
      { accountId: foundAccountId, date: { $gte: entity.date } },
      [
        {
          $set: {
            amount: {
              $round: [{ $add: ['$amount', updateDto.amount] }, precision],
            },
          },
        },
      ],
      { updatePipeline: true, runValidators: true, session },
    );
  }

  async deleteAllByAccountId(
    userId: string,
    accountId: string,
    session?: ClientSession,
  ) {
    return this.deleteForBudget(personalBudget(userId), accountId, session);
  }

  // TODO Параметры сортировки и пагинации
  async findAllByAccounts(
    accountIds: Types.ObjectId[],
    query?: { toDate?: string },
  ) {
    const filter: {
      accountId: { $in: Types.ObjectId[] };
      date?: { $lte: Date };
    } = { accountId: { $in: accountIds } };
    if (query?.toDate) {
      filter.date = { $lte: new Date(query.toDate) };
    }

    return this.snapshotsModel.aggregate<{
      _id: Types.ObjectId;
      documents: AccountSnapshotsDocument[];
    }>([
      { $match: filter },
      {
        $group: {
          _id: '$accountId',
          documents: {
            $topN: {
              n: 20,
              sortBy: { date: -1 },
              output: '$$ROOT',
            },
          },
        },
      },
    ]);
  }

  private async ensureAccountExists(
    context: string | BudgetContext,
    accountId: string,
    session?: ClientSession,
  ) {
    const budget =
      typeof context === 'string' ? personalBudget(context) : context;
    const accountEntity = await this.accountsModel
      .exists({
        _id: accountId,
        ...budgetFilter(budget),
      })
      .session(session ?? null);

    if (!accountEntity) {
      throw new NotFoundException(
        budget.ownerType === 'user'
          ? `Account ${accountId} for user ${budget.ownerId.toString()} not found.`
          : 'Account not found',
      );
    }

    return accountEntity._id;
  }

  private async findAccounts(userId: string) {
    return this.accountsModel
      .find({ ...personalBudget(new Types.ObjectId(userId)) })
      .lean();
  }
}
