import { ServiceUnavailableException } from '@nestjs/common';
import { SpacesService } from '../src/modules/spaces/spaces.service';
import { SpaceWalletService } from '../src/modules/space-finances/space-wallet.service';
import { SpaceTransfersService } from '../src/modules/space-finances/space-transfers.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { spaceBudget } from '../src/common/budget/budget-context';
import { Account } from '../src/modules/accounts/schemas/accounts.schema';
import {
  AccountsSnapshotsService,
  utcMonthEnd,
} from '../src/modules/accounts-snapshots/accounts-snapshots.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Space transfer ledger and reports (real replica set)', () => {
  let fixture: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let snapshots: AccountsSnapshotsService;
  let reports: ReportsService;
  let accounts: Model<Account>;
  const date = new Date('2024-01-31T23:59:59.999Z');
  beforeAll(async () => {
    fixture = await startSpacesTestApp();
    snapshots = fixture.app.get(AccountsSnapshotsService);
    reports = fixture.app.get(ReportsService);
    accounts = fixture.app.get<Model<Account>>(getModelToken(Account.name));
  }, 60000);
  afterAll(async () => {
    await fixture?.close();
  });
  async function scenario(
    sourceCurrency = 'USD',
    destinationCurrency = 'USD',
    sourceType: Account['type'] = 'balance',
    destinationType: Account['type'] = 'saving',
    initialAmount = 1000,
    sourceAmount = 100,
    destinationAmount = 100,
  ) {
    const budget = spaceBudget(new Types.ObjectId().toString());
    const [source, destination] = await accounts.create([
      {
        ...budget,
        name: 'Source',
        type: sourceType,
        currency: sourceCurrency,
        initialAmount,
        openedAt: new Date('2024-01-01T00:00:00Z'),
      },
      {
        ...budget,
        name: 'Destination',
        type: destinationType,
        currency: destinationCurrency,
        initialAmount: 0,
        openedAt: new Date('2024-01-01T00:00:00Z'),
      },
    ]);
    const transfer = {
      ...budget,
      createdBy: new Types.ObjectId(fixture.users[0].id),
      type: 'transfer',
      transactionDate: date,
      source: {
        accountId: source._id,
        snapshotId: new Types.ObjectId(),
        currency: sourceCurrency,
        amount: sourceAmount,
      },
      destination: {
        accountId: destination._id,
        snapshotId: new Types.ObjectId(),
        currency: destinationCurrency,
        amount: destinationAmount,
      },
    };
    const inserted = await fixture.connection
      .collection('transactions')
      .insertOne(transfer);
    return {
      budget,
      source: source.toObject(),
      destination: destination.toObject(),
      id: inserted.insertedId,
    };
  }
  it('applies each same-currency side once and reports monthly/yearly movements without income or expense', async () => {
    const { budget, source, destination } = await scenario('RUB', 'RUB');
    expect(await snapshots.balanceForBudget(source, date)).toBe(900);
    expect(await snapshots.balanceForBudget(destination, date)).toBe(100);
    for (const grouping of ['month', 'year'] as const) {
      const rows = await reports.reportForBudget(
        budget,
        [{ period: grouping === 'month' ? '2024-01' : '2024', endDate: date }],
        grouping,
        [],
        false,
      );
      expect(rows[0].currencies).toEqual([
        {
          currency: 'RUB',
          balance: 900,
          saving: 100,
          incomes: 0,
          expenses: 0,
          transfersIn: 100,
          transfersOut: 100,
          expensesByCategory: [],
        },
      ]);
    }
  });
  it('keeps cross-currency amounts in their own buckets despite category filtering', async () => {
    const { budget, source, destination } = await scenario(
      'RUB',
      'USD',
      'balance',
      'saving',
      90000,
      90000,
      1000,
    );
    expect(await snapshots.balanceForBudget(source, date)).toBe(0);
    expect(await snapshots.balanceForBudget(destination, date)).toBe(1000);
    const categoryId = new Types.ObjectId().toString();
    const rows = await reports.reportForBudget(
      budget,
      [{ period: '2024-01', endDate: date }],
      'month',
      [categoryId],
      true,
    );
    expect(rows[0].currencies).toEqual([
      {
        currency: 'RUB',
        balance: 0,
        saving: 0,
        incomes: 0,
        expenses: 0,
        transfersIn: 0,
        transfersOut: 90000,
        expensesByCategory: [{ categoryId, total: 0 }],
      },
      {
        currency: 'USD',
        balance: 0,
        saving: 1000,
        incomes: 0,
        expenses: 0,
        transfersIn: 1000,
        transfersOut: 0,
        expensesByCategory: [{ categoryId, total: 0 }],
      },
    ]);
  });
  it.each(['balance', 'saving'] as const)(
    'counts both movements for %s to same-type transfers',
    async (type) => {
      const { budget } = await scenario('USD', 'USD', type, type);
      const rows = await reports.reportForBudget(
        budget,
        [{ period: '2024-01', endDate: date }],
        'month',
        [],
        false,
      );
      expect(rows[0].currencies[0]).toMatchObject({
        balance: type === 'balance' ? 1000 : 0,
        saving: type === 'saving' ? 1000 : 0,
        transfersIn: 100,
        transfersOut: 100,
        incomes: 0,
        expenses: 0,
      });
    },
  );
  it('honors UTC boundaries, opening dates, currency precision and unchanged ordinary income/expense effects', async () => {
    const { budget, source, destination } = await scenario(
      'USD',
      'USD',
      'balance',
      'saving',
      1000.3,
      100.1,
      100.1,
    );
    expect(
      await snapshots.balanceForBudget(
        source,
        new Date('2023-12-31T23:59:59.999Z'),
      ),
    ).toBe(0);
    expect(
      await snapshots.balanceForBudget(source, new Date(date.getTime() - 1)),
    ).toBe(1000.3);
    expect(await snapshots.balanceForBudget(source, date)).toBe(900.2);
    await fixture.connection.collection('transactions').insertMany([
      {
        ...budget,
        type: 'income',
        accountId: source._id,
        amount: 10.1,
        transactionDate: date,
      },
      {
        ...budget,
        type: 'expense',
        accountId: source._id,
        amount: 0.2,
        transactionDate: date,
      },
      {
        ...budget,
        type: 'income',
        accountId: destination._id,
        amount: 999,
        transactionDate: new Date('2024-02-01T00:00:00Z'),
      },
      {
        ...spaceBudget(new Types.ObjectId().toString()),
        type: 'income',
        accountId: source._id,
        amount: 999,
        transactionDate: date,
      },
    ]);
    expect(await snapshots.balanceForBudget(source, date)).toBe(910.1);
    expect(await snapshots.balanceForBudget(destination, date)).toBe(100.1);
  });
  it('rebuilds later snapshots after backdated edits and excludes deletion while retaining archived history', async () => {
    const { budget, source, destination, id } = await scenario();
    const february = utcMonthEnd(new Date('2024-02-10'));
    const session = await fixture.connection.startSession();
    try {
      await session.withTransaction(async () => {
        for (const account of [source, destination])
          await snapshots.rebuildForBudget(account, february, session);
      });
      await fixture.connection
        .collection('accounts')
        .updateMany(
          { spaceId: budget.spaceId },
          { $set: { archivedAt: new Date('2024-03-01') } },
        );
      await fixture.connection
        .collection('transactions')
        .updateOne(
          { _id: id },
          { $set: { 'source.amount': 120, 'destination.amount': 120 } },
        );
      await session.withTransaction(async () => {
        for (const account of [source, destination])
          await snapshots.rebuildForBudget(account, date, session);
      });
      for (const [account, amount] of [
        [source, 880],
        [destination, 120],
      ] as const) {
        expect(await snapshots.timelineForBudget(account._id)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ date, amount }),
            expect.objectContaining({ date: february, amount }),
          ]),
        );
      }
      const active = await reports.reportForBudget(
        budget,
        [{ period: '2024-01', endDate: date }],
        'month',
        [],
        false,
      );
      expect(active[0].currencies[0]).toMatchObject({
        balance: 880,
        saving: 120,
        transfersIn: 120,
        transfersOut: 120,
      });
      await fixture.connection
        .collection('transactions')
        .updateOne(
          { _id: id },
          { $set: { deletedAt: new Date('2024-03-02') } },
        );
      await session.withTransaction(async () => {
        for (const account of [source, destination])
          await snapshots.rebuildForBudget(account, date, session);
      });
      expect(await snapshots.balanceForBudget(source, february)).toBe(1000);
      expect(await snapshots.balanceForBudget(destination, february)).toBe(0);
      const removed = await reports.reportForBudget(
        budget,
        [{ period: '2024-01', endDate: date }],
        'month',
        [],
        false,
      );
      expect(removed[0].currencies[0]).toMatchObject({
        balance: 1000,
        saving: 0,
        transfersIn: 0,
        transfersOut: 0,
      });
    } finally {
      await session.endSession();
    }
  });
  it.each(['create', 'update', 'delete'] as const)(
    'rolls back the record and both snapshot chains if the second %s effect fails',
    async (operation) => {
      const actor = fixture.users[0].id;
      const space = await fixture.app.get(SpacesService).create(actor, {
        name: `Rollback ${operation}`,
      });
      const wallets = fixture.app.get(SpaceWalletService);
      const transfers = fixture.app.get(SpaceTransfersService);
      const source = await wallets.create(space.id, actor, {
        name: 'Source',
        currency: 'USD',
        amount: 1000,
        openedAt: '2024-01-01T00:00:00Z',
      });
      const destination = await wallets.create(space.id, actor, {
        name: 'Destination',
        type: 'saving',
        currency: 'USD',
        amount: 0,
        openedAt: '2024-01-01T00:00:00Z',
      });
      const dto = {
        sourceAccountId: String(source._id),
        destinationAccountId: String(destination._id),
        sourceAmount: 100,
        destinationAmount: 100,
        transactionDate: date.toISOString(),
      };
      const transfer =
        operation === 'create'
          ? undefined
          : await transfers.create(space.id, actor, dto);
      const budget = spaceBudget(space.id);
      const readState = async () => ({
        transactions: await fixture.connection
          .collection('transactions')
          .find(budget)
          .sort({ _id: 1 })
          .toArray(),
        accounts: await fixture.connection
          .collection('accounts')
          .find(budget)
          .sort({ _id: 1 })
          .toArray(),
        snapshots: await fixture.connection
          .collection('accountsnapshots')
          .find({ accountId: { $in: [source._id, destination._id] } })
          .sort({ _id: 1 })
          .toArray(),
      });
      const before = await readState();
      const apply = snapshots.applyForBudget.bind(
        snapshots,
      ) as AccountsSnapshotsService['applyForBudget'];
      let effects = 0;
      const failure = jest
        .spyOn(snapshots, 'applyForBudget')
        .mockImplementation(async (...args) => {
          effects += 1;
          if (effects === 2) throw new Error('Injected second-account failure');
          return await apply(...args);
        });
      try {
        await expect(
          operation === 'create'
            ? transfers.create(space.id, actor, dto)
            : transfers.change(
                space.id,
                actor,
                String(transfer!._id),
                operation === 'update'
                  ? { sourceAmount: 120, destinationAmount: 120 }
                  : undefined,
              ),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(effects).toBe(2);
      } finally {
        failure.mockRestore();
      }
      expect(await readState()).toEqual(before);
      expect(
        (await wallets.get(space.id, actor, String(source._id))).amount,
      ).toBe(operation === 'create' ? 1000 : 900);
      expect(
        (await wallets.get(space.id, actor, String(destination._id))).amount,
      ).toBe(operation === 'create' ? 0 : 100);
    },
  );
});
