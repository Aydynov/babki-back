import { NotFoundException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { AccountDocument } from '../../accounts/schemas/accounts.schema';
import { TransactionDocument } from '../schemas/transaction.schema';
import { TransactionsService } from './transactions.service';
import { BudgetWriteService } from '../../budgets/budget-write.service';
import { spaceBudget } from 'src/common/budget/budget-context';
describe('space transactions boundary', () => {
  const userId = new Types.ObjectId().toString();
  const first = '507f1f77bcf86cd799439011';
  const second = '507f1f77bcf86cd799439012';
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn(),
  };
  const accountModel = { updateOne: jest.fn(), findOne: jest.fn() };
  const transactionModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    exists: jest.fn(),
  };
  const snapshots = { applyForBudget: jest.fn() };
  const write = {
    run: jest.fn(
      async (_budget, _actor, work: (s: ClientSession) => Promise<unknown>) =>
        work(session as unknown as ClientSession),
    ),
  };
  const service = new TransactionsService(
    transactionModel as unknown as Model<TransactionDocument>,
    accountModel as unknown as Model<AccountDocument>,
    snapshots as unknown as AccountsSnapshotsService,
    write as unknown as BudgetWriteService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    accountModel.updateOne.mockResolvedValue({ matchedCount: 1 });
  });
  it('scopes all aggregates to the explicit space', () => {
    expect(service.buildFilterForBudget(spaceBudget(userId), {})).toEqual({
      spaceId: new Types.ObjectId(userId),
      deletedAt: null,
    });
  });
  it('filters account history through either transfer effect', () => {
    const accountId = new Types.ObjectId(first);
    expect(
      service.buildFilterForBudget(spaceBudget(userId), { accountId: first }),
    ).toMatchObject({
      $or: [
        { accountId },
        { 'source.accountId': accountId },
        { 'destination.accountId': accountId },
      ],
    });
    expect(
      service.buildFilterForBudget(spaceBudget(userId), {
        accountId: first,
        transactionType: 'income',
      }),
    ).toMatchObject({ accountId, type: 'income' });
  });
  it('uses the indexed stable order for transaction pagination', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean: () => ({ exec }) });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    transactionModel.find.mockReturnValue({ sort });
    transactionModel.countDocuments.mockResolvedValue(0);
    await service.findAllForBudget(spaceBudget(userId), { page: 1, limit: 20 });
    expect(sort).toHaveBeenCalledWith({ transactionDate: -1, _id: -1 });
  });
  it('locks both save accounts once in a stable order', async () => {
    await service.lockAccountsForBudget(
      spaceBudget(userId),
      [second, first, second],
      session as unknown as ClientSession,
    );
    expect(
      accountModel.updateOne.mock.calls.map(([filter]) => filter._id),
    ).toEqual([first, second]);
    expect(accountModel.updateOne.mock.calls[0][0]).toMatchObject({
      spaceId: new Types.ObjectId(userId),
      archivedAt: null,
    });
  });
  it('checks immutable history in both account directions', async () => {
    const historyQuery = {
      session: jest.fn().mockResolvedValue({ _id: second }),
    };
    transactionModel.exists.mockReturnValue(historyQuery);
    await expect(
      service.hasHistoryForBudget(
        spaceBudget(userId),
        first,
        session as unknown as ClientSession,
      ),
    ).resolves.toBe(true);
    expect(transactionModel.exists).toHaveBeenCalledWith({
      spaceId: new Types.ObjectId(userId),
      $or: [
        { accountId: new Types.ObjectId(first) },
        { 'source.accountId': new Types.ObjectId(first) },
        { 'destination.accountId': new Types.ObjectId(first) },
      ],
    });
    expect(historyQuery.session).toHaveBeenCalledWith(session);
  });
  it('rejects a foreign account even when its identifier is supplied', async () => {
    accountModel.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      service.lockAccountsForBudget(
        spaceBudget(userId),
        [first],
        session as unknown as ClientSession,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('soft deletes and compensates an expense in the same transaction', async () => {
    const tx = {
      _id: second,
      accountId: new Types.ObjectId(first),
      transactionDate: new Date(),
      amount: 42,
      type: 'expense',
    };
    transactionModel.findOne.mockReturnValue({
      session: () => ({ lean: () => ({ exec: async () => tx }) }),
    });
    transactionModel.findOneAndUpdate.mockResolvedValue({ toObject: () => tx });
    jest.spyOn(service, 'accountForBudget').mockResolvedValue({
      _id: new Types.ObjectId(first),
      spaceId: new Types.ObjectId(userId),
      currency: 'USD',
    } as Awaited<ReturnType<TransactionsService['accountForBudget']>>);
    await service.deleteForBudget(
      spaceBudget(userId),
      userId,
      tx as never,
      session as never,
    );
    expect(transactionModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: null }),
      {
        $set: {
          deletedAt: expect.any(Date),
          deletedBy: new Types.ObjectId(userId),
        },
      },
      { returnDocument: 'after', session },
    );
    expect(snapshots.applyForBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: new Types.ObjectId(userId),
      }),
      tx.transactionDate,
      42,
      session,
    );
  });
  it('keeps deleted history in scoped dependency lookups', async () => {
    const budget = spaceBudget(userId);
    transactionModel.exists.mockReturnValue({
      session: async () => ({ _id: first }),
    });
    await expect(
      service.hasHistoryForBudget(
        budget,
        first,
        session as unknown as ClientSession,
      ),
    ).resolves.toBe(true);
    expect(transactionModel.exists).toHaveBeenCalledWith({
      ...budget,
      $or: [
        { accountId: new Types.ObjectId(first) },
        { 'source.accountId': new Types.ObjectId(first) },
        { 'destination.accountId': new Types.ObjectId(first) },
      ],
    });
  });
  it.each([
    ['income', 10, 15, 5],
    ['expense', 20, 7, 13],
  ] as const)(
    'applies the %s old/new difference in the caller transaction',
    async (type, amount, updated, expectedDelta) => {
      const budget = spaceBudget(userId);
      const account = {
        ...budget,
        _id: new Types.ObjectId(first),
        currency: 'USD',
      } as Awaited<ReturnType<TransactionsService['accountForBudget']>>;
      const row = {
        ...budget,
        _id: new Types.ObjectId(second),
        createdBy: new Types.ObjectId(userId),
        accountId: account._id,
        snapshotId: new Types.ObjectId(),
        amount,
        type,
        transactionDate: new Date('2026-06-15T12:00:00Z'),
        origin: null,
      };
      transactionModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({ exec: async () => ({ ...row, amount: updated }) }),
      });
      await service.updateForBudget(
        budget,
        row,
        { amount: updated },
        session as unknown as ClientSession,
        undefined,
        false,
        account,
      );
      expect(transactionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          ...budget,
          deletedAt: null,
        }),
        { $set: { amount: updated } },
        expect.objectContaining({ session }),
      );
      expect(snapshots.applyForBudget).toHaveBeenCalledWith(
        account,
        row.transactionDate,
        expectedDelta,
        session,
      );
    },
  );
  it('matches either space transfer account without a personal userId', () => {
    const budget = spaceBudget(userId);
    expect(
      service.buildFilterForBudget(budget, {
        accountId: first,
        participantId: second,
      }),
    ).toEqual({
      ...budget,
      deletedAt: null,
      $or: [
        { accountId: new Types.ObjectId(first) },
        { 'source.accountId': new Types.ObjectId(first) },
        { 'destination.accountId': new Types.ObjectId(first) },
      ],
      participantId: new Types.ObjectId(second),
    });
  });
});
