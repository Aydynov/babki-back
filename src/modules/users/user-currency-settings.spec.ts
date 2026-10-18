import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from './users.service';

describe('UsersService currency settings', () => {
  const userId = new Types.ObjectId().toString();
  const accountId = new Types.ObjectId().toString();
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn(),
  };
  const accounts = { findPersonalAccount: jest.fn() };
  const updateExec = jest.fn();
  const currentExec = jest.fn();
  const userModel = {
    db: {
      startSession: jest.fn(async () => session),
    },
    findOne: jest.fn(() => ({
      session: () => ({ lean: () => ({ exec: currentExec }) }),
    })),
    findOneAndUpdate: jest.fn(() => ({ lean: () => ({ exec: updateExec }) })),
  };
  const service = new UsersService(userModel as never, accounts as never);

  beforeEach(() => {
    jest.clearAllMocks();
    accounts.findPersonalAccount.mockResolvedValue(null);
    currentExec.mockResolvedValue({
      _id: userId,
      defaultCurrency: 'RUB',
      defaultAccountId: new Types.ObjectId(accountId),
    });
    updateExec.mockResolvedValue({
      _id: userId,
      defaultCurrency: 'USD',
      defaultAccountId: null,
    });
  });

  it('clears an incompatible default account on a currency-only change', async () => {
    await expect(
      service.update(userId, { defaultCurrency: 'usd' }),
    ).resolves.toMatchObject({
      defaultCurrency: 'USD',
      defaultAccountId: null,
    });
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        defaultCurrency: 'USD',
        defaultAccountId: null,
      }),
      expect.objectContaining({ session }),
    );
  });

  it('checks the selected account through the lookup service in the current session', async () => {
    accounts.findPersonalAccount.mockResolvedValue({
      type: 'balance',
      currency: 'USD',
      archivedAt: null,
    });
    updateExec.mockResolvedValue({
      _id: userId,
      defaultCurrency: 'USD',
      defaultAccountId: new Types.ObjectId(accountId),
    });

    await expect(
      service.update(userId, {
        defaultCurrency: 'USD',
        defaultAccountId: accountId,
      }),
    ).resolves.toMatchObject({
      defaultAccountId: new Types.ObjectId(accountId),
    });
    expect(accounts.findPersonalAccount).toHaveBeenCalledWith(
      userId,
      accountId,
      session,
    );
  });

  it.each([
    [null, NotFoundException],
    [
      { type: 'saving', currency: 'USD', archivedAt: null },
      BadRequestException,
    ],
    [
      { type: 'balance', currency: 'RUB', archivedAt: null },
      BadRequestException,
    ],
    [
      { type: 'balance', currency: 'USD', archivedAt: new Date() },
      BadRequestException,
    ],
  ])(
    'rejects an invalid explicitly selected default account',
    async (account, error) => {
      accounts.findPersonalAccount.mockResolvedValue(account);
      await expect(
        service.update(userId, {
          defaultCurrency: 'USD',
          defaultAccountId: accountId,
        }),
      ).rejects.toBeInstanceOf(error);
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
});
