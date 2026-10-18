import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

type Row = { _id: string } & Record<string, unknown>;
const idOf = (r: Response) => (r.body as Row)._id;
const assertPublic = (r: Response) => {
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      expect(['__v', 'mutationVersion', 'lockVersion']).not.toContain(key);
      visit(item);
    }
  };
  visit(r.body as unknown);
};

describe('Group financial response boundary', () => {
  let ctx: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const api = (method: 'get' | 'post' | 'patch', path: string) =>
    request(ctx.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(ctx.users[0].token, { type: 'bearer' });
  beforeAll(async () => {
    ctx = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => ctx?.close());

  it('omits storage metadata in every financial controller while retaining it in storage', async () => {
    const group = await api('post', '/groups')
      .send({ name: 'Public finance', type: 'family' })
      .expect(201);
    const base = `/groups/${(group.body as { id: string }).id}`;
    const post = async (path: string, body: Record<string, unknown>) =>
      api('post', `${base}${path}`).send(body).expect(201).expect(assertPublic);
    const patch = async (path: string, body: Record<string, unknown>) =>
      api('patch', `${base}${path}`)
        .send(body)
        .expect(200)
        .expect(assertPublic);
    const cash = idOf(
      await post('/accounts', {
        name: 'Cash',
        currency: 'USD',
        amount: 100,
        openedAt: '2024-01-01T00:00:00Z',
      }),
    );
    const saving = idOf(
      await post('/accounts', {
        name: 'Saving',
        currency: 'USD',
        type: 'saving',
        openedAt: '2024-01-01T00:00:00Z',
      }),
    );
    await patch(`/accounts/${cash}`, { name: 'Renamed' });
    const category = idOf(await post('/expense-categories', { name: 'Food' }));
    await patch(`/expense-categories/${category}`, { description: 'Shared' });
    const limit = idOf(
      await post('/expense-limits', {
        categoryId: category,
        currency: 'USD',
        total: 100,
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      }),
    );
    await patch(`/expense-limits/${limit}`, { total: 200 });
    const income = idOf(
      await post('/incomes', {
        accountId: cash,
        amount: 20,
        transactionDate: '2024-01-02',
      }),
    );
    await patch(`/incomes/${income}`, { amount: 21 });
    const expense = idOf(
      await post('/expenses', {
        accountId: cash,
        categoryId: category,
        amount: 2,
        transactionDate: '2024-01-03',
      }),
    );
    await patch(`/expenses/${expense}`, { amount: 3 });
    const transfer = idOf(
      await post('/transfers', {
        sourceAccountId: cash,
        destinationAccountId: saving,
        sourceAmount: 10,
        destinationAmount: 10,
        transactionDate: '2024-01-04',
      }),
    );
    await patch(`/transfers/${transfer}`, { description: 'Reserve' });
    const plan = idOf(
      await post('/plans', {
        description: 'Purchase',
        amount: 5,
        currency: 'USD',
        categoryId: category,
        targetDate: '2024-01-05',
      }),
    );
    await patch(`/plans/${plan}`, { description: 'Renamed purchase' });
    await post(`/plans/${plan}/close`, {
      accountId: cash,
      closingDate: '2024-01-05',
    });
    const debt = idOf(
      await post('/debts', {
        debtor: 'Borrower',
        principalAmount: 20,
        currency: 'USD',
      }),
    );
    await patch(`/debts/${debt}`, { dueDate: null });
    const repaid = (
      await post(`/debts/${debt}/repayments`, {
        amount: 5,
        isIncome: true,
        accountId: cash,
        repaymentDate: '2024-01-06',
      })
    ).body as { debt: Row; repayment: Row };
    await api(
      'post',
      `${base}/debts/${debt}/repayments/${repaid.repayment._id}/cancel`,
    )
      .expect(200)
      .expect(assertPublic);
    for (const path of [
      '/accounts',
      `/accounts/${cash}`,
      '/expense-categories',
      `/expense-categories/${category}`,
      '/expense-limits?periodDate=2024-01-15',
      `/expense-limits/${limit}`,
      '/transactions',
      '/expenses',
      `/expenses/${expense}`,
      '/incomes',
      `/incomes/${income}`,
      '/transfers',
      `/transfers/${transfer}`,
      '/plans',
      `/plans/${plan}`,
      '/debts',
      `/debts/${debt}`,
      `/debts/${debt}/repayments`,
      `/debts/${debt}/repayments/${repaid.repayment._id}`,
      '/expenses/revenue',
      '/reports/months?fromDate=2024-01-01&toDate=2024-01-31',
      '/reports/years?fromDate=2024-01-01&toDate=2024-12-31',
    ])
      await api('get', `${base}${path}`).expect(200).expect(assertPublic);
    const stored = await ctx.connection
      .collection('accounts')
      .findOne({ _id: new Types.ObjectId(cash) });
    expect(stored?.mutationVersion).toBeGreaterThan(0);
    expect(stored).toHaveProperty('__v');
    const before = await ctx.connection
      .collection('accounts')
      .findOne({ _id: new Types.ObjectId(cash) });
    const response = await api('get', `${base}/accounts/${cash}`)
      .expect(200)
      .expect(assertPublic);
    expect(response.body).toMatchObject({
      _id: cash,
      ownerType: 'group',
      ownerId: (group.body as { id: string }).id,
      currency: 'USD',
      amount: 103,
    });
    expect(
      await ctx.connection
        .collection('accounts')
        .findOne({ _id: new Types.ObjectId(cash) }),
    ).toEqual(before);
    const personal = await api('post', '/accounts')
      .send({ name: 'Personal', type: 'balance', currency: 'USD', amount: 1 })
      .expect(201);
    expect(personal.body).toHaveProperty('__v');
    expect(personal.body).not.toHaveProperty('ownerType');
  });
});
