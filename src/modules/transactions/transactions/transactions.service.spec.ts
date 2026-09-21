import { NotFoundException } from '@nestjs/common';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { AccountDocument } from '../../accounts/schemas/accounts.schema';
import { UserDocument } from '../../users/schemas/user.schema';
import { TransactionDocument } from '../schemas/transaction.schema';
import { TransactionsService } from './transactions.service';

describe('personal transactions boundary', () => {
  const userId = new Types.ObjectId().toString();
  const first = '507f1f77bcf86cd799439011';
  const second = '507f1f77bcf86cd799439012';
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn(),
  };
  const accountModel = { updateOne: jest.fn() };
  const transactionModel = { findOne: jest.fn(), findOneAndDelete: jest.fn() };
  const snapshots = { recalculateSnapshotsFromDate: jest.fn() };
  const service = new TransactionsService(
    {} as Model<UserDocument>,
    transactionModel as unknown as Model<TransactionDocument>,
    accountModel as unknown as Model<AccountDocument>,
    snapshots as unknown as AccountsSnapshotsService,
    { startSession: async () => session } as unknown as Connection,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    accountModel.updateOne.mockResolvedValue({ matchedCount: 1 });
  });
  it('filters all personal aggregates by explicit owner context', () => {
    expect(service.buildFilter(new Types.ObjectId(userId), {})).toEqual({
      userId: new Types.ObjectId(userId),
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
    });
  });
  it('locks both save accounts once in a stable order', async () => {
    await service.lockAccounts(
      userId,
      [second, first, second],
      session as unknown as ClientSession,
    );
    expect(
      accountModel.updateOne.mock.calls.map(([filter]) => filter._id),
    ).toEqual([first, second]);
    expect(accountModel.updateOne.mock.calls[0][0]).toMatchObject({
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
    });
  });
  it('rejects a group account even when its identifier is supplied', async () => {
    accountModel.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      service.lockAccounts(
        userId,
        [first],
        session as unknown as ClientSession,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('performs removal and compensation in the same transaction', async () => {
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
    transactionModel.findOneAndDelete.mockResolvedValue(tx);
    await service.delete(userId, second);
    expect(transactionModel.findOneAndDelete).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'user' }),
      { session },
    );
    expect(snapshots.recalculateSnapshotsFromDate).toHaveBeenCalledWith(
      userId,
      first,
      expect.anything(),
      { amount: 42 },
      session,
    );
  });
});
