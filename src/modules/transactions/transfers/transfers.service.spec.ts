import { BadRequestException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { TransfersService } from './transfers.service';

describe('TransfersService', () => {
  const userId = new Types.ObjectId().toString();
  const sourceId = new Types.ObjectId().toString();
  const destinationId = new Types.ObjectId().toString();
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn(),
  };
  const model = { create: jest.fn() };
  const snapshots = {
    findOrCreateByAccountId: jest.fn(),
    recalculateSnapshotsFromDate: jest.fn(),
  };
  const transactions = {
    resolveActiveAccount: jest.fn(),
    lockAccounts: jest.fn(),
  };
  const service = new TransfersService(
    model as never,
    snapshots as never,
    transactions as never,
    { startSession: jest.fn(async () => session) } as never,
  );
  const dto = {
    sourceAccountId: sourceId,
    destinationAccountId: destinationId,
    sourceAmount: 90000,
    destinationAmount: 1000,
    transactionDate: '2026-09-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    transactions.resolveActiveAccount
      .mockResolvedValueOnce({
        userId: new Types.ObjectId(userId),
        account: { _id: new Types.ObjectId(sourceId), currency: 'RUB' },
      })
      .mockResolvedValueOnce({
        userId: new Types.ObjectId(userId),
        account: { _id: new Types.ObjectId(destinationId), currency: 'USD' },
      });
    snapshots.findOrCreateByAccountId
      .mockResolvedValueOnce({ _id: new Types.ObjectId(), amount: 100000 })
      .mockResolvedValueOnce({ _id: new Types.ObjectId(), amount: 0 });
    const transfer = {
      transactionDate: new Date(dto.transactionDate),
      source: {
        accountId: new Types.ObjectId(sourceId),
        amount: 90000,
        currency: 'RUB',
      },
      destination: {
        accountId: new Types.ObjectId(destinationId),
        amount: 1000,
        currency: 'USD',
      },
    };
    model.create.mockResolvedValue([{ toObject: () => transfer }]);
  });

  it('applies both actual cross-currency effects atomically', async () => {
    const result = await service.create(userId, dto);
    expect(transactions.lockAccounts).toHaveBeenCalledWith(
      userId,
      [sourceId, destinationId],
      session as unknown as ClientSession,
    );
    expect(snapshots.recalculateSnapshotsFromDate).toHaveBeenNthCalledWith(
      1,
      userId,
      sourceId,
      expect.anything(),
      { amount: -90000 },
      session,
    );
    expect(snapshots.recalculateSnapshotsFromDate).toHaveBeenNthCalledWith(
      2,
      userId,
      destinationId,
      expect.anything(),
      { amount: 1000 },
      session,
    );
    expect(result.effectiveRate).toEqual({
      baseCurrency: 'RUB',
      quoteCurrency: 'USD',
      rate: 1 / 90,
    });
  });

  it('rejects unequal same-currency effects without creating a record', async () => {
    transactions.resolveActiveAccount
      .mockReset()
      .mockResolvedValueOnce({
        userId: new Types.ObjectId(userId),
        account: { _id: sourceId, currency: 'RUB' },
      })
      .mockResolvedValueOnce({
        userId: new Types.ObjectId(userId),
        account: { _id: destinationId, currency: 'RUB' },
      });
    await expect(
      service.create(userId, {
        ...dto,
        sourceAmount: 1000,
        destinationAmount: 999,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects a transfer to the same account before starting a transaction', async () => {
    await expect(
      service.create(userId, { ...dto, destinationAccountId: sourceId }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
