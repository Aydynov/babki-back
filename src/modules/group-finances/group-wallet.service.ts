import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Account } from '../accounts/schemas/accounts.schema';
import { AccountSnapshot } from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { BudgetAccessService, groupBudget } from './budget-access.service';
import { GroupFinanceWriteService } from './group-finance-write.service';
import { CreateGroupAccountDto } from './dto/group-finances.dto';
export const money = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export const monthEnd = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);
@Injectable()
export class GroupWalletService {
  constructor(
    @InjectModel(Account.name) private readonly accounts: Model<Account>,
    @InjectModel(AccountSnapshot.name)
    private readonly snapshots: Model<AccountSnapshot>,
    @InjectModel(Transaction.name)
    private readonly transactions: Model<Transaction>,
    private readonly access: BudgetAccessService,
    private readonly write: GroupFinanceWriteService,
  ) {}
  async create(groupId: string, actor: string, dto: CreateGroupAccountDto) {
    return this.write.run(
      groupId,
      actor,
      async (session) => {
        const budget = groupBudget(groupId);
        if (
          await this.accounts
            .exists({ ...budget, type: 'balance' })
            .session(session)
        )
          throw new ConflictException('Wallet already exists');
        const [account] = await this.accounts.create(
          [
            {
              ...budget,
              type: 'balance',
              initialAmount: dto.amount ?? 0,
              openedAt: dto.openedAt ? new Date(dto.openedAt) : new Date(),
            },
          ],
          { session },
        );
        await this.snapshots.create(
          [
            {
              accountId: account._id,
              date: monthEnd(account.openedAt!),
              amount: account.initialAmount,
            },
          ],
          { session },
        );
        return {
          ...account.toObject(),
          amount: await this.balance(account, new Date(), session),
          timeline: [],
        };
      },
      'manageAccounts',
    );
  }
  async list(groupId: string, actor: string) {
    const budget = await this.access.resolve(actor, groupId);
    const accounts = await this.accounts.find(budget).lean();
    return Promise.all(
      accounts.map(async (a) => ({
        ...a,
        amount: await this.balance(a, new Date()),
        timeline: await this.snapshots
          .find({ accountId: a._id })
          .sort({ date: -1 })
          .limit(20)
          .lean(),
      })),
    );
  }
  async get(groupId: string, actor: string, id: string) {
    const budget = await this.access.resolve(actor, groupId);
    const account = await this.access.account(budget, id);
    return {
      ...account.toObject(),
      amount: await this.balance(account, new Date()),
      timeline: await this.snapshots
        .find({ accountId: account._id })
        .sort({ date: -1 })
        .limit(20)
        .lean(),
    };
  }
  async remove(groupId: string, actor: string, id: string) {
    await this.write.run(
      groupId,
      actor,
      async (session) => {
        const account = await this.access.account(
          groupBudget(groupId),
          id,
          session,
        );
        if (
          account.initialAmount !== 0 ||
          (await this.transactions
            .exists({ accountId: account._id })
            .session(session))
        )
          throw new ConflictException('Wallet has financial history');
        await this.snapshots.deleteMany(
          { accountId: account._id },
          { session },
        );
        await this.accounts.deleteOne({ _id: account._id }, { session });
      },
      'manageAccounts',
    );
  }
  async balance(
    account: Account & { _id: Types.ObjectId },
    date: Date,
    session?: ClientSession,
  ) {
    if (account.openedAt && date < account.openedAt) return 0;
    const totals = await this.transactions
      .aggregate<{ total: number }>([
        {
          $match: {
            ...groupBudget(String(account.ownerId)),
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
      ])
      .session(session ?? null);
    return money((account.initialAmount ?? 0) + (totals[0]?.total ?? 0));
  }
  async rebuild(
    account: Account & { _id: Types.ObjectId },
    from: Date,
    session: ClientSession,
  ) {
    const first = monthEnd(from);
    const existing = await this.snapshots
      .find({ accountId: account._id, date: { $gte: first } })
      .session(session)
      .lean();
    const dates = new Map(existing.map((s) => [s.date.toISOString(), s.date]));
    dates.set(first.toISOString(), first);
    for (const date of dates.values()) {
      const amount = await this.balance(account, date, session);
      await this.snapshots.updateOne(
        { accountId: account._id, date },
        { $set: { amount } },
        { upsert: true, session, runValidators: true },
      );
    }
  }
}
