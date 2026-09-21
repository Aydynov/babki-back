import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group finances boundary contracts', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let base: string;
  let accountId: string;
  let categoryId: string;
  const idOf = (response: Response) => {
    const body = response.body as { id?: string; _id?: string };
    return (body.id ?? body._id)!;
  };
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(fixture.users[0].token, { type: 'bearer' });
  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await fixture?.close();
  });
  beforeEach(async () => {
    const group = await call('post', '/groups')
      .send({ name: 'Boundary', type: 'family' })
      .expect(201);
    base = `/groups/${idOf(group)}`;
    accountId = idOf(
      await call('post', `${base}/accounts`)
        .send({ amount: 0.3, openedAt: '2024-01-01T00:00:00Z' })
        .expect(201),
    );
    categoryId = idOf(
      await call('post', `${base}/expense-categories`)
        .send({ name: 'Food' })
        .expect(201),
    );
  });
  const expense = (amount: number, transactionDate: string) =>
    call('post', `${base}/expenses`).send({
      accountId,
      categoryId,
      amount,
      transactionDate,
    });

  it('rejects impossible calendar dates across writes and report/query boundaries', async () => {
    const invalid = '2025-02-31T12:00:00Z';
    const group = idOf(
      await call('post', '/groups')
        .send({ name: 'Invalid date', type: 'family' })
        .expect(201),
    );
    await call('post', `/groups/${group}/accounts`)
      .send({ openedAt: invalid })
      .expect(400);
    await expense(0.1, invalid).expect(400);
    await call('post', `${base}/incomes`)
      .send({ accountId, amount: 1, transactionDate: invalid })
      .expect(400);
    await call('post', `${base}/expense-limits`)
      .send({ categoryId, total: 1, startDate: invalid, endDate: '2025-03-31' })
      .expect(400);
    for (const path of [
      `reports/months?toDate=${invalid}`,
      `reports/years?fromDate=${invalid}`,
      `expenses?fromDate=${invalid}`,
      `expense-limits?periodDate=${invalid}`,
    ]) {
      await call('get', `${base}/${path}`).expect(400);
    }
    const transactions = await call('get', `${base}/transactions`).expect(200);
    expect((transactions.body as { total: number }).total).toBe(0);
  });

  it('returns zero current balance when a wallet opens in the future', async () => {
    const group = idOf(
      await call('post', '/groups')
        .send({ name: 'Future', type: 'family' })
        .expect(201),
    );
    const wallet = await call('post', `/groups/${group}/accounts`)
      .send({ amount: 123.45, openedAt: '2099-01-01T00:00:00Z' })
      .expect(201);
    expect((wallet.body as { amount: number }).amount).toBe(0);
    const read = await call(
      'get',
      `/groups/${group}/accounts/${idOf(wallet)}`,
    ).expect(200);
    expect((read.body as { amount: number }).amount).toBe(0);
    const report = await call(
      'get',
      `/groups/${group}/reports/months?fromDate=2098-12-01&toDate=2099-01-31`,
    ).expect(200);
    expect(
      (report.body as { balance: number }[]).map((row) => row.balance),
    ).toEqual([0, 123.45]);
  });

  it('rejects unknown query parameters on detail reads and mutations', async () => {
    const incomeId = idOf(
      await call('post', `${base}/incomes`)
        .send({ accountId, amount: 1, transactionDate: '2024-01-02' })
        .expect(201),
    );
    const expenseId = idOf(await expense(0.1, '2024-01-02').expect(201));
    const limitId = idOf(
      await call('post', `${base}/expense-limits`)
        .send({ categoryId, total: 2 })
        .expect(201),
    );
    const paths = [
      `accounts/${accountId}`,
      `expense-categories/${categoryId}`,
      `expenses/${expenseId}`,
      `incomes/${incomeId}`,
      `expense-limits/${limitId}`,
    ];
    for (const path of paths) {
      await call('get', `${base}/${path}?unexpected=value`).expect(400);
      await call('delete', `${base}/${path}?unexpected=value`).expect(400);
    }
    await call('post', `${base}/accounts?unexpected=value`)
      .send({})
      .expect(400);
    await call('post', `${base}/expense-categories?unexpected=value`)
      .send({ name: 'Unexpected' })
      .expect(400);
    await call('patch', `${base}/expenses/${expenseId}?unexpected=value`)
      .send({ amount: 0.2 })
      .expect(400);
    await call('patch', `${base}/incomes/${incomeId}?unexpected=value`)
      .send({ amount: 0.2 })
      .expect(400);
    await call('patch', `${base}/expense-limits/${limitId}?unexpected=value`)
      .send({ total: 3 })
      .expect(400);
    await call(
      'patch',
      `${base}/expense-categories/${categoryId}?unexpected=value`,
    )
      .send({ name: 'Unexpected' })
      .expect(400);
  });

  it('rejects empty settings and transaction patches', async () => {
    const limitId = idOf(
      await call('post', `${base}/expense-limits`)
        .send({ categoryId, total: 2 })
        .expect(201),
    );
    const expenseId = idOf(await expense(0.1, '2024-01-02').expect(201));
    for (const path of [
      `expense-categories/${categoryId}`,
      `expense-limits/${limitId}`,
      `expenses/${expenseId}`,
    ]) {
      await call('patch', `${base}/${path}`).send({}).expect(400);
    }
  });

  it('carries fractional and negative balances across matching months in different years', async () => {
    await expense(0.1, '2025-01-15').expect(201);
    const earlier = await expense(0.3, '2024-01-15').expect(201);
    const balance = await call('get', `${base}/accounts/${accountId}`).expect(
      200,
    );
    expect((balance.body as { amount: number }).amount).toBe(-0.1);
    const report = await call(
      'get',
      `${base}/reports/months?fromDate=2024-01-01&toDate=2025-01-31`,
    ).expect(200);
    const rows = report.body as {
      period: string;
      balance: number;
      expenses: number;
    }[];
    expect(rows[0]).toMatchObject({
      period: '2024-01',
      balance: 0,
      expenses: 0.3,
    });
    expect(rows.at(-1)).toMatchObject({
      period: '2025-01',
      balance: -0.1,
      expenses: 0.1,
    });
    await call('patch', `${base}/expenses/${idOf(earlier)}`)
      .send({ amount: 0.2 })
      .expect(200);
    const corrected = await call('get', `${base}/accounts/${accountId}`).expect(
      200,
    );
    expect((corrected.body as { amount: number }).amount).toBe(0);
  });
});
