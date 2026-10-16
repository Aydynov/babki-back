import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Budget settings compatibility', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const id = (response: Response) => (response.body as { _id: string })._id;
  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(fixture.users[0].token, { type: 'bearer' });
  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await fixture?.close();
  });

  it('retains personal currency usage, populated category, and total-only updates', async () => {
    const category = await api('post', '/expense-categories')
      .send({ name: 'Settings personal' })
      .expect(201);
    const categoryId = id(category);
    const account = await api('post', '/accounts')
      .send({
        name: 'Settings USD',
        type: 'balance',
        currency: 'USD',
        amount: 100,
      })
      .expect(201);
    const euro = await api('post', '/accounts')
      .send({
        name: 'Settings EUR',
        type: 'balance',
        currency: 'EUR',
        amount: 100,
      })
      .expect(201);
    for (const [accountId, amount] of [
      [id(account), 0.1],
      [id(account), 0.2],
      [id(euro), 50],
    ] as const)
      await api('post', '/expenses')
        .send({
          accountId,
          amount,
          categoryId,
          transactionDate: '2026-09-10T12:00:00.000Z',
        })
        .expect(201);
    const limit = await api('post', '/expense-limits')
      .send({
        categoryId,
        currency: 'USD',
        total: 1,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      })
      .expect(201);
    expect(limit.body).toMatchObject({
      rest: 0.7,
      currency: 'USD',
      category: { _id: categoryId, name: 'Settings personal' },
    });
    await api('post', '/expense-limits')
      .send({
        categoryId,
        currency: 'EUR',
        total: 100,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      })
      .expect(201);
    await api('post', '/expense-limits')
      .send({
        categoryId,
        currency: 'USD',
        total: 1,
        startDate: '2026-09-30',
        endDate: '2026-10-01',
      })
      .expect(409);
    await api('patch', `/expense-limits/${id(limit)}`)
      .send({ startDate: '2026-10-01' })
      .expect(400);
    expect(
      (
        await api('patch', `/expense-limits/${id(limit)}`)
          .send({ total: 2 })
          .expect(200)
      ).body,
    ).toMatchObject({ rest: 1.7 });
    await api('patch', `/expense-categories/${categoryId}`)
      .send({ isArchived: true })
      .expect(200);
    expect((await api('get', '/expense-categories').expect(200)).body).toEqual(
      [],
    );
    await api('get', `/expense-categories/${categoryId}`).expect(200);
    await api('patch', `/expense-limits/${id(limit)}`)
      .send({ total: 3 })
      .expect(200);
  });

  it('retains group UTC periods, scalar usage, archive history, and owner isolation', async () => {
    const group = await api('post', '/groups')
      .send({ name: 'Settings group', type: 'organization' })
      .expect(201);
    const base = `/groups/${(group.body as { id: string }).id}`;
    const category = await api('post', `${base}/expense-categories`)
      .send({ name: 'Settings group' })
      .expect(201);
    const categoryId = id(category);
    await api('post', `${base}/expense-categories`)
      .send({ name: 'Settings group' })
      .expect(409);
    const account = await api('post', `${base}/accounts`)
      .send({ amount: 100, openedAt: '2026-09-01T00:00:00.000Z' })
      .expect(201);
    for (const amount of [0.1, 0.2])
      await api('post', `${base}/expenses`)
        .send({
          accountId: id(account),
          categoryId,
          amount,
          transactionDate: '2026-09-10T12:00:00.000Z',
        })
        .expect(201);
    const limit = await api('post', `${base}/expense-limits`)
      .send({
        categoryId,
        total: 1,
        startDate: '2026-09-01T12:00:00.000Z',
        endDate: '2026-09-30T12:00:00.000Z',
      })
      .expect(201);
    expect(limit.body).toMatchObject({
      category: categoryId,
      rest: 0.7,
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-30T23:59:59.999Z',
    });
    expect(limit.body).not.toHaveProperty('currency');
    await api('get', `/expense-categories/${categoryId}`).expect(404);
    await api('get', `/expense-limits/${id(limit)}`).expect(404);
    await api('patch', `${base}/expense-categories/${categoryId}`)
      .send({ isArchived: true })
      .expect(200);
    expect(
      (await api('get', `${base}/expense-categories`).expect(200)).body,
    ).toEqual([expect.objectContaining({ _id: categoryId, isArchived: true })]);
    expect(
      (
        await api('patch', `${base}/expense-limits/${id(limit)}`)
          .send({ total: 2 })
          .expect(200)
      ).body,
    ).toMatchObject({ rest: 1.7 });
    await api('post', `${base}/expense-limits`)
      .send({
        categoryId,
        total: 1,
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      })
      .expect(409);
    expect(
      (
        await api('patch', `${base}/expense-limits/${id(limit)}`)
          .send({ startDate: '2026-10-01', endDate: '2026-10-31' })
          .expect(200)
      ).body,
    ).toMatchObject({ rest: 2 });
    await api('delete', `${base}/expense-limits/${id(limit)}`).expect(204);
    await api('delete', `${base}/expense-categories/${categoryId}`).expect(409);
  });
});
