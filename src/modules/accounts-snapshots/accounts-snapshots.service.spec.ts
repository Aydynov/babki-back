import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AccountsSnapshotsService } from './accounts-snapshots.service';

describe('space snapshot balances', () => {
  const budget = { spaceId: new Types.ObjectId() };
  const account = {
    ...budget,
    _id: new Types.ObjectId(),
    type: 'balance' as const,
    currency: 'USD',
    initialAmount: 10,
    openedAt: new Date('2025-06-01'),
  };
  const session = {} as import('mongoose').ClientSession;
  const aggregateSession = jest.fn();
  const transactions = {
    aggregate: jest.fn(() => ({ session: aggregateSession })),
  };
  const snapshots = {
    find: jest.fn(),
    updateOne: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  };
  const accounts = { exists: jest.fn() };
  const service = new AccountsSnapshotsService(
    snapshots as never,
    accounts as never,
    transactions as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    aggregateSession.mockResolvedValue([{ total: 0.1 + 0.2 }]);
  });
  it('adds the initial amount to scoped ledger effects using currency precision', async () => {
    const date = new Date('2026-06-15');
    await expect(
      service.balanceForBudget(account, date, session),
    ).resolves.toBe(10.3);
    expect(transactions.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          $match: {
            ...budget,
            deletedAt: null,
            transactionDate: { $lte: date },
            $or: [
              { accountId: account._id },
              { 'source.accountId': account._id },
              { 'destination.accountId': account._id },
            ],
          },
        },
      ]),
    );
    expect(aggregateSession).toHaveBeenCalledWith(session);
  });
  it('returns zero before opening without reading the ledger', async () => {
    await expect(
      service.balanceForBudget(account, new Date('2025-05-31'), session),
    ).resolves.toBe(0);
    expect(transactions.aggregate).not.toHaveBeenCalled();
  });
  it('rebuilds the same month in a different year at its UTC month end', async () => {
    snapshots.find.mockReturnValue({
      session: () => ({ lean: async () => [] }),
    });
    await service.rebuildForBudget(account, new Date('2026-06-15'), session);
    expect(snapshots.updateOne).toHaveBeenCalledWith(
      { accountId: account._id, date: new Date('2026-06-30T23:59:59.999Z') },
      { $set: { amount: 10.3 } },
      { upsert: true, session, runValidators: true },
    );
  });
  it('rejects a foreign account before deleting its snapshots', async () => {
    accounts.exists.mockReturnValue({ session: async () => null });
    await expect(
      service.deleteForBudget(budget, String(account._id), session),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accounts.exists).toHaveBeenCalledWith({
      _id: String(account._id),
      ...budget,
    });
    expect(snapshots.deleteMany).not.toHaveBeenCalled();
  });
});
