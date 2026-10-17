import request from 'supertest';
import { Types } from 'mongoose';
import { PeriodReport } from '../src/modules/reports/interfaces/period-report.interface';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group currency reports HTTP', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const call = (path: string) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      .get(`/api/v1${path}`)
      .auth(fixture.users[0].token, { type: 'bearer' });
  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => fixture?.close());

  it('returns empty currency periods without inventing a profile currency', async () => {
    const response = await request(
      fixture.app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/groups')
      .auth(fixture.users[0].token, { type: 'bearer' })
      .send({ name: 'Empty reports', type: 'family' })
      .expect(201);
    const group =
      (response.body as { id: string; _id: string }).id ??
      (response.body as { _id: string })._id;
    expect(
      (
        await call(
          `/groups/${group}/reports/months?fromDate=2024-01-10&toDate=2024-02-02`,
        ).expect(200)
      ).body,
    ).toEqual([
      { period: '2024-01', currencies: [] },
      { period: '2024-02', currencies: [] },
    ]);
    expect(
      (
        await call(
          `/groups/${group}/reports/years?fromDate=2023-12-31&toDate=2024-01-01`,
        ).expect(200)
      ).body,
    ).toEqual([
      { period: '2023', currencies: [] },
      { period: '2024', currencies: [] },
    ]);
  });
  const createGroup = async (name: string) => {
    const response = await request(
      fixture.app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/groups')
      .auth(fixture.users[0].token, { type: 'bearer' })
      .send({ name, type: 'family' })
      .expect(201);
    return (
      (response.body as { id?: string; _id: string }).id ??
      (response.body as { _id: string })._id
    );
  };
  const report = async (group: string, query: string, yearly = false) =>
    (
      await call(
        `/groups/${group}/reports/${yearly ? 'years' : 'months'}?${query}`,
      ).expect(200)
    ).body as PeriodReport[];

  it.each([
    ['JPY', 1],
    ['RUB', 0.01],
    ['KWD', 0.001],
  ] as const)(
    'keeps %s precision, full UTC periods and ledger opening/history',
    async (currency, unit) => {
      const group = await createGroup(currency);
      const owner = { ownerType: 'group', ownerId: new Types.ObjectId(group) };
      const accountId = new Types.ObjectId();
      await fixture.connection.collection('accounts').insertOne({
        _id: accountId,
        ...owner,
        name: currency,
        currency,
        type: 'balance',
        initialAmount: unit,
        openedAt: new Date('2024-01-15T00:00:00Z'),
      });
      const empty = await report(
        group,
        'fromDate=2023-12-10&toDate=2024-01-01',
      );
      expect(empty.map((row) => row.currencies[0].balance)).toEqual([0, unit]);
      expect(empty[0].currencies[0]).toEqual({
        currency,
        incomes: 0,
        expenses: 0,
        transfersIn: 0,
        transfersOut: 0,
        balance: 0,
        saving: 0,
        expensesByCategory: [],
      });
      const categoryId = new Types.ObjectId();
      const otherId = new Types.ObjectId();
      await fixture.connection.collection('expensecategories').insertMany([
        { _id: categoryId, ...owner, name: 'Archived food', isArchived: true },
        { _id: otherId, ...owner, name: 'Other' },
      ]);
      await fixture.connection.collection('transactions').insertMany([
        {
          ...owner,
          accountId,
          currency,
          type: 'income',
          amount: unit * 4,
          transactionDate: new Date('2024-01-31T23:59:59.999Z'),
          deletedAt: null,
        },
        {
          ...owner,
          accountId,
          currency,
          type: 'expense',
          amount: unit,
          category: categoryId,
          participantId: new Types.ObjectId(fixture.users[1].id),
          transactionDate: new Date('2024-02-01T00:00:00Z'),
          deletedAt: null,
        },
        {
          ...owner,
          accountId,
          currency,
          type: 'expense',
          amount: unit,
          category: otherId,
          transactionDate: new Date('2024-02-29T23:59:59.999Z'),
          deletedAt: null,
        },
        {
          ...owner,
          accountId,
          currency,
          type: 'expense',
          amount: unit * 100,
          category: categoryId,
          transactionDate: new Date('2024-02-10'),
          deletedAt: new Date(),
        },
      ]);
      const rows = await report(group, 'fromDate=2024-01-31&toDate=2024-02-01');
      const expected = (n: number) => Number((unit * n).toFixed(3));
      expect(rows.map((row) => Object.keys(row).sort())).toEqual([
        ['currencies', 'period'],
        ['currencies', 'period'],
      ]);
      expect(rows[0].currencies[0]).toMatchObject({
        currency,
        incomes: expected(4),
        expenses: 0,
        balance: expected(5),
      });
      expect(rows[1].currencies[0]).toMatchObject({
        currency,
        incomes: 0,
        expenses: expected(2),
        balance: expected(3),
        saving: 0,
        transfersIn: 0,
        transfersOut: 0,
      });
      const filtered = await report(
        group,
        `fromDate=2024-02-15&toDate=2024-02-15&categories=${String(categoryId)}`,
      );
      expect(filtered[0].currencies[0]).toMatchObject({
        expenses: unit,
        balance: expected(3),
        expensesByCategory: [{ categoryId: String(categoryId), total: unit }],
      });
      const years = await report(
        group,
        'fromDate=2023-12-31&toDate=2024-01-01',
        true,
      );
      expect(years.map((row) => row.period)).toEqual(['2023', '2024']);
      expect(years[1].currencies[0]).toMatchObject({
        incomes: expected(4),
        expenses: expected(2),
        balance: expected(3),
      });
      const foreign = await createGroup('Foreign');
      await call(
        `/groups/${foreign}/reports/months?fromDate=2024-01-01&toDate=2024-01-31&categories=${String(categoryId)}`,
      ).expect(404);
      expect(
        (await report(foreign, 'fromDate=2024-02-01&toDate=2024-02-29'))[0]
          .currencies,
      ).toEqual([]);
    },
  );

  it('rejects reversed and excessive periods and defaults to the current UTC year', async () => {
    const group = await createGroup('Calendar');
    await call(
      `/groups/${group}/reports/months?fromDate=2024-02-01&toDate=2024-01-31`,
    ).expect(400);
    await call(
      `/groups/${group}/reports/years?fromDate=1900-01-01&toDate=2024-01-01`,
    ).expect(400);
    const rows = await report(group, '');
    expect(rows[0].period).toBe(`${new Date().getUTCFullYear()}-01`);
    expect(rows).toHaveLength(new Date().getUTCMonth() + 1);
    expect(rows.every((row) => row.currencies.length === 0)).toBe(true);
  });

  it('keeps former participants and archived categories through the public lifecycle', async () => {
    const group = await createGroup('Historical members');
    const send = (
      method: 'post' | 'patch',
      path: string,
      body: object,
      user = 0,
    ) =>
      request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
        [method](`/api/v1${path}`)
        .auth(fixture.users[user].token, { type: 'bearer' })
        .send(body);
    const account = (
      await send('post', `/groups/${group}/accounts`, {
        name: 'KWD wallet',
        currency: 'KWD',
        amount: 0.001,
        openedAt: '2024-01-01T00:00:00Z',
      }).expect(201)
    ).body as { _id: string };
    const category = (
      await send('post', `/groups/${group}/expense-categories`, {
        name: 'Historical',
      }).expect(201)
    ).body as { _id: string };
    const invite = (
      await send('post', `/groups/${group}/invitations`, {}).expect(201)
    ).body as { token: string };
    await send(
      'post',
      '/group-invitations/accept',
      { token: invite.token },
      1,
    ).expect(200);
    await send('post', `/groups/${group}/incomes`, {
      accountId: account._id,
      amount: 0.002,
      transactionDate: '2024-01-31T23:59:59.999Z',
    }).expect(201);
    const expense = (
      await send(
        'post',
        `/groups/${group}/expenses`,
        {
          accountId: account._id,
          categoryId: category._id,
          amount: 0.001,
          transactionDate: '2024-02-01T00:00:00Z',
        },
        1,
      ).expect(201)
    ).body as { _id: string };
    await send('post', `/groups/${group}/leave`, {}, 1).expect(204);
    await send('patch', `/groups/${group}/expense-categories/${category._id}`, {
      isArchived: true,
    }).expect(200);
    const rows = await report(
      group,
      `fromDate=2024-01-01&toDate=2024-02-29&categories=${category._id}`,
    );
    expect(rows[0].currencies[0]).toMatchObject({
      currency: 'KWD',
      incomes: 0.002,
      balance: 0.003,
    });
    expect(rows[1].currencies[0]).toMatchObject({
      currency: 'KWD',
      expenses: 0.001,
      balance: 0.002,
      expensesByCategory: [{ categoryId: category._id, total: 0.001 }],
    });
    await request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      .delete(`/api/v1/groups/${group}/expenses/${expense._id}`)
      .auth(fixture.users[0].token, { type: 'bearer' })
      .expect(204);
    expect(
      (await report(group, 'fromDate=2024-02-01&toDate=2024-02-29'))[0]
        .currencies[0],
    ).toMatchObject({ expenses: 0, balance: 0.003 });
  });

  it('sorts transaction currencies without combining other groups or personal records', async () => {
    const group = await createGroup('Currency union');
    const foreign = await createGroup('Another budget');
    const base = {
      type: 'income',
      transactionDate: new Date('2024-01-01'),
      deletedAt: null,
    };
    await fixture.connection.collection('transactions').insertMany([
      {
        ...base,
        ownerType: 'group',
        ownerId: new Types.ObjectId(group),
        currency: 'RUB',
        amount: 1.23,
      },
      {
        ...base,
        ownerType: 'group',
        ownerId: new Types.ObjectId(group),
        currency: 'KWD',
        amount: 0.001,
      },
      {
        ...base,
        ownerType: 'group',
        ownerId: new Types.ObjectId(foreign),
        currency: 'JPY',
        amount: 100,
      },
      {
        ...base,
        ownerType: 'user',
        ownerId: new Types.ObjectId(fixture.users[0].id),
        userId: new Types.ObjectId(fixture.users[0].id),
        currency: 'JPY',
        amount: 200,
      },
    ]);
    const rows = await report(group, 'fromDate=2024-01-01&toDate=2024-01-31');
    expect(
      rows[0].currencies.map((currency) => [
        currency.currency,
        currency.incomes,
        currency.balance,
      ]),
    ).toEqual([
      ['KWD', 0.001, 0],
      ['RUB', 1.23, 0],
    ]);
    expect(
      (await report(foreign, 'fromDate=2024-01-01&toDate=2024-01-31'))[0]
        .currencies,
    ).toEqual([
      {
        currency: 'JPY',
        incomes: 100,
        expenses: 0,
        transfersIn: 0,
        transfersOut: 0,
        balance: 0,
        saving: 0,
        expensesByCategory: [],
      },
    ]);
  });
});
