import { BadRequestException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { TransfersService } from './transfers.service';
describe('TransfersService', () => {
  const userId = new Types.ObjectId().toString();
  const budget = { spaceId: new Types.ObjectId(userId) };
  const sourceId = new Types.ObjectId().toString();
  const destinationId = new Types.ObjectId().toString();
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn(),
  };
  const model = { create: jest.fn() };
  const snapshots = {
    balanceForBudget: jest.fn().mockResolvedValue(100000),
    prepareForBudget: jest.fn(),
    applyForBudget: jest.fn(),
  };
  const transactions = {
    runForBudget: jest.fn(
      async (
        _budget: unknown,
        _actor: string,
        work: (session: ClientSession) => Promise<unknown>,
      ) => work(session as unknown as ClientSession),
    ),
    accountForCreate: jest.fn(),
    lockAccountsForBudget: jest.fn(),
  };
  const service = new TransfersService(
    model as never,
    snapshots as never,
    transactions as never,
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
    transactions.accountForCreate
      .mockResolvedValueOnce({
        _id: new Types.ObjectId(sourceId),
        currency: 'RUB',
      })
      .mockResolvedValueOnce({
        _id: new Types.ObjectId(destinationId),
        currency: 'USD',
      });
    snapshots.prepareForBudget
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
    const result = await service.createForBudget(
      budget,
      userId,
      dto,
      session as never,
    );
    expect(transactions.lockAccountsForBudget).toHaveBeenCalledWith(
      {
        spaceId: new Types.ObjectId(userId),
      },
      [sourceId, destinationId],
      session as unknown as ClientSession,
    );
    expect(snapshots.applyForBudget).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: new Types.ObjectId(sourceId) }),
      new Date(dto.transactionDate),
      -90000,
      session,
    );
    expect(snapshots.applyForBudget).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: new Types.ObjectId(destinationId) }),
      new Date(dto.transactionDate),
      1000,
      session,
    );
    expect(result.effectiveRate).toEqual({
      baseCurrency: 'RUB',
      quoteCurrency: 'USD',
      rate: 1 / 90,
    });
  });
  it('rejects unequal same-currency effects without creating a record', async () => {
    transactions.accountForCreate
      .mockReset()
      .mockResolvedValueOnce({
        _id: sourceId,
        currency: 'RUB',
      })
      .mockResolvedValueOnce({
        _id: destinationId,
        currency: 'RUB',
      });
    await expect(
      service.createForBudget(
        budget,
        userId,
        {
          ...dto,
          sourceAmount: 1000,
          destinationAmount: 999,
        },
        session as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });
  it('rejects a transfer to the same account before starting a transaction', async () => {
    await expect(
      service.createForBudget(
        budget,
        userId,
        { ...dto, destinationAccountId: sourceId },
        session as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
describe('TransfersService budget mutations', () => {
  const budget = { spaceId: new Types.ObjectId() };
  const actor = new Types.ObjectId().toString();
  const source = { _id: new Types.ObjectId(), ...budget, currency: 'RUB' };
  const destination = { _id: new Types.ObjectId(), ...budget, currency: 'USD' };
  const session = {} as ClientSession;
  const dto = {
    sourceAccountId: String(source._id),
    destinationAccountId: String(destination._id),
    sourceAmount: 100,
    destinationAmount: 1,
    transactionDate: '2026-09-10',
  };
  const snapshots = {
    prepareForBudget: jest.fn(),
    balanceForBudget: jest.fn(),
    applyForBudget: jest.fn(),
  };
  const transactions = {
    lockAccountsForBudget: jest.fn(),
    accountForCreate: jest.fn(),
    accountForBudget: jest.fn(),
  };
  const model = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const stored = {
    _id: new Types.ObjectId(),
    ...budget,
    createdBy: new Types.ObjectId(actor),
    transactionDate: new Date(dto.transactionDate),
    source: { accountId: source._id, amount: 100, currency: 'RUB' },
    destination: { accountId: destination._id, amount: 1, currency: 'USD' },
  };
  const service = new TransfersService(
    model as never,
    snapshots as never,
    transactions as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    transactions.accountForBudget
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(destination);
    model.findOne.mockReturnValue({
      session: () => ({ lean: () => ({ exec: async () => stored }) }),
    });
    model.findOneAndUpdate.mockImplementation(
      (
        _filter: object,
        changes: {
          $set: Record<string, unknown>;
        },
      ) => {
        const updated = {
          ...stored,
          source: {
            ...stored.source,
            amount: changes.$set['source.amount'] ?? 100,
          },
          destination: {
            ...stored.destination,
            amount: changes.$set['destination.amount'] ?? 1,
          },
        };
        return {
          then: (resolve: (value: object) => void) => resolve(updated),
          lean: () => ({ exec: async () => updated }),
        };
      },
    );
    transactions.accountForCreate
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(destination);
    snapshots.balanceForBudget.mockResolvedValue(100);
    snapshots.prepareForBudget.mockResolvedValue({ _id: new Types.ObjectId() });
    model.create.mockImplementation((rows: object[]) =>
      Promise.resolve([
        {
          toObject: () => ({
            ...rows[0],
            transactionDate: new Date(dto.transactionDate),
          }),
        },
      ]),
    );
  });
  it('creates one budget-owned transfer with server actor and both effects in the supplied session', async () => {
    const result = await service.createForBudget(budget, actor, dto, session);
    expect(result).toMatchObject({
      ...budget,
      createdBy: new Types.ObjectId(actor),
      source: { amount: 100 },
      destination: { amount: 1 },
      effectiveRate: { rate: 0.01 },
    });
    expect(snapshots.balanceForBudget).toHaveBeenCalledWith(
      source,
      new Date(dto.transactionDate),
      session,
    );
    expect(snapshots.applyForBudget).toHaveBeenNthCalledWith(
      1,
      source,
      new Date(dto.transactionDate),
      -100,
      session,
    );
    expect(snapshots.applyForBudget).toHaveBeenNthCalledWith(
      2,
      destination,
      new Date(dto.transactionDate),
      1,
      session,
    );
  });
  it('rejects the same space account when ObjectId hex casing differs', async () => {
    await expect(
      service.createForBudget(
        budget,
        actor,
        { ...dto, destinationAccountId: dto.sourceAccountId.toUpperCase() },
        session,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactions.lockAccountsForBudget).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });
  it('rejects insufficient historical funds before creating snapshots or a transfer', async () => {
    snapshots.balanceForBudget.mockResolvedValue(99.99);
    await expect(
      service.createForBudget(budget, actor, dto, session),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(snapshots.prepareForBudget).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });
  it.each([0, -1, 0.0001, Infinity, NaN, 1.001])(
    'rejects invalid space source amount %s',
    async (sourceAmount) => {
      await expect(
        service.createForBudget(
          budget,
          actor,
          { ...dto, sourceAmount },
          session,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    },
  );
  it('only requires the normalized extra debit and saves before rebuilding both sides', async () => {
    snapshots.balanceForBudget.mockResolvedValue(0.01);
    await service.updateForBudget(
      budget,
      String(stored._id),
      { sourceAmount: 100.01 },
      session,
    );
    expect(snapshots.balanceForBudget).toHaveBeenCalledWith(
      source,
      stored.transactionDate,
      session,
    );
    expect(snapshots.applyForBudget).toHaveBeenNthCalledWith(
      1,
      source,
      stored.transactionDate,
      -0.01,
      session,
    );
    expect(model.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      snapshots.applyForBudget.mock.invocationCallOrder[0],
    );
  });
  it.each([{ sourceAmount: 99 }, { description: 'Historical correction' }])(
    'does not recheck funds for reduction or description only: %p',
    async (changes) => {
      await service.updateForBudget(
        budget,
        String(stored._id),
        changes,
        session,
      );
      expect(snapshots.balanceForBudget).not.toHaveBeenCalled();
    },
  );
  it('marks cancellation before rebuilding and allows a spent destination', async () => {
    await service.deleteForBudget(budget, actor, String(stored._id), session);
    expect(snapshots.balanceForBudget).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: String(stored._id), deletedAt: null }),
      {
        $set: {
          deletedAt: expect.any(Date),
          deletedBy: new Types.ObjectId(actor),
        },
      },
      expect.objectContaining({ session }),
    );
    expect(model.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      snapshots.applyForBudget.mock.invocationCallOrder[0],
    );
    expect(snapshots.applyForBudget).toHaveBeenNthCalledWith(
      2,
      destination,
      stored.transactionDate,
      -1,
      session,
    );
  });
});
