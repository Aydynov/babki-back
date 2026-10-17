import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group transfers HTTP contract', () => {
  let ctx: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const idOf = (r: Response) => (r.body as { _id: string })._id;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) => {
    const call = request(
      ctx.app.getHttpServer() as Parameters<typeof request>[0],
    )[method](`/api/v1${path}`);
    return user < 0
      ? call
      : call.auth(ctx.users[user].token, { type: 'bearer' });
  };
  async function fixture(
    sourceCurrency = 'RUB',
    destinationCurrency = sourceCurrency,
    amount = 100,
  ) {
    const g = await api('post', '/groups')
      .send({ name: 'Transfer family', type: 'family' })
      .expect(201);
    const groupId = (g.body as { id: string }).id;
    const base = `/groups/${groupId}`;
    const account = async (type: string, currency: string, opening: number) =>
      idOf(
        await api('post', `${base}/accounts`)
          .send({
            name: type,
            type,
            currency,
            amount: opening,
            openedAt: '2024-01-01T00:00:00Z',
          })
          .expect(201),
      );
    const sourceAccountId = await account('balance', sourceCurrency, amount);
    const destinationAccountId = await account(
      'saving',
      destinationCurrency,
      0,
    );
    const body = {
      sourceAccountId,
      destinationAccountId,
      sourceAmount: 10,
      destinationAmount: 10,
      transactionDate: '2025-02-15T12:00:00Z',
    };
    return { base, groupId, sourceAccountId, destinationAccountId, body };
  }
  async function join(base: string, user: number) {
    const invite = await api('post', `${base}/invitations`).expect(201);
    await api('post', '/group-invitations/accept', user)
      .send({ token: (invite.body as { token: string }).token })
      .expect(200);
  }
  const amount = async (base: string, accountId: string) =>
    (
      (await api('get', `${base}/accounts/${accountId}`).expect(200)).body as {
        amount: number;
      }
    ).amount;
  beforeAll(async () => {
    ctx = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  });

  it('creates one authored transfer and returns the same monetary DTO in both histories', async () => {
    const f = await fixture();
    await join(f.base, 1);
    const created = await api('post', `${f.base}/transfers`, 1)
      .send(f.body)
      .expect(201);
    const id = idOf(created);
    expect(created.body).toMatchObject({
      type: 'transfer',
      createdBy: ctx.users[1].id,
      source: { accountId: f.sourceAccountId, currency: 'RUB', amount: 10 },
      destination: {
        accountId: f.destinationAccountId,
        currency: 'RUB',
        amount: 10,
      },
      effectiveRate: { baseCurrency: 'RUB', quoteCurrency: 'RUB', rate: 1 },
    });
    expect(created.body).not.toHaveProperty('participantId');
    expect(created.body).not.toHaveProperty('amount');
    expect(created.body).not.toHaveProperty('currency');
    expect(await amount(f.base, f.sourceAccountId)).toBe(90);
    expect(await amount(f.base, f.destinationAccountId)).toBe(10);
    for (const path of ['transfers', 'transactions?transactionType=transfer']) {
      const page = await api('get', `${f.base}/${path}`, 1).expect(200);
      expect(page.body).toMatchObject({
        total: 1,
        page: 1,
        items: [{ _id: id, effectiveRate: { rate: 1 } }],
      });
    }
    expect(
      (await api('get', `${f.base}/transfers/${id}`).expect(200)).body,
    ).toEqual(created.body);
    await api('get', `${f.base}/transfers`, -1).expect(401);
    expect((await api('get', '/transfers').expect(200)).body).toMatchObject({
      total: 0,
    });
  });

  it('keeps author, owner and manageTransactions authority independent of settings permissions', async () => {
    const f = await fixture();
    for (const user of [1, 2, 3]) await join(f.base, user);
    await api('patch', `${f.base}/members/${ctx.users[2].id}/permissions`)
      .send({
        manageAccounts: true,
        manageCategories: true,
        manageLimits: true,
      })
      .expect(200);
    const created = await api('post', `${f.base}/transfers`, 1)
      .send(f.body)
      .expect(201);
    const id = idOf(created);
    await api('patch', `${f.base}/transfers/${id}`, 2)
      .send({ description: 'Forbidden' })
      .expect(403);
    await api('delete', `${f.base}/transfers/${id}`, 2).expect(403);
    await api('patch', `${f.base}/transfers/${id}`, 1)
      .send({ description: 'Author' })
      .expect(200);
    await api('patch', `${f.base}/members/${ctx.users[3].id}/permissions`)
      .send({ manageTransactions: true })
      .expect(200);
    expect(
      (
        await api('patch', `${f.base}/transfers/${id}`, 3)
          .send({ sourceAmount: 12, destinationAmount: 12 })
          .expect(200)
      ).body,
    ).toMatchObject({ createdBy: ctx.users[1].id });
    await api('patch', `${f.base}/members/${ctx.users[3].id}/permissions`)
      .send({ manageTransactions: false })
      .expect(200);
    await api('delete', `${f.base}/transfers/${id}`, 3).expect(403);
    await api('delete', `${f.base}/members/${ctx.users[1].id}`).expect(204);
    await api('get', `${f.base}/transfers/${id}`, 1).expect(404);
    await api('patch', `${f.base}/members/${ctx.users[3].id}/permissions`)
      .send({ manageTransactions: true })
      .expect(200);
    await api('delete', `${f.base}/transfers/${id}`, 3).expect(204);
    const stored = await ctx.connection
      .collection('transactions')
      .findOne({ _id: new Types.ObjectId(id) });
    expect(String(stored?.createdBy)).toBe(ctx.users[1].id);
    expect(String(stored?.deletedBy)).toBe(ctx.users[3].id);
  });

  it('checks source funds at transfer date and extra debit, while allowing exact historical reversal', async () => {
    const f = await fixture('RUB', 'RUB', 12);
    await api('post', `${f.base}/transfers`)
      .send({ ...f.body, sourceAmount: 13, destinationAmount: 13 })
      .expect(400);
    const created = await api('post', `${f.base}/transfers`)
      .send(f.body)
      .expect(201);
    const id = idOf(created);
    await api('patch', `${f.base}/transfers/${id}`)
      .send({ sourceAmount: 13, destinationAmount: 13 })
      .expect(400);
    await api('patch', `${f.base}/transfers/${id}`)
      .send({ sourceAmount: 12, destinationAmount: 12 })
      .expect(200);
    expect(await amount(f.base, f.sourceAccountId)).toBe(0);
    await api('patch', `${f.base}/transfers/${id}`)
      .send({ description: 'No new debit' })
      .expect(200);
    const categoryId = idOf(
      await api('post', `${f.base}/expense-categories`)
        .send({ name: 'Spent reserve' })
        .expect(201),
    );
    await api('post', `${f.base}/expenses`)
      .send({
        accountId: f.destinationAccountId,
        categoryId,
        amount: 20,
        transactionDate: '2025-02-16',
      })
      .expect(201);
    await api('delete', `${f.base}/transfers/${id}`).expect(204);
    expect(await amount(f.base, f.sourceAccountId)).toBe(12);
    expect(await amount(f.base, f.destinationAccountId)).toBe(-20);
    const low = await fixture('RUB', 'RUB', 5);
    await api('post', `${low.base}/incomes`)
      .send({
        accountId: low.sourceAccountId,
        amount: 100,
        transactionDate: '2026-01-01',
      })
      .expect(201);
    await api('post', `${low.base}/transfers`)
      .send({ ...low.body, sourceAmount: 6, destinationAmount: 6 })
      .expect(400);
    expect(await amount(low.base, low.sourceAccountId)).toBe(105);
  });

  it.each([
    ['JPY', 1, 0.1],
    ['RUB', 0.01, 0.001],
    ['KWD', 0.001, 0.0001],
  ] as const)(
    'checks %s precision for both sides and PATCH',
    async (currency, unit, invalid) => {
      const f = await fixture(currency, currency, 10);
      const body = { ...f.body, sourceAmount: unit, destinationAmount: unit };
      for (const bad of [0, -1, invalid, 1e-16]) {
        await api('post', `${f.base}/transfers`)
          .send({ ...body, sourceAmount: bad })
          .expect(400);
        await api('post', `${f.base}/transfers`)
          .send({ ...body, destinationAmount: bad })
          .expect(400);
      }
      const created = await api('post', `${f.base}/transfers`)
        .send(body)
        .expect(201);
      for (const patch of [
        { sourceAmount: invalid },
        { destinationAmount: invalid },
        { sourceAmount: unit * 2 },
      ])
        await api('patch', `${f.base}/transfers/${idOf(created)}`)
          .send(patch)
          .expect(400);
      expect(await amount(f.base, f.sourceAccountId)).toBe(10 - unit);
      expect(await amount(f.base, f.destinationAccountId)).toBe(unit);
    },
  );

  it('validates both opening dates, immutable identity, null fields and empty PATCH', async () => {
    const f = await fixture();
    await api('post', `${f.base}/transfers`)
      .send({ ...f.body, destinationAccountId: f.sourceAccountId })
      .expect(400);
    const later = idOf(
      await api('post', `${f.base}/accounts`)
        .send({ name: 'Later', currency: 'RUB', openedAt: '2025-03-01' })
        .expect(201),
    );
    await api('post', `${f.base}/transfers`)
      .send({ ...f.body, destinationAccountId: later })
      .expect(400);
    await api('post', `${f.base}/transfers`)
      .send({ ...f.body, transactionDate: '2023-12-31' })
      .expect(400);
    for (const extra of [
      { currency: 'RUB' },
      { ownerId: f.groupId },
      { createdBy: ctx.users[1].id },
      { participantId: ctx.users[0].id },
      { source: { currency: 'RUB' } },
      { description: null },
      { sourceAmount: null },
    ])
      await api('post', `${f.base}/transfers`)
        .send({ ...f.body, ...extra })
        .expect(400);
    const created = await api('post', `${f.base}/transfers`)
      .send(f.body)
      .expect(201);
    for (const patch of [
      {},
      { sourceAccountId: later },
      { destinationAccountId: later },
      { currency: 'USD' },
      { transactionDate: '2025-02-16' },
      { description: null },
      { sourceAmount: null },
      { destinationAmount: null },
    ])
      await api('patch', `${f.base}/transfers/${idOf(created)}`)
        .send(patch)
        .expect(400);
    expect(await amount(f.base, f.sourceAccountId)).toBe(90);
  });

  it('filters any side and currency with stable mixed history while excluding expenses/limits', async () => {
    const f = await fixture('RUB', 'USD', 1000);
    const created = await api('post', `${f.base}/transfers`)
      .send({ ...f.body, sourceAmount: 900, destinationAmount: 10 })
      .expect(201);
    const id = idOf(created);
    for (const route of ['transfers', 'transactions'])
      for (const query of [
        `accountId=${f.sourceAccountId}`,
        `accountId=${f.destinationAccountId}`,
        'currency=RUB',
        'currency=USD',
        `accountId=${f.sourceAccountId}&currency=USD&fromDate=2025-02-01&toDate=2025-02-28`,
      ]) {
        expect(
          (await api('get', `${f.base}/${route}?${query}`).expect(200)).body,
        ).toMatchObject({
          total: 1,
          items: [
            {
              _id: id,
              effectiveRate: {
                baseCurrency: 'RUB',
                quoteCurrency: 'USD',
                rate: 10 / 900,
              },
            },
          ],
        });
      }
    expect(
      (await api('get', `${f.base}/transfers?currency=KWD`).expect(200)).body,
    ).toMatchObject({ total: 0, items: [] });
    await api('get', `${f.base}/transfers?currency=XYZ`).expect(400);
    await api(
      'get',
      `${f.base}/transfers?fromDate=2025-03-01&toDate=2025-02-01`,
    ).expect(400);
    expect(
      (await api('get', `${f.base}/expenses/revenue`).expect(200)).body,
    ).toMatchObject({ totalRevenue: 0, currencies: [] });
    const categoryId = idOf(
      await api('post', `${f.base}/expense-categories`)
        .send({ name: 'Unspent' })
        .expect(201),
    );
    expect(
      (
        await api('post', `${f.base}/expense-limits`)
          .send({
            categoryId,
            currency: 'RUB',
            total: 100,
            startDate: '2025-02-01',
            endDate: '2025-02-28',
          })
          .expect(201)
      ).body,
    ).toMatchObject({ rest: 100 });
    await api('post', `${f.base}/incomes`)
      .send({
        accountId: f.sourceAccountId,
        amount: 1,
        transactionDate: f.body.transactionDate,
      })
      .expect(201);
    const mixed = (
      await api('get', `${f.base}/transactions?limit=1`).expect(200)
    ).body as { total: number; items: Array<{ type: string }> };
    expect(mixed.total).toBe(2);
    expect(mixed.items).toHaveLength(1);
    expect(mixed.items[0].type).toBe('income');
    expect(
      (
        await api(
          'get',
          `${f.base}/transactions?transactionType=transfer`,
        ).expect(200)
      ).body,
    ).toMatchObject({ total: 1, items: [{ _id: id }] });
  });

  it('rejects personal/foreign group references even when the actor owns both budgets', async () => {
    const f = await fixture();
    const other = await fixture();
    const personal = idOf(
      await api('post', '/accounts')
        .send({ name: 'Private', currency: 'RUB', type: 'saving' })
        .expect(201),
    );
    for (const destinationAccountId of [personal, other.destinationAccountId])
      await api('post', `${f.base}/transfers`)
        .send({ ...f.body, destinationAccountId })
        .expect(404);
    const created = await api('post', `${f.base}/transfers`)
      .send(f.body)
      .expect(201);
    for (const verb of ['get', 'delete'] as const)
      await api(verb, `${other.base}/transfers/${idOf(created)}`).expect(404);
    await api('patch', `${other.base}/transfers/${idOf(created)}`)
      .send({ description: 'Foreign' })
      .expect(404);
    expect(await amount(f.base, f.sourceAccountId)).toBe(90);
  });

  it('creates distinct POST records, enforces funds on retry and compensates DELETE once', async () => {
    const f = await fixture('RUB', 'RUB', 10);
    const first = await api('post', `${f.base}/transfers`)
      .send({ ...f.body, sourceAmount: 6, destinationAmount: 6 })
      .expect(201);
    await api('post', `${f.base}/transfers`)
      .send({ ...f.body, sourceAmount: 6, destinationAmount: 6 })
      .expect(400);
    const second = await api('post', `${f.base}/transfers`)
      .send({ ...f.body, sourceAmount: 4, destinationAmount: 4 })
      .expect(201);
    expect(idOf(second)).not.toBe(idOf(first));
    await api('delete', `${f.base}/transfers/${idOf(first)}`).expect(204);
    await api('delete', `${f.base}/transfers/${idOf(first)}`).expect(404);
    expect(await amount(f.base, f.sourceAccountId)).toBe(6);
    expect(await amount(f.base, f.destinationAccountId)).toBe(4);
  });
});
