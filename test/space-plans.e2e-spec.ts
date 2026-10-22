import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { User } from '../src/modules/users/schemas/user.schema';
import { PlansModule } from '../src/modules/plans/plans.module';
import { startSpacesTestApp } from './helpers/spaces-test-app';
type PlanRow = {
  _id: string;
  amount: number;
  currency: string;
  categoryId: string;
  createdBy: string;
  status: string;
  expenseId?: string;
  createdByActor: {
    firstName: string | null;
    isAnonymized: boolean;
  };
};
type Page = {
  items: PlanRow[];
  total: number;
  page: number;
  limit: number;
};
describe('Space plans HTTP contract', () => {
  let ctx: Awaited<ReturnType<typeof startSpacesTestApp>>;
  const idOf = (r: Response) =>
    (
      r.body as {
        _id: string;
      }
    )._id;
  function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) {
    const call = request(
      ctx.app.getHttpServer() as Parameters<typeof request>[0],
    )[method](`/api/v1${path}`);
    return user < 0
      ? call
      : call.auth(ctx.users[user].token, { type: 'bearer' });
  }
  async function fixture(currency = 'USD', amount = 500) {
    await ctx.connection.collection('spaceinvitationratelimits').deleteMany({});
    const space = await api('post', '/spaces')
      .send({ name: 'Plans' })
      .expect(201);
    const base = `/spaces/${
      (
        space.body as {
          id: string;
        }
      ).id
    }`;
    for (const user of [1, 2]) {
      const invite = await api('post', `${base}/invitations`).expect(201);
      await api('post', '/space-invitations/accept', user)
        .send({
          token: (
            invite.body as {
              token: string;
            }
          ).token,
        })
        .expect(200);
    }
    const categoryId = idOf(
      await api('post', `${base}/expense-categories`)
        .send({ name: 'Food' })
        .expect(201),
    );
    const accountId = idOf(
      await api('post', `${base}/accounts`)
        .send({
          name: 'Cash',
          currency,
          amount,
          openedAt: '2024-01-01T00:00:00Z',
        })
        .expect(201),
    );
    const body = {
      categoryId,
      currency,
      amount: 100,
      description: 'Purchase',
      targetDate: '2025-02-15T12:00:00Z',
    };
    const create = async (user = 1, changes: Record<string, unknown> = {}) =>
      (
        await api('post', `${base}/plans`, user)
          .send({ ...body, ...changes })
          .expect(201)
      ).body as PlanRow;
    return { base, accountId, categoryId, body, create };
  }
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  it('creates additive plan indexes before traffic and preserves them on repeat startup', async () => {
    const plans = ctx.connection.collection('plans');
    const before = await plans.listIndexes().toArray();
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: {
            spaceId: 1,
            archivedAt: 1,
            targetDate: 1,
            createdAt: -1,
            _id: -1,
          },
        }),
      ]),
    );
    await ctx.app.get(PlansModule).onModuleInit();
    expect(await plans.listIndexes().toArray()).toEqual(before);
  });
  it('isolates spaces and enforces JWT and author/owner/delegate rights', async () => {
    const f = await fixture();
    const row = await f.create();
    expect(row).toMatchObject({
      spaceId: f.base.split('/')[2],
      createdBy: ctx.users[1].id,
    });
    for (const key of [
      'userId',
      'participantId',
      'participantActor',
      'type',
      'expenseId',
      'closedAt',
    ])
      expect(row).not.toHaveProperty(key);
    await api('get', `${f.base}/plans`, -1).expect(401);
    await api('get', `${f.base}/plans/${row._id}`, 3).expect(404);
    await api('get', `/plans/${row._id}`, 1).expect(404);
    const other = await fixture();
    await api('get', `${other.base}/plans/${row._id}`).expect(404);
    await api('patch', `${f.base}/plans/${row._id}`, 2)
      .send({ amount: 80 })
      .expect(403);
    await api('patch', `${f.base}/members/${ctx.users[2].id}/permissions`)
      .send({ manageCategories: true })
      .expect(200);
    await api('patch', `${f.base}/plans/${row._id}`, 2)
      .send({ amount: 80 })
      .expect(403);
    await api('patch', `${f.base}/members/${ctx.users[2].id}/permissions`)
      .send({ manageTransactions: true })
      .expect(200);
    await api('patch', `${f.base}/plans/${row._id}`, 2)
      .send({ amount: 80 })
      .expect(200);
    await api('patch', `${f.base}/members/${ctx.users[2].id}/permissions`)
      .send({ manageTransactions: false })
      .expect(200);
    await api('patch', `${f.base}/plans/${row._id}`, 2)
      .send({ amount: 70 })
      .expect(403);
    await api('patch', `${f.base}/plans/${row._id}`, 1)
      .send({ amount: 90 })
      .expect(200);
    await api('patch', `${f.base}/plans/${row._id}`)
      .send({ amount: 95 })
      .expect(200);
  });
  it.each([
    ['JPY', 1, 0.1],
    ['RUB', 0.01, 0.001],
    ['KWD', 0.001, 0.0001],
  ] as const)(
    'validates %s precision while preserving active-plan financial state',
    async (currency, unit, invalid) => {
      const f = await fixture(currency);
      const before = await ctx.connection
        .collection('accounts')
        .findOne({ _id: new Types.ObjectId(f.accountId) });
      const row = await f.create(1, {
        amount: unit,
        currency: ` ${currency.toLowerCase()} `,
        description: ' Trim ',
      });
      expect(row).toMatchObject({
        amount: unit,
        currency,
        description: 'Trim',
      });
      for (const amount of [invalid, 0, -1])
        await api('post', `${f.base}/plans`, 1)
          .send({ ...f.body, amount })
          .expect(400);
      await api('patch', `${f.base}/plans/${row._id}`, 1)
        .send({ amount: invalid })
        .expect(400);
      expect(
        await ctx.connection
          .collection('accounts')
          .findOne({ _id: new Types.ObjectId(f.accountId) }),
      ).toEqual(before);
      expect(
        await ctx.connection.collection('transactions').countDocuments({
          spaceId: new Types.ObjectId(f.base.split('/')[2]),
        }),
      ).toBe(0);
    },
  );
  it('rejects internal fields, nulls, invalid dates, descriptions and empty PATCH/query', async () => {
    const f = await fixture();
    const row = await f.create();
    for (const changes of [
      { description: '' },
      { description: '  ' },
      { description: 'x'.repeat(501) },
      { targetDate: '2025-02-30' },
      { targetDate: null },
      { amount: null },
      { createdBy: ctx.users[0].id },
      { spaceId: new Types.ObjectId().toString() },
      { ownerType: 'user' },
      { ownerId: ctx.users[0].id },
      { userId: ctx.users[0].id },
      { createdByActor: {} },
      { status: 'closed' },
      { expenseId: new Types.ObjectId().toString() },
      { closedAt: new Date().toISOString() },
    ])
      await api('post', `${f.base}/plans`, 1)
        .send({ ...f.body, ...changes })
        .expect(400);
    for (const changes of [
      {},
      { amount: null },
      { description: null },
      { categoryId: null },
      { currency: 'RUB' },
      { participantId: ctx.users[0].id },
    ])
      await api('patch', `${f.base}/plans/${row._id}`, 1)
        .send(changes)
        .expect(400);
    for (const query of [
      'includeArchived=1',
      'includeArchived=',
      'includeArchived=yes',
      'unknown=1',
      'status=archived',
    ])
      await api('get', `${f.base}/plans?${query}`).expect(400);
    await api('post', `${f.base}/plans/${row._id}/close`, 1)
      .send({ accountId: f.accountId, expenseId: row._id })
      .expect(400);
    await api('post', `${f.base}/plans/${row._id}/archive`, 1)
      .send({ unexpected: true })
      .expect(400);
  });
  it('paginates deterministically and keeps archived detail read-only with exact repeat semantics', async () => {
    const f = await fixture();
    const rows = [await f.create(), await f.create(), await f.create()];
    const sameTime = new Date('2025-01-01T00:00:00Z');
    await ctx.connection
      .collection('plans')
      .updateMany(
        { _id: { $in: rows.map((r) => new Types.ObjectId(r._id)) } },
        { $set: { createdAt: sameTime } },
      );
    const expected = rows
      .map((r) => r._id)
      .sort()
      .reverse();
    for (let page = 1; page <= 3; page++) {
      const result = (
        await api('get', `${f.base}/plans?limit=1&page=${page}`).expect(200)
      ).body as Page;
      expect(result.items.map((r) => r._id)).toEqual([expected[page - 1]]);
      expect(result).toMatchObject({ total: 3, page, limit: 1 });
    }
    await api('post', `${f.base}/plans/${rows[0]._id}/archive`, 1).expect(204);
    expect(
      (
        (await api('get', `${f.base}/plans?includeArchived=false`).expect(200))
          .body as Page
      ).total,
    ).toBe(2);
    expect(
      (
        (await api('get', `${f.base}/plans?includeArchived=true`).expect(200))
          .body as Page
      ).total,
    ).toBe(3);
    await api('get', `${f.base}/plans/${rows[0]._id}`, 2).expect(200);
    await api('patch', `${f.base}/plans/${rows[0]._id}`, 1)
      .send({ amount: 1 })
      .expect(404);
    await api('post', `${f.base}/plans/${rows[0]._id}/close`, 1)
      .send({ accountId: f.accountId })
      .expect(404);
    await api('delete', `${f.base}/plans/${rows[0]._id}`, 1).expect(409);
    await api('post', `${f.base}/plans/${rows[0]._id}/archive`, 1).expect(404);
    await api('delete', `${f.base}/plans/${rows[1]._id}`, 1).expect(204);
    await api('delete', `${f.base}/plans/${rows[1]._id}`, 1).expect(404);
  });
  it('preserves archived category history but rejects new references and execution', async () => {
    const f = await fixture();
    const row = await f.create();
    const other = await fixture();
    await api('post', `${f.base}/plans`, 1)
      .send({ ...f.body, categoryId: other.categoryId })
      .expect(404);
    await api('patch', `${f.base}/expense-categories/${f.categoryId}`)
      .send({ isArchived: true })
      .expect(200);
    await api('patch', `${f.base}/plans/${row._id}`, 1)
      .send({ description: 'History' })
      .expect(200);
    await api('post', `${f.base}/plans`, 1).send(f.body).expect(409);
    await api('post', `${f.base}/plans/${row._id}/close`, 1)
      .send({ accountId: f.accountId })
      .expect(409);
  });
  it('creates one actual expense with executor/participant, preserves planned amount and normal expense authority', async () => {
    const f = await fixture();
    const row = await f.create(1);
    await api('post', `${f.base}/expense-limits`)
      .send({
        categoryId: f.categoryId,
        currency: 'USD',
        total: 300,
        startDate: '2025-02-01T00:00:00Z',
        endDate: '2025-02-28T23:59:59.999Z',
      })
      .expect(201);
    const accounting = async (actual: number) => {
      const revenue = await api('get', `${f.base}/expenses/revenue`).expect(
        200,
      );
      expect(revenue.body).toMatchObject({ totalRevenue: actual });
      const limits = await api(
        'get',
        `${f.base}/expense-limits?periodDate=2025-02-15`,
      ).expect(200);
      expect(limits.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rest: 300 - actual }),
        ]),
      );
      const report = await api(
        'get',
        `${f.base}/reports/months?fromDate=2025-02-01&toDate=2025-02-28`,
      ).expect(200);
      expect(report.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            currencies: expect.arrayContaining([
              expect.objectContaining({ currency: 'USD', expenses: actual }),
            ]) as unknown[],
          }),
        ]),
      );
    };
    await accounting(0);
    const closed = (
      await api('post', `${f.base}/plans/${row._id}/close`)
        .send({
          accountId: f.accountId,
          amount: 120,
          participantId: ctx.users[2].id,
          closingDate: '2025-02-15T12:00:00Z',
        })
        .expect(201)
    ).body as PlanRow;
    expect(closed).toMatchObject({
      amount: 100,
      status: 'closed',
      createdBy: ctx.users[1].id,
    });
    await accounting(120);
    const expense = (
      await api('get', `${f.base}/expenses/${closed.expenseId}`).expect(200)
    ).body as Record<string, unknown>;
    expect(expense).toMatchObject({
      amount: 120,
      currency: 'USD',
      createdBy: ctx.users[0].id,
      participantId: ctx.users[2].id,
      origin: { type: 'plan', id: row._id },
    });
    await api('post', `${f.base}/plans/${row._id}/close`)
      .send({ accountId: f.accountId })
      .expect(400);
    await api('patch', `${f.base}/plans/${row._id}`, 1)
      .send({ amount: 2 })
      .expect(400);
    await api('delete', `${f.base}/plans/${row._id}`, 1).expect(409);
    await api('patch', `${f.base}/expenses/${closed.expenseId}`, 1)
      .send({ amount: 125 })
      .expect(403);
    await api('patch', `${f.base}/expenses/${closed.expenseId}`)
      .send({ amount: 125 })
      .expect(200);
    expect(
      (await api('get', `${f.base}/plans/${row._id}`).expect(200)).body,
    ).toMatchObject({
      amount: 100,
      status: 'closed',
      expenseId: closed.expenseId,
    });
    expect(
      (await api('get', `${f.base}/accounts/${f.accountId}`).expect(200)).body,
    ).toMatchObject({ amount: 375 });
    await accounting(125);
    await api('delete', `${f.base}/expenses/${closed.expenseId}`).expect(204);
    await api('get', `${f.base}/expenses/${closed.expenseId}`).expect(404);
    expect(
      (await api('get', `${f.base}/plans/${row._id}`).expect(200)).body,
    ).toMatchObject({
      amount: 100,
      status: 'closed',
      expenseId: closed.expenseId,
    });
    expect(
      (await api('get', `${f.base}/accounts/${f.accountId}`).expect(200)).body,
    ).toMatchObject({ amount: 500 });
    await accounting(0);
    await api('post', `${f.base}/plans/${row._id}/close`)
      .send({ accountId: f.accountId })
      .expect(400);
  });
  it('uses defaults and permits a negative space balance; account archive freezes generated expense', async () => {
    const f = await fixture('USD', 0);
    const row = await f.create(1);
    const before = Date.now();
    const closed = (
      await api('post', `${f.base}/plans/${row._id}/close`, 1)
        .send({ accountId: f.accountId })
        .expect(201)
    ).body as PlanRow;
    const expense = (
      await api('get', `${f.base}/expenses/${closed.expenseId}`).expect(200)
    ).body as {
      amount: number;
      description: string;
      transactionDate: string;
      createdBy: string;
      participantId: string;
    };
    expect(expense).toMatchObject({
      amount: 100,
      description: 'Purchase',
      createdBy: ctx.users[1].id,
      participantId: ctx.users[1].id,
    });
    expect(new Date(expense.transactionDate).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(
      (await api('get', `${f.base}/accounts/${f.accountId}`).expect(200)).body,
    ).toMatchObject({ amount: -100 });
    await api('post', `${f.base}/plans/${row._id}/archive`, 1).expect(204);
    await api('post', `${f.base}/accounts/${f.accountId}/archive`).expect(204);
    await api('patch', `${f.base}/expenses/${closed.expenseId}`, 1)
      .send({ amount: 90 })
      .expect(404);
    await api('delete', `${f.base}/expenses/${closed.expenseId}`, 1).expect(
      404,
    );
  });
  it('rejects mismatched/foreign/archived accounts, early dates and inactive participants without closing', async () => {
    const f = await fixture();
    const row = await f.create();
    const other = await fixture();
    const rub = idOf(
      await api('post', `${f.base}/accounts`)
        .send({ name: 'RUB', currency: 'RUB' })
        .expect(201),
    );
    for (const [changes, status] of [
      [{ accountId: other.accountId }, 404],
      [{ accountId: rub }, 400],
      [{ closingDate: '2023-01-01T00:00:00Z' }, 400],
      [{ participantId: ctx.users[3].id }, 404],
      [{ amount: 0.001 }, 400],
      [{ amount: null }, 400],
    ] as const)
      await api('post', `${f.base}/plans/${row._id}/close`, 1)
        .send({ accountId: f.accountId, ...changes })
        .expect(status);
    await api('post', `${f.base}/accounts/${f.accountId}/archive`).expect(204);
    await api('post', `${f.base}/plans/${row._id}/close`, 1)
      .send({ accountId: f.accountId })
      .expect(404);
    expect(
      (await api('get', `${f.base}/plans/${row._id}`).expect(200)).body,
    ).toMatchObject({ status: 'active' });
  });
  it('resolves current/departed/deleting/missing authors with one lookup per page and no transaction type', async () => {
    const f = await fixture();
    const row = await f.create();
    await f.create();
    const users = ctx.app.get<Model<User>>(getModelToken(User.name));
    const find = jest.spyOn(users, 'find');
    const page = (await api('get', `${f.base}/plans`).expect(200)).body as Page;
    expect(find).toHaveBeenCalledTimes(1);
    find.mockRestore();
    expect(page.items[0].createdByActor.firstName).toBe('Grace');
    await users.updateOne(
      { _id: ctx.users[1].id },
      { $set: { firstName: 'Renamed' } },
    );
    expect(
      (
        (await api('get', `${f.base}/plans/${row._id}`).expect(200))
          .body as PlanRow
      ).createdByActor.firstName,
    ).toBe('Renamed');
    await api('post', `${f.base}/leave`, 1).expect(204);
    await api('get', `${f.base}/plans/${row._id}`, 1).expect(404);
    expect(
      (
        (await api('get', `${f.base}/plans/${row._id}`).expect(200))
          .body as PlanRow
      ).createdByActor.firstName,
    ).toBe('Renamed');
    for (const status of ['deletion_pending', 'deleted']) {
      await users.updateOne({ _id: ctx.users[1].id }, { $set: { status } });
      expect(
        (
          (await api('get', `${f.base}/plans/${row._id}`).expect(200))
            .body as PlanRow
        ).createdByActor,
      ).toMatchObject({ firstName: null, isAnonymized: true });
    }
    await ctx.connection
      .collection('plans')
      .updateOne(
        { _id: new Types.ObjectId(row._id) },
        { $set: { createdBy: new Types.ObjectId() } },
      );
    expect(
      (
        (await api('get', `${f.base}/plans/${row._id}`).expect(200))
          .body as PlanRow
      ).createdByActor.isAnonymized,
    ).toBe(true);
    await users.updateOne(
      { _id: ctx.users[1].id },
      { $set: { status: 'active', firstName: 'Grace' } },
    );
  });
});
