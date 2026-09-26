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
  const transactionModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    exists: jest.fn(),
  };
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
      deletedAt: null,
    });
  });
  it('filters account history through either transfer effect', () => {
    const accountId = new Types.ObjectId(first);
    expect(
      service.buildFilter(new Types.ObjectId(userId), { accountId: first }),
    ).toMatchObject({
      $or: [
        { accountId },
        { 'source.accountId': accountId },
        { 'destination.accountId': accountId },
      ],
    });
    expect(
      service.buildFilter(new Types.ObjectId(userId), {
        accountId: first,
        transactionType: 'income',
      }),
    ).toMatchObject({ accountId, type: 'income' });
  });
  it('uses the indexed stable order for transaction pagination', async () => {
    jest.spyOn(service, 'ensureUserExists').mockResolvedValue({
      userId: new Types.ObjectId(userId),
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
    });
    const exec = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean: () => ({ exec }) });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    transactionModel.find.mockReturnValue({ sort });
    transactionModel.countDocuments.mockResolvedValue(0);

    await service.findAll(userId, { page: 1, limit: 20 });

    expect(sort).toHaveBeenCalledWith({ transactionDate: -1, _id: -1 });
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
      archivedAt: null,
    });
  });

  it('checks immutable history in both account directions', async () => {
    const historyQuery = {
      session: jest.fn().mockResolvedValue({ _id: second }),
    };
    transactionModel.exists.mockReturnValue(historyQuery);

    await expect(
      service.hasHistoryByAccountId(
        userId,
        first,
        session as unknown as ClientSession,
      ),
    ).resolves.toBe(true);

    expect(transactionModel.exists).toHaveBeenCalledWith({
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
      userId: new Types.ObjectId(userId),
      $or: [
        { accountId: new Types.ObjectId(first) },
        { 'source.accountId': new Types.ObjectId(first) },
        { 'destination.accountId': new Types.ObjectId(first) },
      ],
    });
    expect(historyQuery.session).toHaveBeenCalledWith(session);
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
    transactionModel.findOneAndUpdate.mockResolvedValue(tx);
    await service.delete(userId, second);
    expect(transactionModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'user', deletedAt: null }),
      {
        $set: {
          deletedAt: expect.any(Date),
          deletedBy: new Types.ObjectId(userId),
        },
      },
      { returnDocument: 'after', session },
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
