import { ConflictException } from '@nestjs/common';
import { Connection, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { TransactionsService } from '../../transactions/transactions/transactions.service';
import { UsersService } from '../../users/users.service';
import { AccountDocument } from '../schemas/accounts.schema';
import { AccountsService } from './accounts.service';

describe('AccountsService deletion lifecycle', () => {
  const userId = '507f1f77bcf86cd799439011';
  const accountId = '507f1f77bcf86cd799439012';
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn(),
  };
  const accountModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const snapshots = {
    create: jest.fn(),
    deleteAllByAccountId: jest.fn(),
  };
  const transactions = {
    lockAccounts: jest.fn(),
    hasHistoryByAccountId: jest.fn(),
    deleteAllByAccountId: jest.fn(),
  };
  const users = {
    ensureIdExists: jest.fn(),
    selectFirstDefaultAccount: jest.fn(),
    clearDefaultAccount: jest.fn(),
  };
  const service = new AccountsService(
    accountModel as unknown as Model<AccountDocument>,
    users as unknown as UsersService,
    snapshots as unknown as AccountsSnapshotsService,
    transactions as unknown as TransactionsService,
    {
      startSession: jest.fn().mockResolvedValue(session),
    } as unknown as Connection,
  );

  function foundAccount(
    type: 'balance' | 'saving',
    initialAmount = 0,
    archivedAt: Date | null = null,
  ) {
    accountModel.findOne.mockReturnValue({
      session: () => ({
        lean: () => ({
          exec: async () => ({
            _id: new Types.ObjectId(accountId),
            type,
            initialAmount,
            archivedAt,
          }),
        }),
      }),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    accountModel.findOneAndDelete.mockResolvedValue({ _id: accountId });
    accountModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    accountModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: async () => ({ _id: accountId }) }),
    });
  });

  it('creates another named account of the same type and selects the first matching balance', async () => {
    const createdId = new Types.ObjectId();
    users.ensureIdExists.mockResolvedValue(new Types.ObjectId(userId));
    accountModel.create.mockResolvedValue([
      {
        _id: createdId,
        type: 'balance',
        currency: 'USD',
        name: 'Travel',
        toObject: () => ({
          _id: createdId,
          type: 'balance',
          currency: 'USD',
          name: 'Travel',
        }),
      },
    ]);
    snapshots.create.mockResolvedValue({ amount: 10 });

    await service.create(userId, {
      name: 'Travel',
      type: 'balance',
      currency: 'USD',
      amount: 10,
    });

    expect(accountModel.findOne).not.toHaveBeenCalled();
    expect(users.selectFirstDefaultAccount).toHaveBeenCalledWith(
      userId,
      createdId,
      'USD',
      session,
    );
  });

  it.each(['balance', 'saving'] as const)(
    'rejects deleting a %s account with transaction history without changing snapshots',
    async (type) => {
      foundAccount(type);
      transactions.hasHistoryByAccountId.mockResolvedValue(true);

      await expect(
        service.deleteEntity(userId, accountId),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(snapshots.deleteAllByAccountId).not.toHaveBeenCalled();
      expect(accountModel.findOneAndDelete).not.toHaveBeenCalled();
      expect(transactions.deleteAllByAccountId).not.toHaveBeenCalled();
    },
  );

  it('rejects deleting an account with a non-zero initial balance', async () => {
    foundAccount('balance', 10);

    await expect(
      service.deleteEntity(userId, accountId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transactions.hasHistoryByAccountId).not.toHaveBeenCalled();
    expect(snapshots.deleteAllByAccountId).not.toHaveBeenCalled();
  });

  it('deletes only snapshots with an unused zero-balance account', async () => {
    foundAccount('balance');
    transactions.hasHistoryByAccountId.mockResolvedValue(false);

    await service.deleteEntity(userId, accountId);

    expect(snapshots.deleteAllByAccountId).toHaveBeenCalledWith(
      userId,
      accountId,
      session,
    );
    expect(transactions.deleteAllByAccountId).not.toHaveBeenCalled();
    expect(accountModel.findOneAndDelete).toHaveBeenCalled();
    expect(users.clearDefaultAccount).toHaveBeenCalledWith(
      userId,
      accountId,
      session,
    );
  });

  it('archives an owned active account inside the account lock', async () => {
    await service.archive(userId, accountId);

    expect(accountModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: accountId }),
      { $inc: { mutationVersion: 1 } },
      { session },
    );
    expect(accountModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: accountId,
        ownerType: 'user',
        ownerId: new Types.ObjectId(userId),
        archivedAt: null,
      }),
      { $set: { archivedAt: expect.any(Date) } },
      expect.objectContaining({ session }),
    );
    expect(users.clearDefaultAccount).toHaveBeenCalledWith(
      userId,
      accountId,
      session,
    );
  });
});
