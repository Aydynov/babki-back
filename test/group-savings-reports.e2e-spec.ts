import request from 'supertest';
import { Types } from 'mongoose';
import { PeriodReport } from '../src/modules/reports/interfaces/period-report.interface';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group savings reports HTTP', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;
  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => fixture?.close());

  const send = (path: string, body: object) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      .post(`/api/v1${path}`)
      .auth(fixture.users[0].token, { type: 'bearer' })
      .send(body);
  const report = async (group: string, query: string, yearly = false) =>
    (
      await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(
          `/api/v1/groups/${group}/reports/${yearly ? 'years' : 'months'}?${query}`,
        )
        .auth(fixture.users[0].token, { type: 'bearer' })
        .expect(200)
    ).body as PeriodReport[];
  const createGroup = async () =>
    (
      (
        await send('/groups', {
          name: 'Savings reports',
          type: 'family',
        }).expect(201)
      ).body as { id: string }
    ).id;

  it('separates archived savings and multiple balances by currency with historical openings', async () => {
    const group = await createGroup();
    const owner = { ownerType: 'group', ownerId: new Types.ObjectId(group) };
    const reserve = new Types.ObjectId();
    const included = new Types.ObjectId();
    const excluded = new Types.ObjectId();
    await fixture.connection.collection('accounts').insertMany([
      {
        ...owner,
        type: 'balance',
        currency: 'RUB',
        initialAmount: 100,
        openedAt: new Date('2024-01-01'),
      },
      {
        ...owner,
        type: 'balance',
        currency: 'RUB',
        initialAmount: 20,
        openedAt: new Date('2024-01-01'),
        archivedAt: new Date('2024-03-01'),
      },
      {
        _id: reserve,
        ...owner,
        type: 'saving',
        currency: 'RUB',
        initialAmount: 50,
        openedAt: new Date('2024-02-01'),
        archivedAt: new Date('2024-03-01'),
      },
      {
        ...owner,
        type: 'saving',
        currency: 'KWD',
        initialAmount: 0.001,
        openedAt: new Date('2024-02-01'),
        archivedAt: new Date('2024-03-01'),
      },
    ]);
    await fixture.connection.collection('expensecategories').insertMany([
      { _id: included, ...owner, name: 'Included' },
      { _id: excluded, ...owner, name: 'Excluded', isArchived: true },
    ]);
    await fixture.connection.collection('transactions').insertMany([
      {
        ...owner,
        accountId: reserve,
        type: 'income',
        currency: 'RUB',
        amount: 10,
        transactionDate: new Date('2024-02-01T00:00:00Z'),
        deletedAt: null,
      },
      {
        ...owner,
        accountId: reserve,
        type: 'expense',
        currency: 'RUB',
        amount: 5,
        category: excluded,
        transactionDate: new Date('2024-02-29T23:59:59.999Z'),
        deletedAt: null,
      },
    ]);
    const rows = await report(group, 'fromDate=2024-01-31&toDate=2024-02-01');
    expect(
      rows.map((row) => row.currencies.map((bucket) => bucket.currency)),
    ).toEqual([
      ['KWD', 'RUB'],
      ['KWD', 'RUB'],
    ]);
    expect(rows[0].currencies).toMatchObject([
      { currency: 'KWD', saving: 0, balance: 0 },
      { currency: 'RUB', saving: 0, balance: 120, incomes: 0, expenses: 0 },
    ]);
    expect(rows[1].currencies).toMatchObject([
      {
        currency: 'KWD',
        saving: 0.001,
        balance: 0,
        incomes: 0,
        expenses: 0,
        transfersIn: 0,
        transfersOut: 0,
      },
      {
        currency: 'RUB',
        saving: 55,
        balance: 120,
        incomes: 10,
        expenses: 5,
        transfersIn: 0,
        transfersOut: 0,
      },
    ]);
    const filtered = await report(
      group,
      `fromDate=2024-02-15&toDate=2024-02-15&categories=${String(included)}`,
    );
    expect(filtered[0].currencies[1]).toMatchObject({
      saving: 55,
      balance: 120,
      incomes: 10,
      expenses: 0,
      expensesByCategory: [{ categoryId: String(included), total: 0 }],
    });
    const years = await report(
      group,
      'fromDate=2023-12-31&toDate=2024-01-01',
      true,
    );
    expect(
      years[0].currencies.map((bucket) => [bucket.balance, bucket.saving]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(years[1].currencies).toEqual(rows[1].currencies);
  });
  it('reports API-created savings and keeps identical totals after archival', async () => {
    const group = await createGroup();
    const accounts: { _id: string }[] = [];
    for (const [type, currency, amount] of [
      ['balance', 'RUB', 100],
      ['balance', 'RUB', 20],
      ['saving', 'RUB', 50],
      ['saving', 'KWD', 0.001],
    ] as const) {
      accounts.push(
        (
          await send(`/groups/${group}/accounts`, {
            name: 'Shared',
            type,
            currency,
            amount,
            openedAt: '2024-02-01T00:00:00Z',
          }).expect(201)
        ).body as { _id: string },
      );
    }
    const category = (
      await send(`/groups/${group}/expense-categories`, {
        name: 'Reserve expense',
      }).expect(201)
    ).body as { _id: string };
    await send(`/groups/${group}/incomes`, {
      accountId: accounts[2]._id,
      amount: 10,
      transactionDate: '2024-02-01T00:00:00Z',
    }).expect(201);
    await send(`/groups/${group}/expenses`, {
      accountId: accounts[2]._id,
      amount: 5,
      categoryId: category._id,
      transactionDate: '2024-02-29T23:59:59.999Z',
    }).expect(201);
    const query = 'fromDate=2024-02-15&toDate=2024-02-15';
    const before = await report(group, query);
    expect(before[0].currencies).toEqual([
      {
        currency: 'KWD',
        balance: 0,
        saving: 0.001,
        incomes: 0,
        expenses: 0,
        transfersIn: 0,
        transfersOut: 0,
        expensesByCategory: [{ categoryId: category._id, total: 0 }],
      },
      {
        currency: 'RUB',
        balance: 120,
        saving: 55,
        incomes: 10,
        expenses: 5,
        transfersIn: 0,
        transfersOut: 0,
        expensesByCategory: [{ categoryId: category._id, total: 5 }],
      },
    ]);
    for (const account of accounts) {
      await send(`/groups/${group}/accounts/${account._id}/archive`, {}).expect(
        204,
      );
    }
    expect(await report(group, query)).toEqual(before);
    const yearly = await report(
      group,
      'fromDate=2024-01-01&toDate=2024-12-31',
      true,
    );
    expect(yearly[0].currencies).toEqual(before[0].currencies);
  });
});
