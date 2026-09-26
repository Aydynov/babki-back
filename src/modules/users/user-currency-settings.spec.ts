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
  const accountExec = jest.fn();
  const accountModel = {
    findOne: jest.fn(() => ({
      session: () => ({ lean: () => ({ exec: accountExec }) }),
    })),
  };
  const updateExec = jest.fn();
  const currentExec = jest.fn();
  const userModel = {
    db: {
      model: jest.fn(() => accountModel),
      startSession: jest.fn(async () => session),
    },
    findOne: jest.fn(() => ({
      session: () => ({ lean: () => ({ exec: currentExec }) }),
    })),
    findOneAndUpdate: jest.fn(() => ({ lean: () => ({ exec: updateExec }) })),
  };
  const service = new UsersService(userModel as never);

  beforeEach(() => {
    jest.clearAllMocks();
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
      accountExec.mockResolvedValue(account);
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
