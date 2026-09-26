import request from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

type Entity = { _id: string; amount?: number; rest?: number };
describe('Group finances isolation and settings HTTP', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(fixture.users[user].token, { type: 'bearer' });
  const id = (response: { body: unknown }) => (response.body as Entity)._id;
  async function group(name: string) {
    const response = await api('post', '/groups')
      .send({ name, type: 'family' })
      .expect(201);
    return (response.body as { id: string }).id;
  }
  async function setup(name: string) {
    const groupId = await group(name);
    const base = `/groups/${groupId}`;
    const accountId = id(
      await api('post', `${base}/accounts`)
        .send({ amount: 100, openedAt: '2024-01-01T00:00:00Z' })
        .expect(201),
    );
    const categoryId = id(
      await api('post', `${base}/expense-categories`)
        .send({ name: 'Food' })
        .expect(201),
    );
    return { groupId, base, accountId, categoryId };
  }
  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await fixture?.close();
  });

  it('isolates two group budgets from every personal financial read and mutation', async () => {
    const personalBalanceId = id(
      await api('post', '/accounts')
        .send({
          name: 'Personal balance',
          type: 'balance',
          currency: 'USD',
          amount: 1000,
        })
        .expect(201),
    );
    const personalSavingId = id(
      await api('post', '/accounts')
        .send({
          name: 'Personal saving',
          type: 'saving',
          currency: 'USD',
          amount: 0,
        })
        .expect(201),
    );
    const personalPaths = [
      '/accounts',
      '/expense-categories',
      '/expense-limits?periodDate=2024-02-01',
      '/transactions',
      '/expenses',
      '/incomes',
      '/transfers',
      '/expenses/revenue',
      '/incomes/revenue',
      '/reports/months?fromDate=2024-01-01&toDate=2024-12-31',
      '/reports/years',
    ];
    const before = new Map<string, unknown>();
    for (const path of personalPaths)
      before.set(path, (await api('get', path).expect(200)).body);
    const a = await setup('Isolation A');
    const b = await setup('Isolation B');
    const expenseId = id(
      await api('post', `${a.base}/expenses`)
        .send({
          accountId: a.accountId,
          categoryId: a.categoryId,
          amount: 10,
          transactionDate: '2024-02-10T00:00:00Z',
        })
        .expect(201),
    );
    const incomeId = id(
      await api('post', `${a.base}/incomes`)
        .send({
          accountId: a.accountId,
          amount: 5,
          transactionDate: '2024-02-11T00:00:00Z',
        })
        .expect(201),
    );
    const limitId = id(
      await api('post', `${a.base}/expense-limits`)
        .send({
          categoryId: a.categoryId,
          total: 30,
          startDate: '2024-02-01',
          endDate: '2024-02-29',
        })
        .expect(201),
    );
    for (const path of personalPaths)
      expect((await api('get', path).expect(200)).body).toEqual(
        before.get(path),
      );
    for (const path of [
      `/accounts/${a.accountId}/snapshots`,
      `/expense-categories/${a.categoryId}`,
      `/expense-limits/${limitId}`,
      `/expenses/${expenseId}`,
      `/incomes/${incomeId}`,
      `/transactions/${expenseId}`,
      `/transfers/${expenseId}`,
    ])
      await api('get', path).expect(404);
    for (const [path, payload] of [
      [`/expense-categories/${a.categoryId}`, { name: 'Changed' }],
      [`/expense-limits/${limitId}`, { total: 1 }],
      [`/expenses/${expenseId}`, { amount: 1 }],
      [`/incomes/${incomeId}`, { amount: 1 }],
      [`/transfers/${expenseId}`, { sourceAmount: 1, destinationAmount: 1 }],
    ] as const)
      await api('patch', path).send(payload).expect(404);
    for (const path of [
      `/accounts/${a.accountId}`,
      `/expense-categories/${a.categoryId}`,
      `/expense-limits/${limitId}`,
      `/transactions/${expenseId}`,
      `/transactions/${incomeId}`,
    ])
      await api('delete', path).expect(404);
    await api('post', '/expenses')
      .send({
        accountId: personalBalanceId,
        categoryId: a.categoryId,
        amount: 1,
        transactionDate: '2024-02-01',
      })
      .expect(404);
    await api('post', '/expense-limits')
      .send({ categoryId: a.categoryId, currency: 'USD', total: 1 })
      .expect(404);
    await api('post', '/transfers')
      .send({
        sourceAccountId: a.accountId,
        destinationAccountId: personalSavingId,
        sourceAmount: 1,
        destinationAmount: 1,
        transactionDate: '2024-02-01',
      })
      .expect(404);
    await api('post', `${a.base}/expenses`)
      .send({
        accountId: b.accountId,
        categoryId: a.categoryId,
        amount: 1,
        transactionDate: '2024-02-01',
      })
      .expect(404);
    await api('post', `${a.base}/expenses`)
      .send({
        accountId: a.accountId,
        categoryId: b.categoryId,
        amount: 1,
        transactionDate: '2024-02-01',
      })
      .expect(404);
    expect(
      (
        (await api('get', `${a.base}/accounts/${a.accountId}`).expect(200))
          .body as { amount: number }
      ).amount,
    ).toBe(95);
    expect(
      (
        (await api('get', `${b.base}/accounts/${b.accountId}`).expect(200))
          .body as { amount: number }
      ).amount,
    ).toBe(100);
    const reports = await api(
      'get',
      `${a.base}/reports/months?fromDate=2024-02-01&toDate=2024-02-29`,
    ).expect(200);
    expect(reports.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ expenses: 10, incomes: 5, balance: 95 }),
      ]),
    );
    expect(
      (
        (await api('get', `${a.base}/expense-limits/${limitId}`).expect(200))
          .body as { rest: number }
      ).rest,
    ).toBe(20);
  });

  it('enforces each delegated setting right independently and immediately revokes it', async () => {
    const groupId = await group('Delegation');
    const base = `/groups/${groupId}`;
    const invitation = await api('post', `${base}/invitations`)
      .send({})
      .expect(201);
    await api('post', '/group-invitations/accept', 1)
      .send({ token: (invitation.body as { token: string }).token })
      .expect(200);
    const permission = (body: object) =>
      api('patch', `${base}/members/${fixture.users[1].id}/permissions`)
        .send(body)
        .expect(200);
    await api('post', `${base}/accounts`, 1).send({}).expect(403);
    await api('post', `${base}/expense-categories`, 1)
      .send({ name: 'Delegated' })
      .expect(403);
    await permission({ manageAccounts: true });
    const accountId = id(
      await api('post', `${base}/accounts`, 1).send({}).expect(201),
    );
    await api('post', `${base}/expense-categories`, 1)
      .send({ name: 'Delegated' })
      .expect(403);
    await api('delete', `${base}/accounts/${accountId}`, 1).expect(204);
    await permission({ manageAccounts: false, manageCategories: true });
    const categoryId = id(
      await api('post', `${base}/expense-categories`, 1)
        .send({ name: 'Delegated' })
        .expect(201),
    );
    await api('post', `${base}/accounts`, 1).send({}).expect(403);
    await api('post', `${base}/expense-limits`, 1)
      .send({ categoryId, total: 10 })
      .expect(403);
    await permission({ manageCategories: false, manageLimits: true });
    const limitId = id(
      await api('post', `${base}/expense-limits`, 1)
        .send({ categoryId, total: 10 })
        .expect(201),
    );
    await api('patch', `${base}/expense-limits/${limitId}`, 1)
      .send({ total: 20 })
      .expect(200);
    await api('patch', `${base}/expense-categories/${categoryId}`, 1)
      .send({ name: 'Denied' })
      .expect(403);
    await permission({ manageLimits: false });
    await api('delete', `${base}/expense-limits/${limitId}`, 1).expect(403);
  });

  it('protects used categories, overlapping periods and archived category assignments', async () => {
    const a = await setup('Limits');
    const limit = {
      categoryId: a.categoryId,
      total: 100,
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    };
    const limitId = id(
      await api('post', `${a.base}/expense-limits`).send(limit).expect(201),
    );
    await api('post', `${a.base}/expense-limits`)
      .send({ ...limit, startDate: '2024-01-01', endDate: '2024-12-31' })
      .expect(409);
    const nextId = id(
      await api('post', `${a.base}/expense-limits`)
        .send({ ...limit, startDate: '2024-03-01', endDate: '2024-03-31' })
        .expect(201),
    );
    await api('patch', `${a.base}/expense-limits/${nextId}`)
      .send({ startDate: '2024-02-29' })
      .expect(409);
    await api('patch', `${a.base}/expense-limits/${limitId}`)
      .send({ total: 90 })
      .expect(200);
    await api('delete', `${a.base}/expense-categories/${a.categoryId}`).expect(
      409,
    );
    const expense = {
      accountId: a.accountId,
      categoryId: a.categoryId,
      amount: 5,
      transactionDate: '2024-02-10',
    };
    const expenseId = id(
      await api('post', `${a.base}/expenses`).send(expense).expect(201),
    );
    await api('patch', `${a.base}/expense-categories/${a.categoryId}`)
      .send({ isArchived: true })
      .expect(200);
    await api('post', `${a.base}/expenses`).send(expense).expect(409);
    await api('patch', `${a.base}/expenses/${expenseId}`)
      .send({ amount: 6 })
      .expect(200);
    await api('post', `${a.base}/expense-limits`)
      .send({ ...limit, startDate: '2025-01-01', endDate: '2025-01-31' })
      .expect(409);
    await api('delete', `${a.base}/expense-limits/${limitId}`).expect(204);
    await api('delete', `${a.base}/expense-limits/${nextId}`).expect(204);
    await api('delete', `${a.base}/expenses/${expenseId}`).expect(204);
    await api('delete', `${a.base}/expense-categories/${a.categoryId}`).expect(
      409,
    );
  });

  it('requires JWT and rejects null, unknown, immutable and empty update input', async () => {
    const a = await setup('Validation');
    for (const suffix of [
      '/accounts',
      '/expenses',
      '/incomes',
      '/transactions',
      '/expense-categories',
      '/expense-limits?periodDate=2024-02-01',
      '/reports/months',
      '/reports/years',
    ]) {
      await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1${a.base}${suffix}`)
        .expect(401);
      await api('get', `${a.base}${suffix}?unknown=true`).expect(400);
    }
    const expense = {
      accountId: a.accountId,
      categoryId: a.categoryId,
      amount: 5,
      transactionDate: '2024-02-10',
    };
    const expenseId = id(
      await api('post', `${a.base}/expenses`).send(expense).expect(201),
    );
    for (const payload of [
      {},
      { amount: null },
      { categoryId: null },
      { participantId: null },
      { ownerId: fixture.users[0].id },
      { createdBy: fixture.users[0].id },
      { transactionDate: '2024-03-01' },
    ])
      await api('patch', `${a.base}/expenses/${expenseId}`)
        .send(payload)
        .expect(400);
    for (const payload of [
      {},
      { isArchived: null },
      { isArchived: 'true' },
      { unknown: 1 },
    ])
      await api('patch', `${a.base}/expense-categories/${a.categoryId}`)
        .send(payload)
        .expect(400);
    await api(
      'get',
      `${a.base}/reports/months?participantId=${fixture.users[0].id}`,
    ).expect(400);
    await api('post', `${a.base}/expenses`)
      .send({ ...expense, ownerType: 'user' })
      .expect(400);
    await api('post', `${a.base}/expenses`)
      .send({ ...expense, transactionDate: '2023-12-31' })
      .expect(400);
  });
});
