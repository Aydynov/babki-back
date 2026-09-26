import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal multicurrency finances (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const oid = (value: string) => new Types.ObjectId(value);
  const collection = (name: string) => harness.connection.collection(name);
  const server = () =>
    harness.app.getHttpServer() as Parameters<typeof request>[0];
  const api = (user = 0) => ({
    get: (path: string) =>
      request(server())
        .get(`/api/v1${path}`)
        .auth(harness.users[user].token, { type: 'bearer' }),
    post: (path: string, body: object = {}) =>
      request(server())
        .post(`/api/v1${path}`)
        .auth(harness.users[user].token, { type: 'bearer' })
        .send(body),
    patch: (path: string, body: object = {}) =>
      request(server())
        .patch(`/api/v1${path}`)
        .auth(harness.users[user].token, { type: 'bearer' })
        .send(body),
    delete: (path: string) =>
      request(server())
        .delete(`/api/v1${path}`)
        .auth(harness.users[user].token, { type: 'bearer' }),
  });
  const idOf = (response: Response) => (response.body as { _id: string })._id;

  async function account(
    name: string,
    type: 'balance' | 'saving',
    currency: 'RUB' | 'USD',
    amount = 0,
  ) {
    return idOf(
      await api()
        .post('/accounts', { name, type, currency, amount })
        .expect(201),
    );
  }

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);

  beforeEach(async () => {
    const userId = oid(harness.users[0].id);
    await collection('transactions').deleteMany({
      ownerType: 'user',
      ownerId: userId,
    });
    await collection('accountsnapshots').deleteMany({});
    await collection('accounts').deleteMany({
      ownerType: 'user',
      ownerId: userId,
    });
    await collection('expenselimits').deleteMany({ ownerId: userId });
    await collection('plans').deleteMany({ userId });
    await collection('debts').deleteMany({ userId });
    await collection('debttransactions').deleteMany({ userId });
    await collection('expensecategories').deleteMany({ ownerId: userId });
    await collection('users').updateOne(
      { _id: userId },
      { $set: { defaultCurrency: 'USD', defaultAccountId: null } },
    );
  });

  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('manages multiple named accounts and consistent profile defaults', async () => {
    const firstUsd = await account('USD main', 'balance', 'USD');
    const secondUsd = await account('USD travel', 'balance', 'USD');
    const rub = await account('RUB main', 'balance', 'RUB');
    await account('USD reserve', 'saving', 'USD');
    await account('USD second reserve', 'saving', 'USD');

    await api()
      .post('/incomes', {
        accountId: firstUsd,
        amount: 10,
        transactionDate: '2026-09-01',
      })
      .expect(201);
    await api()
      .post('/incomes', {
        accountId: rub,
        amount: 100,
        transactionDate: '2026-09-01',
      })
      .expect(201);
    const revenue = (await api().get('/incomes/revenue').expect(200)).body as {
      totalRevenue: number | null;
      currencies: Array<{ currency: string; totalRevenue: number }>;
    };
    expect(revenue.totalRevenue).toBeNull();
    expect(revenue.currencies).toEqual(
      expect.arrayContaining([
        { currency: 'RUB', totalRevenue: 100 },
        { currency: 'USD', totalRevenue: 10 },
      ]),
    );

    expect((await api().get('/users/me').expect(200)).body).toMatchObject({
      defaultCurrency: 'USD',
      defaultAccountId: firstUsd,
    });
    expect(
      (await api().get('/accounts?currency=USD').expect(200)).body,
    ).toHaveLength(4);
    await api()
      .patch(`/accounts/${secondUsd}`, { currency: 'RUB' })
      .expect(400);

    await api().patch('/users/me', { defaultCurrency: 'rub' }).expect(200);
    expect((await api().get('/users/me').expect(200)).body).toMatchObject({
      defaultCurrency: 'RUB',
      defaultAccountId: null,
    });
    await api()
      .patch('/users/me', { defaultCurrency: 'RUB', defaultAccountId: rub })
      .expect(200);
    await api()
      .patch('/users/me', {
        defaultCurrency: 'USD',
        defaultAccountId: secondUsd,
      })
      .expect(200);
    await api().patch('/users/me', { defaultCurrency: 'ZZZ' }).expect(400);

    await api().post(`/accounts/${secondUsd}/archive`).expect(204);
    expect((await api().get('/users/me').expect(200)).body).toMatchObject({
      defaultCurrency: 'USD',
      defaultAccountId: null,
    });
    await api()
      .post('/incomes', {
        accountId: secondUsd,
        amount: 1,
        transactionDate: '2026-09-01',
      })
      .expect(404);
    await api(1).get(`/accounts/${firstUsd}`).expect(404);
    await api(1)
      .post('/incomes', {
        accountId: firstUsd,
        amount: 1,
        transactionDate: '2026-09-01',
      })
      .expect(404);
  });

  it('keeps a cross-currency transfer atomic, editable and reversible', async () => {
    const rub = await account('RUB main', 'balance', 'RUB');
    const usd = await account('USD reserve', 'saving', 'USD');
    const otherRub = await account('RUB reserve', 'saving', 'RUB');
    await api()
      .post('/incomes', {
        accountId: rub,
        amount: 100000,
        transactionDate: '2026-09-01',
      })
      .expect(201);

    await api()
      .post('/transfers', {
        sourceAccountId: rub,
        destinationAccountId: otherRub,
        sourceAmount: 1000,
        destinationAmount: 999,
        transactionDate: '2026-09-05',
      })
      .expect(400);
    await api()
      .post('/transfers', {
        sourceAccountId: rub,
        destinationAccountId: usd,
        sourceAmount: 100001,
        destinationAmount: 1000,
        transactionDate: '2026-09-10',
      })
      .expect(400);

    const created = await api()
      .post('/transfers', {
        sourceAccountId: rub,
        destinationAccountId: usd,
        sourceAmount: 90000,
        destinationAmount: 1000,
        transactionDate: '2026-09-10',
        description: 'Exchange RUB to USD',
      })
      .expect(201);
    const transferId = idOf(created);
    expect(created.body).toMatchObject({
      source: { accountId: rub, amount: 90000, currency: 'RUB' },
      destination: { accountId: usd, amount: 1000, currency: 'USD' },
      effectiveRate: {
        baseCurrency: 'RUB',
        quoteCurrency: 'USD',
      },
    });
    expect(
      (created.body as { effectiveRate: { rate: number } }).effectiveRate.rate,
    ).toBeCloseTo(1 / 90);
    expect(
      (await api().get(`/transfers/${transferId}`).expect(200)).body,
    ).toMatchObject({
      effectiveRate: {
        baseCurrency: 'RUB',
        quoteCurrency: 'USD',
      },
    });
    expect(
      (await api().get(`/transactions?accountId=${usd}`).expect(200)).body,
    ).toMatchObject({ total: 1 });
    expect(
      (await api().get(`/accounts/${rub}`).expect(200)).body,
    ).toMatchObject({
      amount: 10000,
    });
    expect(
      (await api().get(`/accounts/${usd}`).expect(200)).body,
    ).toMatchObject({
      amount: 1000,
    });

    const report = await api()
      .get('/reports/months?fromDate=2026-09-01&toDate=2026-09-30')
      .expect(200);
    const september = (
      report.body as Array<{
        period: string;
        currencies: Array<Record<string, number | string>>;
      }>
    ).find(({ period }) => period === '2026-09');
    expect(september?.currencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'RUB',
          incomes: 100000,
          expenses: 0,
          transfersOut: 90000,
          transfersIn: 0,
          balance: 10000,
        }),
        expect.objectContaining({
          currency: 'USD',
          incomes: 0,
          expenses: 0,
          transfersOut: 0,
          transfersIn: 1000,
          saving: 1000,
        }),
      ]),
    );

    const updated = await api()
      .patch(`/transfers/${transferId}`, {
        sourceAmount: 94500,
        destinationAmount: 1000,
        description: 'Updated exchange',
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      source: { amount: 94500 },
      destination: { amount: 1000 },
      description: 'Updated exchange',
    });
    expect(
      (await api().get(`/accounts/${rub}`).expect(200)).body,
    ).toMatchObject({
      amount: 5500,
    });

    const deletions = await Promise.all([
      api().delete(`/transfers/${transferId}`),
      api().delete(`/transfers/${transferId}`),
    ]);
    expect(deletions.map(({ status }) => status).sort()).toEqual([204, 404]);
    expect(
      (await api().get(`/accounts/${rub}`).expect(200)).body,
    ).toMatchObject({
      amount: 100000,
    });
    expect(
      (await api().get(`/accounts/${usd}`).expect(200)).body,
    ).toMatchObject({
      amount: 0,
    });
  });

  it('isolates limits, plans and debts by declared currency', async () => {
    const rub = await account('RUB main', 'balance', 'RUB', 1000);
    const usd = await account('USD main', 'balance', 'USD', 1000);
    const categoryId = idOf(
      await api().post('/expense-categories', { name: 'Travel' }).expect(201),
    );
    await api()
      .post('/expense-limits', {
        categoryId,
        currency: 'RUB',
        total: 500,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      })
      .expect(201);
    await api()
      .post('/expense-limits', {
        categoryId,
        currency: 'USD',
        total: 500,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      })
      .expect(201);
    await api()
      .post('/expenses', {
        accountId: usd,
        categoryId,
        amount: 100,
        transactionDate: '2026-09-10',
      })
      .expect(201);
    const limits = await api()
      .get('/expense-limits?periodDate=2026-09-10')
      .expect(200);
    expect(limits.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'RUB', rest: 500 }),
        expect.objectContaining({ currency: 'USD', rest: 400 }),
      ]),
    );

    const planId = idOf(
      await api()
        .post('/plans', {
          categoryId,
          currency: 'USD',
          description: 'USD trip',
          amount: 100,
          targetDate: '2026-10-01',
        })
        .expect(201),
    );
    await api()
      .post(`/plans/${planId}/close`, {
        accountId: rub,
        closingDate: '2026-09-15',
      })
      .expect(400);

    const debtId = idOf(
      await api()
        .post('/debts', {
          currency: 'USD',
          debtor: 'Friend',
          principalAmount: 100,
          remainingAmount: 100,
        })
        .expect(201),
    );
    await api()
      .post(`/debts/${debtId}/repayments`, {
        accountId: rub,
        amount: 25,
        repaymentDate: '2026-09-15',
        isIncome: true,
      })
      .expect(400);
    expect(
      (await api().get(`/plans/${planId}`).expect(200)).body,
    ).toMatchObject({
      status: 'active',
    });
    expect(
      (await api().get(`/debts/${debtId}`).expect(200)).body,
    ).toMatchObject({
      remainingAmount: 100,
    });
  });
});
