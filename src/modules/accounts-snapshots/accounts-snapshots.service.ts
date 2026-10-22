import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { normalizeMoney } from 'src/common/money/money';
import { Account, AccountDocument } from '../accounts/schemas/accounts.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import {
  AccountSnapshot,
  AccountSnapshotsDocument,
} from './schemas/accounts-snapshots.schema';
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
    account: Account & {
      _id: Types.ObjectId;
    },
    date: Date,
    session?: ClientSession,
  ) {
    if (account.openedAt && date < account.openedAt) return 0;
    const totals = await this.transactionsModel!.aggregate<{
      total: number;
    }>([
      {
        $match: {
          ...budgetFilter(account),
          $or: [
            { accountId: account._id },
            { 'source.accountId': account._id },
            { 'destination.accountId': account._id },
          ],
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
                { $eq: ['$type', 'transfer'] },
                {
                  $cond: [
                    { $eq: ['$source.accountId', account._id] },
                    { $multiply: ['$source.amount', -1] },
                    '$destination.amount',
                  ],
                },
                {
                  $cond: [
                    { $eq: ['$type', 'expense'] },
                    { $multiply: ['$amount', -1] },
                    '$amount',
                  ],
                },
              ],
            },
          },
        },
      },
    ]).session(session ?? null);
    return normalizeMoney(
      (account.initialAmount ?? 0) + (totals[0]?.total ?? 0),
      account.currency!,
    );
  }
  async rebuildForBudget(
    account: Account & {
      _id: Types.ObjectId;
    },
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
    account: Account & {
      _id: Types.ObjectId;
    },
    date: Date,
    session: ClientSession,
  ) {
    await this.rebuildForBudget(account, date, session);
    const snapshot = await this.snapshotsModel
      .findOne({ accountId: account._id, date: utcMonthEnd(date) })
      .session(session);
    if (!snapshot) throw new NotFoundException('Snapshot not found');
    return snapshot;
  }
  async applyForBudget(
    account: Account & {
      _id: Types.ObjectId;
    },
    date: Date,
    delta: number,
    session: ClientSession,
  ) {
    return this.rebuildForBudget(account, date, session);
  }
  async openingForBudget(
    account: Account & {
      _id: Types.ObjectId;
    },
    session: ClientSession,
  ) {
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
  // TODO Параметры сортировки и пагинации
  async findAllByAccounts(
    accountIds: Types.ObjectId[],
    query?: {
      toDate?: string;
    },
  ) {
    const filter: {
      accountId: {
        $in: Types.ObjectId[];
      };
      date?: {
        $lte: Date;
      };
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
    budget: BudgetContext,
    accountId: string,
    session?: ClientSession,
  ) {
    const account = await this.accountsModel
      .exists({ _id: accountId, ...budgetFilter(budget) })
      .session(session ?? null);
    if (!account) throw new NotFoundException('Account not found');
    return account._id;
  }
}
