import {
  createIsolatedSpaces,
  isolatedFinancialPath,
} from './helpers/isolated-spaces';
let isolatedSpaceIds: string[];
import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Multiple space accounts and direct savings', () => {
  let ctx: Awaited<ReturnType<typeof startSpacesTestApp>>;
  const idOf = (r: Response) =>
    (
      r.body as {
        _id: string;
      }
    )._id;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) =>
    request(ctx.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${isolatedFinancialPath(isolatedSpaceIds[user], path)}`)
      .auth(ctx.users[user].token, { type: 'bearer' });
  async function space() {
    const r = await api('post', '/spaces')
      .send({ name: 'Savings' })
      .expect(201);
    return `/spaces/${
      (
        r.body as {
          id: string;
        }
      ).id
    }`;
  }
  async function join(base: string, user: number) {
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
  const create = (base: string, extra: Record<string, unknown> = {}) =>
    api('post', `${base}/accounts`).send({
      name: 'Family',
      currency: 'RUB',
      openedAt: '2024-01-01T00:00:00Z',
      ...extra,
    });
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
    isolatedSpaceIds = await createIsolatedSpaces(ctx);
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  });
  it('uses the current UTC month end for account balances and excludes later months', async () => {
    const base = await space();
    const now = new Date();
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1,
    ).toISOString();
    const nextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString();
    const source = idOf(await create(base, { amount: 100000 }).expect(201));
    const destination = idOf(
      await create(base, { type: 'saving' }).expect(201),
    );
    await api('post', `${base}/transfers`)
      .send({
        sourceAccountId: source,
        destinationAccountId: destination,
        sourceAmount: 50000,
        destinationAmount: 50000,
        transactionDate: monthEnd,
      })
      .expect(201);
    await api('post', `${base}/incomes`)
      .send({ accountId: source, amount: 90000, transactionDate: nextMonth })
      .expect(201);
    for (const [accountId, amount] of [
      [source, 50000],
      [destination, 50000],
    ] as const) {
      const expected = {
        _id: accountId,
        amount,
        timeline: expect.arrayContaining([
          expect.objectContaining({ date: monthEnd, amount }),
        ]) as unknown[],
      };
      expect(
        (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
      ).toMatchObject(expected);
      expect((await api('get', `${base}/accounts`).expect(200)).body).toEqual(
        expect.arrayContaining([expect.objectContaining(expected)]),
      );
      expect(
        (
          await api('patch', `${base}/accounts/${accountId}`)
            .send({ name: 'Renamed' })
            .expect(200)
        ).body,
      ).toMatchObject(expected);
    }
    expect(
      (await create(base, { amount: 100, openedAt: monthEnd }).expect(201))
        .body,
    ).toMatchObject({ amount: 100 });
    expect(
      (await create(base, { amount: 100, openedAt: nextMonth }).expect(201))
        .body,
    ).toMatchObject({ amount: 0 });
  });
  it('creates independent same-name accounts, filters type/currency and isolates owners', async () => {
    const base = await space();
    expect((await api('get', `${base}/accounts`).expect(200)).body).toEqual([]);
    const first = await create(base, { amount: 100 }).expect(201);
    expect(first.body).toMatchObject({
      type: 'balance',
      amount: 100,
      archivedAt: null,
    });
    const second = await create(base, { type: 'balance', amount: 20 }).expect(
      201,
    );
    const rubSaving = await create(base, { type: 'saving', amount: 50 }).expect(
      201,
    );
    const kwdSaving = await create(base, {
      type: 'saving',
      currency: 'KWD',
      amount: 0.001,
    }).expect(201);
    const all = (await api('get', `${base}/accounts`).expect(200))
      .body as Array<{
      _id: string;
    }>;
    expect(new Set(all.map((a) => a._id))).toEqual(
      new Set([first, second, rubSaving, kwdSaving].map(idOf)),
    );
    expect(
      (await api('get', `${base}/accounts?type=saving`).expect(200)).body,
    ).toHaveLength(2);
    expect(
      (
        await api(
          'get',
          `${base}/accounts?type=saving&currency=%20rub%20`,
        ).expect(200)
      ).body,
    ).toMatchObject([{ _id: idOf(rubSaving), currency: 'RUB', amount: 50 }]);
    for (const query of [
      'type=unknown',
      'currency=XYZ',
      'toDate=2024-01-01',
      'defaultAccountId=bad',
    ])
      await api('get', `${base}/accounts?${query}`).expect(400);
    await create(base, { type: 'unknown' }).expect(400);
    const foreign = await space();
    await create(foreign).expect(201);
    await api('post', '/accounts')
      .send({
        openedAt: '2024-01-01',
        name: 'Independent control',
        type: 'saving',
        currency: 'RUB',
      })
      .expect(201);
    expect(
      (await api('get', `${base}/accounts`).expect(200)).body,
    ).toHaveLength(4);
    await api('get', `${foreign}/accounts/${idOf(first)}`).expect(404);
    const storedSpace = await ctx.connection
      .collection('spaces')
      .findOne({ _id: new Types.ObjectId(base.split('/').pop()) });
    expect(storedSpace).not.toHaveProperty('defaultAccountId');
  });
  it('serializes concurrent creation without singleton conflicts or duplicate snapshots', async () => {
    const base = await space();
    const responses = await Promise.all([
      create(base, { amount: 1 }),
      create(base, { amount: 2 }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const ids = responses.map(idOf);
    expect(new Set(ids).size).toBe(2);
    for (const accountId of ids)
      expect(
        await ctx.connection
          .collection('accountsnapshots')
          .countDocuments({ accountId: new Types.ObjectId(accountId) }),
      ).toBe(1);
    expect(
      (await api('get', `${base}/accounts`).expect(200)).body,
    ).toHaveLength(2);
  });
  it('records a shared KWD reserve through common operations, including negative balance and limits', async () => {
    const base = await space();
    await join(base, 1);
    await join(base, 2);
    await api('patch', `${base}/members/${ctx.users[2].id}/permissions`)
      .send({ manageAccounts: true })
      .expect(200);
    const balance = await create(base, { currency: 'KWD', amount: 1 }).expect(
      201,
    );
    const reserve = await create(base, {
      type: 'saving',
      currency: 'KWD',
      amount: 0.001,
    }).expect(201);
    const accountId = idOf(reserve);
    const categoryId = idOf(
      await api('post', `${base}/expense-categories`)
        .send({ name: 'Reserve' })
        .expect(201),
    );
    const limit = await api('post', `${base}/expense-limits`)
      .send({
        categoryId,
        currency: 'KWD',
        total: 0.01,
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      })
      .expect(201);
    const income = await api('post', `${base}/incomes`)
      .send({ accountId, amount: 0.003, transactionDate: '2025-01-02' })
      .expect(201);
    const expense = await api('post', `${base}/expenses`, 1)
      .send({
        accountId,
        categoryId,
        participantId: ctx.users[0].id,
        amount: 0.005,
        transactionDate: '2025-01-03',
        items: [{ name: 'Spice', price: 0.001, quantity: 0.5 }],
      })
      .expect(201);
    expect(expense.body).toMatchObject({
      currency: 'KWD',
      createdBy: ctx.users[1].id,
      participantId: ctx.users[0].id,
    });
    expect(
      (await api('get', `${base}/accounts/${accountId}`, 1).expect(200)).body,
    ).toMatchObject({ amount: -0.001 });
    expect(
      (await api('get', `${base}/accounts/${idOf(balance)}`).expect(200)).body,
    ).toMatchObject({ amount: 1 });
    expect(
      (await api('get', `${base}/expense-limits/${idOf(limit)}`).expect(200))
        .body,
    ).toMatchObject({ rest: 0.005 });
    await api('patch', `${base}/expenses/${idOf(expense)}`, 2)
      .send({ amount: 0.002 })
      .expect(403);
    await api('patch', `${base}/expenses/${idOf(expense)}`, 1)
      .send({ amount: 0.002 })
      .expect(200);
    expect(
      (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
    ).toMatchObject({ amount: 0.002 });
    await api('delete', `${base}/expenses/${idOf(expense)}`, 1).expect(204);
    await api('delete', `${base}/incomes/${idOf(income)}`).expect(204);
    expect(
      (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
    ).toMatchObject({ amount: 0.001 });
    expect(
      (await api('get', `${base}/expense-limits/${idOf(limit)}`).expect(200))
        .body,
    ).toMatchObject({ rest: 0.01 });
    expect((await api('get', '/transactions').expect(200)).body).toMatchObject({
      total: 0,
    });
  });
  it.each([
    { currency: 'JPY', unit: 1, invalid: 0.1 },
    { currency: 'RUB', unit: 0.01, invalid: 0.001 },
    { currency: 'KWD', unit: 0.001, invalid: 0.0001 },
  ])(
    'keeps $currency precision and openedAt rules for active savings',
    async ({ currency, unit, invalid }) => {
      const base = await space();
      const accountId = idOf(
        await create(base, { type: 'saving', currency }).expect(201),
      );
      const categoryId = idOf(
        await api('post', `${base}/expense-categories`)
          .send({ name: 'Money' })
          .expect(201),
      );
      const body = {
        accountId,
        categoryId,
        amount: unit,
        transactionDate: '2025-01-01',
        items: [{ name: 'Item', price: unit, quantity: 1 }],
      };
      await api('post', `${base}/expenses`)
        .send({ ...body, transactionDate: '2023-12-31' })
        .expect(400);
      await api('post', `${base}/expenses`)
        .send({ ...body, amount: invalid })
        .expect(400);
      const expense = await api('post', `${base}/expenses`)
        .send(body)
        .expect(201);
      await api('patch', `${base}/expenses/${idOf(expense)}`)
        .send({ amount: invalid })
        .expect(400);
      await api('patch', `${base}/expenses/${idOf(expense)}`)
        .send({ items: [{ name: 'Item', price: invalid, quantity: 1 }] })
        .expect(400);
      expect(
        (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
      ).toMatchObject({ amount: -unit });
    },
  );
});
