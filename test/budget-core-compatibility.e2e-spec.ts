import request, { Response } from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Budget core behavior before and after unification', () => {
  let ctx: Awaited<ReturnType<typeof startSpacesTestApp>>;
  const idOf = (r: Response) =>
    (
      r.body as {
        _id: string;
      }
    )._id;
  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(ctx.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(ctx.users[0].token, { type: 'bearer' });
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  });
  it.each(['space'] as const)(
    'retains %s DTOs, author data, pagination, edits and deletion',
    async (ownerType) => {
      let base = '';
      if (ownerType === 'space') {
        const space = await api('post', '/spaces')
          .send({ name: 'Contract' })
          .expect(201);
        base = `/spaces/${
          (
            space.body as {
              id: string;
            }
          ).id
        }`;
      }
      const accountId = idOf(
        await api('post', `${base}/accounts`)
          .send(
            ownerType === 'user'
              ? {
                  name: 'Baseline',
                  currency: 'USD',
                  type: 'balance',
                  openedAt: '2024-01-01T00:00:00Z',
                }
              : {
                  name: 'Family',
                  currency: 'USD',
                  openedAt: '2024-01-01T00:00:00Z',
                },
          )
          .expect(201),
      );
      const categoryId = idOf(
        await api('post', `${base}/expense-categories`)
          .send({ name: `Core ${ownerType}` })
          .expect(201),
      );
      const income = await api('post', `${base}/incomes`)
        .send({
          accountId,
          amount: 0.3,
          transactionDate: '2025-06-15T12:00:00Z',
          ...(ownerType === 'user' ? { source: 'Bonus' } : {}),
        })
        .expect(201);
      const expense = await api('post', `${base}/expenses`)
        .send({
          accountId,
          categoryId,
          amount: 0.1,
          transactionDate: '2026-06-15T12:00:00Z',
          description: 'Dinner',
        })
        .expect(201);
      const row = expense.body as {
        createdBy?: string;
        participantId?: string;
        category: unknown;
        currency?: string;
      };
      if (ownerType === 'user') {
        expect(row.createdBy).toBeUndefined();
        expect(row.category).toMatchObject({ _id: categoryId });
        expect(income.body).toMatchObject({ source: 'Bonus', currency: 'USD' });
      } else {
        expect(row).toMatchObject({
          createdBy: ctx.users[0].id,
          participantId: ctx.users[0].id,
          category: categoryId,
        });
        expect(row.currency).toBe('USD');
      }
      const page = await api(
        'get',
        `${base}/transactions?accountId=${accountId}&limit=1`,
      ).expect(200);
      expect(page.body).toMatchObject({
        total: 2,
        page: 1,
        limit: 1,
        items: [{ _id: idOf(expense) }],
      });
      await api('patch', `${base}/expenses/${idOf(expense)}`)
        .send({})
        .expect(ownerType === 'space' ? 400 : 200);
      await api('patch', `${base}/expenses/${idOf(expense)}`)
        .send({ amount: 0.2 })
        .expect(200);
      expect(
        (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
      ).toMatchObject({ amount: 0.1 });
      await api('patch', `${base}/expenses/${idOf(expense)}`)
        .send({ accountId })
        .expect(400);
      await api(
        'delete',
        ownerType === 'user'
          ? `/transactions/${idOf(expense)}`
          : `${base}/expenses/${idOf(expense)}`,
      ).expect(204);
      expect(
        (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
      ).toMatchObject({ amount: 0.3 });
      await api('get', `${base}/expenses/${idOf(expense)}`).expect(404);
    },
  );
});
