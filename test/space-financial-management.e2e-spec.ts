import {
  createIsolatedSpaces,
  isolatedFinancialPath,
} from './helpers/isolated-spaces';
let isolatedSpaceIds: string[];
import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Delegated space transaction management', () => {
  let ctx: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let spaceId: string;
  let accountId: string;
  let categoryId: string;
  const idOf = (r: Response) =>
    (
      r.body as {
        _id: string;
      }
    )._id;
  const base = () => `/spaces/${spaceId}`;
  function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) {
    const call = request(
      ctx.app.getHttpServer() as Parameters<typeof request>[0],
    )[method](`/api/v1${isolatedFinancialPath(isolatedSpaceIds[user], path)}`);
    return user < 0
      ? call
      : call.auth(ctx.users[user].token, { type: 'bearer' });
  }
  const permissions = (enabled: boolean) =>
    api('patch', `${base()}/members/${ctx.users[1].id}/permissions`).send({
      manageTransactions: enabled,
    });
  const create = (kind: 'incomes' | 'expenses', user = 0) =>
    api('post', `${base()}/${kind}`, user).send({
      accountId,
      amount: 100,
      transactionDate: '2026-02-15T12:00:00Z',
      ...(kind === 'expenses' ? { categoryId } : {}),
    });
  async function balance(amount: number) {
    expect(
      (await api('get', `${base()}/accounts/${accountId}`).expect(200)).body,
    ).toMatchObject({ amount });
  }
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
    isolatedSpaceIds = await createIsolatedSpaces(ctx);
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await ctx.connection.collection('spaceinvitationratelimits').deleteMany({});
    const response = await api('post', '/spaces')
      .send({ name: 'Family management' })
      .expect(201);
    spaceId = (
      response.body as {
        id: string;
      }
    ).id;
    for (const user of [1, 2]) {
      const invite = await api('post', `${base()}/invitations`).expect(201);
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
    accountId = idOf(
      await api('post', `${base()}/accounts`)
        .send({
          name: 'Family',
          currency: 'USD',
          openedAt: '2026-01-01T00:00:00Z',
        })
        .expect(201),
    );
    categoryId = idOf(
      await api('post', `${base()}/expense-categories`)
        .send({ name: 'Food' })
        .expect(201),
    );
  });
  it.each(['incomes', 'expenses'] as const)(
    'edits and deletes another author %s, with immediate grant/revocation and one compensation',
    async (kind) => {
      const id = idOf(await create(kind).expect(201));
      const path = `${base()}/${kind}/${id}`;
      await api('patch', path, 1).send({ amount: 150 }).expect(403);
      await api('patch', `${base()}/members/${ctx.users[1].id}/permissions`)
        .send({
          manageAccounts: true,
          manageCategories: true,
          manageLimits: true,
        })
        .expect(200);
      await api('patch', path, 1).send({ amount: 150 }).expect(403);
      await permissions(true).expect(200);
      expect(
        (await api('patch', path, 1).send({ amount: 150 }).expect(200)).body,
      ).toMatchObject({ createdBy: ctx.users[0].id, amount: 150 });
      await balance(kind === 'incomes' ? 150 : -150);
      await permissions(false).expect(200);
      await api('patch', path, 1).send({ amount: 200 }).expect(403);
      await api('delete', path, 1).expect(403);
      const own = idOf(await create(kind, 1).expect(201));
      await api('patch', `${base()}/${kind}/${own}`, 1)
        .send({ amount: 40 })
        .expect(200);
      await api('delete', `${base()}/${kind}/${own}`, 1).expect(204);
      await permissions(true).expect(200);
      await api('delete', path, 1).expect(204);
      await balance(0);
      await api('delete', path, 1).expect(404);
      await balance(0);
      const stored = await ctx.connection
        .collection('transactions')
        .findOne({ _id: new Types.ObjectId(id) });
      expect(String(stored?.createdBy)).toBe(ctx.users[0].id);
      expect(String(stored?.deletedBy)).toBe(ctx.users[1].id);
    },
  );
  it('reassigns expenses while preserving authorship and historic participants', async () => {
    const id = idOf(await create('expenses').expect(201));
    const path = `${base()}/expenses/${id}`;
    await permissions(true).expect(200);
    expect(
      (
        await api('patch', path, 1)
          .send({ participantId: ctx.users[2].id })
          .expect(200)
      ).body,
    ).toMatchObject({
      createdBy: ctx.users[0].id,
      participantId: ctx.users[2].id,
    });
    await api('patch', path, 2)
      .send({ participantId: ctx.users[1].id })
      .expect(403);
    await api('post', `${base()}/leave`, 2).expect(204);
    expect(
      (await api('patch', path, 1).send({ amount: 120 }).expect(200)).body,
    ).toMatchObject({ participantId: ctx.users[2].id });
    await api('patch', path, 1)
      .send({ participantId: ctx.users[3].id })
      .expect(404);
    await api('patch', path, 1)
      .send({ participantId: ctx.users[1].id })
      .expect(200);
    await api('patch', path, 1)
      .send({ participantId: ctx.users[2].id, amount: 200 })
      .expect(404);
    for (const forbidden of [
      { createdBy: ctx.users[1].id },
      { accountId },
      { transactionDate: '2026-03-01T00:00:00Z' },
      { ownerId: ctx.users[1].id },
    ]) {
      await api('patch', path, 1).send(forbidden).expect(400);
    }
    await permissions(false).expect(200);
    await api('patch', path, 1).send({ amount: 130 }).expect(200);
    await balance(-130);
  });
  it('keeps delegated financial management separate from settings and administrative access', async () => {
    await permissions(true).expect(200);
    for (const [method, path, body] of [
      ['post', `${base()}/accounts`, { name: 'Family', currency: 'USD' }],
      ['post', `${base()}/expense-categories`, { name: 'Denied' }],
      [
        'post',
        `${base()}/expense-limits`,
        { categoryId, currency: 'USD', total: 10 },
      ],
      [
        'patch',
        `${base()}/members/${ctx.users[2].id}/permissions`,
        { manageTransactions: true },
      ],
      ['post', `${base()}/invitations`, {}],
      ['delete', `${base()}/members/${ctx.users[2].id}`, {}],
      ['post', `${base()}/ownership`, { userId: ctx.users[1].id }],
      ['patch', base(), { name: 'Denied' }],
      ['delete', base(), {}],
    ] as const) {
      await api(method, path, 1).send(body).expect(403);
    }
    await create('incomes', 1).expect(201);
    await create('expenses', 1).expect(201);
    await balance(0);
  });
  it('allows corrections to departed authors but conceals foreign space records', async () => {
    const income = idOf(await create('incomes', 2).expect(201));
    await permissions(true).expect(200);
    await api('post', `${base()}/leave`, 2).expect(204);
    await api('patch', `${base()}/incomes/${income}`, 1)
      .send({ amount: 150 })
      .expect(200);
    await api('patch', `${base()}/incomes/${income}`, 2)
      .send({ amount: 10 })
      .expect(404);
    await api('delete', `${base()}/incomes/${income}`, 1).expect(204);
    await balance(0);
    const space = await api('post', '/spaces')
      .send({ name: 'Other' })
      .expect(201);
    const otherId = (
      space.body as {
        id: string;
      }
    ).id;
    const otherAccount = idOf(
      await api('post', `/spaces/${otherId}/accounts`)
        .send({
          name: 'Family',
          currency: 'USD',
          openedAt: '2026-01-01T00:00:00Z',
        })
        .expect(201),
    );
    const foreign = idOf(
      await api('post', `/spaces/${otherId}/incomes`)
        .send({
          accountId: otherAccount,
          amount: 50,
          transactionDate: '2026-02-15T12:00:00Z',
        })
        .expect(201),
    );
    const controlAccount = idOf(
      await api('post', '/accounts')
        .send({
          name: 'Independent control',
          currency: 'USD',
          type: 'balance',
          openedAt: '2026-01-01T00:00:00Z',
        })
        .expect(201),
    );
    const control = idOf(
      await api('post', '/incomes')
        .send({
          accountId: controlAccount,
          amount: 50,
          transactionDate: '2026-10-17T12:00:00Z',
        })
        .expect(201),
    );
    for (const id of [foreign, control]) {
      await api('patch', `${base()}/incomes/${id}`, 1)
        .send({ amount: 10 })
        .expect(404);
      await api('delete', `${base()}/incomes/${id}`, 1).expect(404);
    }
    await api('patch', `${base()}/incomes/${foreign}`, -1)
      .send({ amount: 10 })
      .expect(401);
    await balance(0);
    expect(
      (
        await api('get', `/spaces/${otherId}/accounts/${otherAccount}`).expect(
          200,
        )
      ).body,
    ).toMatchObject({ amount: 50 });
    expect(
      (await api('get', `/incomes/${control}`).expect(200)).body,
    ).toMatchObject({ amount: 50 });
  });
});
