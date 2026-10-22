import request, { Response } from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Budget settings compatibility', () => {
  let fixture: Awaited<ReturnType<typeof startSpacesTestApp>>;
  const id = (response: Response) =>
    (
      response.body as {
        _id: string;
      }
    )._id;
  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(fixture.users[0].token, { type: 'bearer' });
  beforeAll(async () => {
    fixture = await startSpacesTestApp();
  }, 60000);
  afterAll(async () => {
    await fixture?.close();
  });
  it('retains space UTC periods, scalar usage, archive history, and owner isolation', async () => {
    const space = await api('post', '/spaces')
      .send({ name: 'Settings space' })
      .expect(201);
    const base = `/spaces/${
      (
        space.body as {
          id: string;
        }
      ).id
    }`;
    const category = await api('post', `${base}/expense-categories`)
      .send({ name: 'Settings space' })
      .expect(201);
    const categoryId = id(category);
    await api('post', `${base}/expense-categories`)
      .send({ name: 'Settings space' })
      .expect(409);
    const account = await api('post', `${base}/accounts`)
      .send({
        name: 'Family',
        currency: 'USD',
        amount: 100,
        openedAt: '2026-09-01T00:00:00.000Z',
      })
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
        currency: 'USD',
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
    expect(limit.body).toHaveProperty('currency', 'USD');
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
        currency: 'USD',
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
