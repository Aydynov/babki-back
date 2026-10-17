import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal plan compatibility (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let categoryId: string;
  let accountId: string;
  const idOf = (response: Response) => (response.body as { _id: string })._id;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) => {
    const call = request(
      harness.app.getHttpServer() as Parameters<typeof request>[0],
    )
      [method](`/api/v1${path}`)
      .auth(harness.users[0].token, { type: 'bearer' });
    return body === undefined ? call : call.send(body);
  };
  const plan = (extra: object = {}) =>
    api('post', '/plans', {
      categoryId,
      currency: 'USD',
      description: 'Planned purchase',
      amount: 50,
      targetDate: '2026-12-01',
      ...extra,
    });
  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);
  beforeEach(async () => {
    for (const name of [
      'plans',
      'transactions',
      'accountsnapshots',
      'accounts',
      'expensecategories',
    ]) {
      await harness.connection.collection(name).deleteMany({});
    }
    categoryId = idOf(
      await api('post', '/expense-categories', { name: 'Plans' }).expect(201),
    );
    accountId = idOf(
      await api('post', '/accounts', {
        name: 'Plan account',
        type: 'balance',
        currency: 'USD',
        amount: 100,
      }).expect(201),
    );
  });
  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('keeps personal response fields, minimum and currency validation', async () => {
    const created = await plan().expect(201);
    expect(created.body).toMatchObject({
      userId: harness.users[0].id,
      amount: 50,
      status: 'active',
      archivedAt: null,
    });
    for (const key of [
      'ownerType',
      'ownerId',
      'createdBy',
      'createdByActor',
      'participantId',
    ]) {
      expect(created.body).not.toHaveProperty(key);
    }
    await plan({ amount: 0.001, currency: 'KWD' }).expect(400);
    await plan({ amount: 0.011 }).expect(400);
    const list = await api('get', '/plans?status=active&currency=USD').expect(
      200,
    );
    expect(list.body).toMatchObject({
      total: 1,
      page: 1,
      items: [created.body],
    });
    await api('get', `/plans/${idOf(created)}`).expect(200, created.body);
  });

  it('preserves empty PATCH and nullable optional validation behavior', async () => {
    const created = await plan().expect(201);
    const path = `/plans/${idOf(created)}`;
    await api('patch', path, {}).expect(200);
    await api('patch', path, { amount: null }).expect(400);
    await api('patch', path, { description: null }).expect(500);
    await api('patch', path, { targetDate: null }).expect(500);
    await api('patch', path, { categoryId: null }).expect(500);
    await api('patch', path, { description: 'Changed', amount: 25 }).expect(
      200,
    );
  });

  it('preserves archived detail exclusion and the legacy archived PATCH result', async () => {
    const created = await plan().expect(201);
    const path = `/plans/${idOf(created)}`;
    await api('post', `${path}/archive`, {}).expect(204);
    await api('get', path).expect(404);
    expect((await api('get', '/plans').expect(200)).body).toMatchObject({
      total: 0,
    });
    const updated = await api('patch', path, {
      description: 'Archived',
    }).expect(200);
    expect(updated.text).toBe('');
    await api('delete', path).expect(409);
    await api('post', `${path}/archive`, {}).expect(404);
    await api('post', `${path}/close`, { accountId }).expect(404);
  });

  it('retains planned amount, origin, once-only close and personal snapshot carry', async () => {
    const created = await plan().expect(201);
    const id = idOf(created);
    const snapshots = harness.connection.collection('accountsnapshots');
    const account = new Types.ObjectId(accountId);
    const future = new Date('2026-12-01T00:00:00.000Z');
    await snapshots.insertOne({
      accountId: account,
      date: future,
      amount: 100,
    });
    const closed = await api('post', `/plans/${id}/close`, {
      accountId,
      amount: 20,
      closingDate: '2026-09-21T00:00:00.000Z',
    }).expect(201);
    expect(closed.body).toMatchObject({
      amount: 50,
      status: 'closed',
      expenseId: expect.any(String) as unknown,
      closedAt: expect.any(String) as unknown,
    });
    expect(closed.body).not.toHaveProperty('ownerType');
    const expense = await harness.connection
      .collection('transactions')
      .findOne({
        _id: new Types.ObjectId(
          (closed.body as { expenseId: string }).expenseId,
        ),
      });
    expect(expense).toMatchObject({
      amount: 20,
      origin: { type: 'plan', id: new Types.ObjectId(id) },
    });
    expect(
      await snapshots.findOne({ accountId: account, date: future }),
    ).toMatchObject({ amount: 80 });
    await api('post', `/plans/${id}/close`, { accountId }).expect(400);
    await api('patch', `/plans/${id}`, { amount: 60 }).expect(400);
    await api('delete', `/plans/${id}`).expect(409);
    expect(
      await harness.connection
        .collection('transactions')
        .countDocuments({ 'origin.id': new Types.ObjectId(id) }),
    ).toBe(1);
  });

  it('rolls back currency mismatch and physically deletes an active plan', async () => {
    const created = await plan({ currency: 'EUR' }).expect(201);
    await api('post', `/plans/${idOf(created)}/close`, { accountId }).expect(
      400,
    );
    expect(
      await harness.connection.collection('transactions').countDocuments({}),
    ).toBe(0);
    await api('delete', `/plans/${idOf(created)}`).expect(204);
    await api('delete', `/plans/${idOf(created)}`).expect(404);
  });
});
