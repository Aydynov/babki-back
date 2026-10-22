import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Plan and debt lifecycle (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let sequence = 0;
  let accountId: string;
  let spaceId: string;
  const financialPath = (path: string) => `/api/v1/spaces/${spaceId}${path}`;
  const oid = (value: string) => new Types.ObjectId(value);
  const collection = (name: string) => harness.connection.collection(name);
  const api = () => {
    const server = harness.app.getHttpServer() as Parameters<typeof request>[0];
    const token = harness.users[0].token;
    const call = (method: 'get' | 'post' | 'delete', path: string) =>
      request(server)
        [method](financialPath(path))
        .auth(token, { type: 'bearer' });
    return {
      get: (path: string) => call('get', path),
      post: (path: string, body: object = {}) => call('post', path).send(body),
      delete: (path: string) => call('delete', path),
    };
  };
  const idOf = (response: Response) =>
    (
      response.body as {
        _id: string;
      }
    )._id;
  const date = '2026-09-21T00:00:00.000Z';
  async function category() {
    sequence += 1;
    return idOf(
      await api()
        .post('/expense-categories', { name: `Lifecycle-${sequence}` })
        .expect(201),
    );
  }
  async function plan() {
    return idOf(
      await api()
        .post('/plans', {
          categoryId: await category(),
          currency: 'USD',
          description: 'Lifecycle plan',
          amount: 50,
          targetDate: '2026-12-01',
        })
        .expect(201),
    );
  }
  async function debt() {
    return idOf(
      await api()
        .post('/debts', {
          debtor: 'Borrower',
          currency: 'USD',
          principalAmount: 100,
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
    accountId = idOf(
      await api()
        .post('/accounts', {
          name: 'Lifecycle balance',
          type: 'balance',
          currency: 'USD',
          amount: 0,
          openedAt: date,
        })
        .expect(201),
    );
  });

  afterAll(async () => {
    await harness?.close();
  }, 30000);
  it('physically deletes only an active plan without financial history', async () => {
    const planId = await plan();
    await api().delete(`/plans/${planId}`).expect(204);
    expect(await collection('plans').countDocuments({ _id: oid(planId) })).toBe(
      0,
    );
  });
  it('restricts and archives a closed plan while retaining its origin expense', async () => {
    const planId = await plan();
    await api()
      .post(`/plans/${planId}/close`, { closingDate: date, accountId })
      .expect(201);
    const originFilter = { 'origin.type': 'plan', 'origin.id': oid(planId) };
    const expense = await collection('transactions').findOne(originFilter);
    await api().delete(`/plans/${planId}`).expect(409);
    await api().post(`/plans/${planId}/archive`).expect(204);
    expect((await api().get('/plans').expect(200)).body).toMatchObject({
      total: 0,
      items: [],
    });
    expect(expense).not.toBeNull();
    await api()
      .delete(`/expenses/${String(expense?._id)}`)
      .expect(204);
    expect(
      (await collection('transactions').findOne(originFilter))?.deletedAt,
    ).toBeInstanceOf(Date);
    expect(
      (await collection('plans').findOne({ _id: oid(planId) }))?.archivedAt,
    ).toBeInstanceOf(Date);
  });
  it('physically deletes only a debt without repayments or generated income', async () => {
    const debtId = await debt();
    await api().delete(`/debts/${debtId}`).expect(204);
    expect(await collection('debts').countDocuments({ _id: oid(debtId) })).toBe(
      0,
    );
  });
  it('restricts and archives a repaid debt while retaining repayment and origin income', async () => {
    const debtId = await debt();
    await api()
      .post(`/debts/${debtId}/repayments`, {
        amount: 25,
        repaymentDate: date,
        isIncome: true,
        accountId,
      })
      .expect(201);
    const originFilter = { 'origin.type': 'debt', 'origin.id': oid(debtId) };
    await api().delete(`/debts/${debtId}`).expect(409);
    await api().post(`/debts/${debtId}/archive`).expect(204);
    expect((await api().get('/debts').expect(200)).body).toMatchObject({
      total: 0,
      items: [],
    });
    expect(
      await collection('debttransactions').countDocuments({
        debtId: oid(debtId),
      }),
    ).toBe(1);
    expect(
      await collection('transactions').findOne(originFilter),
    ).not.toBeNull();
  });
  it('serializes plan close against archival', async () => {
    const planId = await plan();
    const [closing, archival] = await Promise.all([
      api().post(`/plans/${planId}/close`, { closingDate: date, accountId }),
      api().post(`/plans/${planId}/archive`),
    ]);
    expect([
      [201, 204],
      [400, 204],
    ]).toContainEqual([closing.status, archival.status]);
    expect(
      (await collection('plans').findOne({ _id: oid(planId) }))?.archivedAt,
    ).toBeInstanceOf(Date);
    expect(
      await collection('transactions').countDocuments({
        'origin.type': 'plan',
        'origin.id': oid(planId),
      }),
    ).toBe(closing.status === 201 ? 1 : 0);
  });
  it('serializes debt repayment against archival', async () => {
    const debtId = await debt();
    const [repayment, archival] = await Promise.all([
      api().post(`/debts/${debtId}/repayments`, {
        amount: 25,
        repaymentDate: date,
        isIncome: true,
        accountId,
      }),
      api().post(`/debts/${debtId}/archive`),
    ]);
    expect([
      [201, 204],
      [404, 204],
    ]).toContainEqual([repayment.status, archival.status]);
    expect(
      (await collection('debts').findOne({ _id: oid(debtId) }))?.archivedAt,
    ).toBeInstanceOf(Date);
    const expected = repayment.status === 201 ? 1 : 0;
    expect(
      await collection('debttransactions').countDocuments({
        debtId: oid(debtId),
      }),
    ).toBe(expected);
    expect(
      await collection('transactions').countDocuments({
        'origin.type': 'debt',
        'origin.id': oid(debtId),
      }),
    ).toBe(expected);
  });
  it('keeps origin attribution when source archival races transaction deletion', async () => {
    const planId = await plan();
    await api()
      .post(`/plans/${planId}/close`, { closingDate: date, accountId })
      .expect(201);
    const originFilter = { 'origin.type': 'plan', 'origin.id': oid(planId) };
    const expense = await collection('transactions').findOne(originFilter);
    const [deletion, archival] = await Promise.all([
      api().delete(`/expenses/${String(expense?._id)}`),
      api().post(`/plans/${planId}/archive`),
    ]);
    expect([deletion.status, archival.status]).toEqual([204, 204]);
    expect(
      (await collection('transactions').findOne(originFilter))?.deletedAt,
    ).toBeInstanceOf(Date);
    expect(
      (await collection('plans').findOne({ _id: oid(planId) }))?.archivedAt,
    ).toBeInstanceOf(Date);
  });
});
