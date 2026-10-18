import { ClientSession, Model, Types } from 'mongoose';
import { AccountsLookupService } from './accounts-lookup.service';
import { Account } from './schemas/accounts.schema';

describe('AccountsLookupService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const accountId = '507f1f77bcf86cd799439012';
  const session = {} as ClientSession;
  const exec = jest.fn();
  const useSession = jest.fn(() => ({ lean: () => ({ exec }) }));
  const accounts = { findOne: jest.fn(() => ({ session: useSession })) };
  const service = new AccountsLookupService(
    accounts as unknown as Model<Account>,
  );

  beforeEach(() => jest.clearAllMocks());

  it('scopes personal account reads to the owner and supplied transaction', async () => {
    const account = { _id: new Types.ObjectId(accountId), currency: 'USD' };
    exec.mockResolvedValue(account);

    await expect(
      service.findPersonalAccount(userId, accountId, session),
    ).resolves.toBe(account);

    expect(accounts.findOne).toHaveBeenCalledWith({
      _id: new Types.ObjectId(accountId),
      userId: new Types.ObjectId(userId),
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
    });
    expect(useSession).toHaveBeenCalledWith(session);
  });

  it('returns null when the account does not belong to the user', async () => {
    exec.mockResolvedValue(null);
    await expect(
      service.findPersonalAccount(userId, accountId, session),
    ).resolves.toBeNull();
  });
});
