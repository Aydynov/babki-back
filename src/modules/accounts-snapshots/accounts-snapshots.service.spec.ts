import { ClientSession, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from './accounts-snapshots.service';
import { AccountSnapshotsDocument } from './schemas/accounts-snapshots.schema';
import { AccountDocument } from '../accounts/schemas/accounts.schema';

describe('personal snapshot transactions', () => {
  it('creates the same calendar month in a different year using the caller session', async () => {
    const userId = new Types.ObjectId().toString();
    const accountId = new Types.ObjectId();
    const session = {} as ClientSession;
    const accountSession = jest.fn().mockResolvedValue({ _id: accountId });
    const readSession = jest
      .fn()
      .mockReturnValue({
        lean: async () => ({ date: new Date('2025-06-01'), amount: 40 }),
      });
    const create = jest
      .fn()
      .mockResolvedValue([{ toObject: () => ({ amount: 40 }) }]);
    const accounts = {
      exists: jest.fn().mockReturnValue({ session: accountSession }),
    };
    const snapshots = {
      findOne: jest
        .fn()
        .mockReturnValue({ sort: () => ({ session: readSession }) }),
      create,
    };
    const service = new AccountsSnapshotsService(
      snapshots as unknown as Model<AccountSnapshotsDocument>,
      accounts as unknown as Model<AccountDocument>,
    );
    await service.findOrCreateByAccountId(
      userId,
      accountId.toString(),
      '2026-06-15',
      session,
    );
    expect(accountSession).toHaveBeenCalledWith(session);
    expect(readSession).toHaveBeenCalledWith(session);
    expect(create).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: 40, date: new Date(2026, 5, 1) })],
      { session },
    );
    expect(accounts.exists).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'user',
        ownerId: new Types.ObjectId(userId),
      }),
    );
  });
});
