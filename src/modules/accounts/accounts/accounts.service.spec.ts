import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AccountsService } from './accounts.service';

describe('space account lifecycle', () => {
  const budget = { spaceId: new Types.ObjectId() };
  const accountId = new Types.ObjectId().toString();
  const session = {} as import('mongoose').ClientSession;
  const model = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const snapshots = {
    openingForBudget: jest.fn(),
    balanceForBudget: jest.fn(),
    deleteForBudget: jest.fn(),
  };
  const transactions = { hasHistoryForBudget: jest.fn() };
  const service = new AccountsService(
    model as never,
    snapshots as never,
    transactions as never,
  );
  const found = (type: 'balance' | 'saving', initialAmount = 0) =>
    model.findOne.mockReturnValue({
      session: () => ({
        lean: () => ({
          exec: async () => ({
            _id: accountId,
            type,
            initialAmount,
            ...budget,
          }),
        }),
      }),
    });
  beforeEach(() => {
    jest.clearAllMocks();
    model.updateOne.mockResolvedValue({ matchedCount: 1 });
    model.findOneAndDelete.mockResolvedValue({ _id: accountId });
    model.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: async () => ({ _id: accountId }) }),
    });
  });
  it('creates named accounts with an opening snapshot in the same session', async () => {
    model.create.mockImplementation(async (rows: object[]) => [
      { ...rows[0], toObject: () => rows[0] },
    ]);
    snapshots.balanceForBudget.mockResolvedValue(10);
    const result = await service.createForBudget(
      budget,
      {
        name: ' Travel ',
        type: 'balance',
        currency: 'USD',
        amount: 10,
        openedAt: '2026-01-01',
      },
      session,
    );
    expect(result).toMatchObject({
      ...budget,
      name: 'Travel',
      initialAmount: 10,
      amount: 10,
      openedAt: new Date('2026-01-01'),
    });
    expect(model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ ...budget, currency: 'USD' })],
      { session },
    );
    expect(snapshots.openingForBudget).toHaveBeenCalledWith(
      expect.objectContaining(budget),
      session,
    );
  });
  it.each(['balance', 'saving'] as const)(
    'restricts deleting a %s account with financial history',
    async (type) => {
      found(type);
      transactions.hasHistoryForBudget.mockResolvedValue(true);
      await expect(
        service.removeForBudget(budget, accountId, session),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(snapshots.deleteForBudget).not.toHaveBeenCalled();
      expect(model.findOneAndDelete).not.toHaveBeenCalled();
    },
  );
  it('restricts deleting a nonzero opening balance', async () => {
    found('balance', 10);
    await expect(
      service.removeForBudget(budget, accountId, session),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transactions.hasHistoryForBudget).not.toHaveBeenCalled();
    expect(snapshots.deleteForBudget).not.toHaveBeenCalled();
  });
  it('deletes snapshots only for an unused zero-balance account', async () => {
    found('balance');
    transactions.hasHistoryForBudget.mockResolvedValue(false);
    await service.removeForBudget(budget, accountId, session);
    expect(snapshots.deleteForBudget).toHaveBeenCalledWith(
      budget,
      accountId,
      session,
    );
    expect(model.findOneAndDelete).toHaveBeenCalledWith(
      { _id: accountId, ...budget },
      { session },
    );
  });
  it('archives within the space-scoped account lock', async () => {
    await service.archiveForBudget(budget, accountId, session);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: accountId, ...budget },
      { $inc: { mutationVersion: 1 } },
      { session },
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: accountId, ...budget, archivedAt: null },
      { $set: { archivedAt: expect.any(Date) } },
      expect.objectContaining({ session }),
    );
  });
  it('rejects a foreign account before deleting any snapshots', async () => {
    model.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      service.removeForBudget(budget, accountId, session),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(snapshots.deleteForBudget).not.toHaveBeenCalled();
  });
});
