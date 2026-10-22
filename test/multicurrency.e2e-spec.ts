import request, { Response } from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Sole-member space multicurrency finances (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let spaceId: string;
  const financialPath = (path: string) => `/api/v1/spaces/${spaceId}${path}`;
  const server = () =>
    harness.app.getHttpServer() as Parameters<typeof request>[0];
  const api = (user = 0) => ({
    get: (path: string) =>
      request(server())
        .get(financialPath(path))
        .auth(harness.users[user].token, { type: 'bearer' }),
    post: (path: string, body: object = {}) =>
      request(server())
        .post(financialPath(path))
        .auth(harness.users[user].token, { type: 'bearer' })
        .send(body),
    patch: (path: string, body: object = {}) =>
      request(server())
        .patch(financialPath(path))
        .auth(harness.users[user].token, { type: 'bearer' })
        .send(body),
    delete: (path: string) =>
      request(server())
        .delete(financialPath(path))
        .auth(harness.users[user].token, { type: 'bearer' }),
  });
  const idOf = (response: Response) =>
    (
      response.body as {
        _id: string;
      }
    )._id;
  async function account(
    name: string,
    type: 'balance' | 'saving',
    currency: 'RUB' | 'USD',
    amount = 0,
  ) {
    return idOf(
      await api()
        .post('/accounts', {
          name,
          type,
          currency,
          amount,
          openedAt: '2026-01-01',
        })
        .expect(201),
    );
  }
  beforeAll(async () => {
    harness = await startSpacesTestApp();
  }, 60000);
  beforeEach(async () => {
    const created = await request(
      harness.app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/spaces')
      .auth(harness.users[0].token, { type: 'bearer' })
      .send({ name: 'Sole-member regression space' })
      .expect(201);
    spaceId = (created.body as { id: string }).id;
  });

  afterAll(async () => {
    await harness?.close();
  }, 30000);
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
      (
        created.body as {
          effectiveRate: {
            rate: number;
          };
        }
      ).effectiveRate.rate,
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
