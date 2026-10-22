import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
import { TransactionsService } from '../src/modules/transactions/transactions/transactions.service';
import { spaceBudget } from '../src/common/budget/budget-context';
describe('Space account and transaction currency contract', () => {
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
      [method](`/api/v1${path}`)
      .auth(ctx.users[user].token, { type: 'bearer' });
  async function space() {
    const r = await api('post', '/spaces')
      .send({ name: 'Currency' })
      .expect(201);
    return `/spaces/${
      (
        r.body as {
          id: string;
        }
      ).id
    }`;
  }
  async function wallet(currency: string, amount = 0) {
    const base = await space();
    const r = await api('post', `${base}/accounts`)
      .send({
        name: ' Family ',
        currency,
        amount,
        openedAt: '2024-01-01T00:00:00Z',
      })
      .expect(201);
    return { base, accountId: idOf(r) };
  }
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  });
  it('requires monetary identity and normalizes name/currency independently of personal currency', async () => {
    const base = await space();
    for (const body of [
      {},
      { name: 'Only name' },
      { currency: 'USD' },
      { name: ' ', currency: 'USD' },
      { name: 'Wallet', currency: 'XYZ' },
    ]) {
      await api('post', `${base}/accounts`).send(body).expect(400);
    }
    expect((await api('get', `${base}/accounts`).expect(200)).body).toEqual([]);
    const r = await api('post', `${base}/accounts`)
      .send({
        name: ' Family ',
        currency: ' kwd ',
        amount: 0.001,
        openedAt: '2024-01-01T00:00:00Z',
      })
      .expect(201);
    expect(r.body).toMatchObject({
      name: 'Family',
      currency: 'KWD',
      initialAmount: 0.001,
      amount: 0.001,
    });
    const invitation = await api('post', `${base}/invitations`)
      .send({})
      .expect(201);
    await api('post', '/space-invitations/accept', 1)
      .send({
        token: (
          invitation.body as {
            token: string;
          }
        ).token,
      })
      .expect(200);
    await ctx.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(ctx.users[1].id) },
        { $set: { defaultCurrency: 'JPY' } },
      );
    expect(
      (await api('get', `${base}/accounts`, 1).expect(200)).body,
    ).toMatchObject([{ currency: 'KWD', amount: 0.001 }]);
    await api('post', `${base}/accounts`)
      .send({ name: 'Second', currency: 'USD' })
      .expect(201);
    await api('patch', `${base}/accounts/${idOf(r)}`)
      .send({ currency: 'USD' })
      .expect(400);
    expect(
      (await api('get', `${base}/accounts/${idOf(r)}`).expect(200)).body,
    ).toMatchObject({ currency: 'KWD' });
  });
  it.each([
    { currency: 'JPY', valid: 10, invalid: 10.1 },
    { currency: 'RUB', valid: 0.01, invalid: 0.001 },
    { currency: 'KWD', valid: 0.001, invalid: 0.0001 },
  ])(
    'validates $currency opening and operation precision on create and PATCH',
    async ({ currency, valid, invalid }) => {
      const base = await space();
      await api('post', `${base}/accounts`)
        .send({ name: 'Wallet', currency, amount: invalid })
        .expect(400);
      const accountId = idOf(
        await api('post', `${base}/accounts`)
          .send({
            name: 'Wallet',
            currency,
            amount: valid,
            openedAt: '2024-01-01T00:00:00Z',
          })
          .expect(201),
      );
      const categoryId = idOf(
        await api('post', `${base}/expense-categories`)
          .send({ name: 'Food' })
          .expect(201),
      );
      for (const kind of ['incomes', 'expenses']) {
        const body = {
          accountId,
          amount: valid,
          transactionDate: '2025-02-01T00:00:00Z',
          ...(kind === 'expenses' ? { categoryId } : {}),
        };
        await api('post', `${base}/${kind}`)
          .send({ ...body, amount: invalid })
          .expect(400);
        await api('post', `${base}/${kind}`)
          .send({ ...body, currency })
          .expect(400);
        const row = await api('post', `${base}/${kind}`).send(body).expect(201);
        expect(row.body).toMatchObject({ currency, amount: valid });
        await api('patch', `${base}/${kind}/${idOf(row)}`)
          .send({ amount: invalid })
          .expect(400);
        await api('patch', `${base}/${kind}/${idOf(row)}`)
          .send({ currency })
          .expect(400);
        expect(
          (await api('get', `${base}/${kind}/${idOf(row)}`).expect(200)).body,
        ).toMatchObject({ currency, amount: valid });
      }
      expect(
        (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
      ).toMatchObject({ amount: valid });
    },
  );
  it('keeps KWD items, edits, backdated balances and compensation precise', async () => {
    const { base, accountId } = await wallet('KWD', 0.001);
    const categoryId = idOf(
      await api('post', `${base}/expense-categories`)
        .send({ name: 'Food' })
        .expect(201),
    );
    const income = await api('post', `${base}/incomes`)
      .send({
        accountId,
        amount: 0.002,
        transactionDate: '2025-01-31T23:59:59.999Z',
      })
      .expect(201);
    const body = {
      accountId,
      categoryId,
      amount: 0.001,
      transactionDate: '2025-02-01T00:00:00Z',
      items: [{ name: 'Spice', price: 0.001, quantity: 0.5 }],
    };
    await api('post', `${base}/expenses`)
      .send({
        ...body,
        items: [{ name: 'Invalid', price: 0.0001, quantity: 1 }],
      })
      .expect(400);
    const expense = await api('post', `${base}/expenses`)
      .send(body)
      .expect(201);
    await api('patch', `${base}/expenses/${idOf(expense)}`)
      .send({ items: [{ name: 'Invalid', price: 0.0001, quantity: 1 }] })
      .expect(400);
    await api('patch', `${base}/expenses/${idOf(expense)}`)
      .send({
        amount: 0.002,
        items: [{ name: 'Spice', price: 0.002, quantity: 0.5 }],
      })
      .expect(200);
    expect(
      (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
    ).toMatchObject({
      amount: 0.001,
      timeline: expect.arrayContaining([
        expect.objectContaining({ amount: 0.001 }),
      ]) as unknown,
    });
    await api('patch', `${base}/incomes/${idOf(income)}`)
      .send({ amount: 0.003 })
      .expect(200);
    await api('delete', `${base}/expenses/${idOf(expense)}`).expect(204);
    expect(
      (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
    ).toMatchObject({ amount: 0.004 });
    await api('delete', `${base}/incomes/${idOf(income)}`).expect(204);
    expect(
      (await api('get', `${base}/accounts/${accountId}`).expect(200)).body,
    ).toMatchObject({ amount: 0.001 });
  });
  it('filters currency and returns expense revenue baskets including zero and multi-currency null', async () => {
    const { base, accountId } = await wallet('KWD');
    const categoryId = idOf(
      await api('post', `${base}/expense-categories`)
        .send({ name: 'Food' })
        .expect(201),
    );
    const expense = await api('post', `${base}/expenses`)
      .send({
        accountId,
        categoryId,
        amount: 0.001,
        transactionDate: '2025-02-01T00:00:00Z',
      })
      .expect(201);
    expect(
      (await api('get', `${base}/expenses/revenue`).expect(200)).body,
    ).toMatchObject({
      totalRevenue: 0.001,
      currencies: [{ currency: 'KWD', totalRevenue: 0.001 }],
    });
    expect(
      (await api('get', `${base}/expenses/revenue?currency=RUB`).expect(200))
        .body,
    ).toMatchObject({ totalRevenue: 0, currencies: [] });
    expect(
      (await api('get', `${base}/transactions?currency=RUB`).expect(200)).body,
    ).toMatchObject({ total: 0, items: [] });
    expect(
      (
        await api(
          'get',
          `${base}/expenses?currency=%20kwd%20&participantId=${ctx.users[0].id}&categoryId=${categoryId}&accountId=${accountId}&limit=1`,
        ).expect(200)
      ).body,
    ).toMatchObject({
      total: 1,
      items: [{ _id: idOf(expense), currency: 'KWD' }],
    });
    await api('get', `${base}/expenses?currency=XYZ`).expect(400);
    // Direct aggregate fixture exercises mixed currencies without exposing multiple space wallets.
    const spaceId = base.split('/').pop()!;
    await ctx.connection.collection('transactions').insertOne({
      spaceId: new Types.ObjectId(spaceId),
      type: 'expense',
      accountId: new Types.ObjectId(),
      category: new Types.ObjectId(categoryId),
      currency: 'RUB',
      amount: 1,
      transactionDate: new Date('2025-02-01T00:00:00Z'),
      deletedAt: null,
    });
    expect(
      await ctx.app
        .get(TransactionsService)
        .findRevenueForBudget(spaceBudget(spaceId), {}, 'expense'),
    ).toMatchObject({
      totalRevenue: null,
      currencies: [
        { currency: 'KWD', totalRevenue: 0.001 },
        { currency: 'RUB', totalRevenue: 1 },
      ],
    });
  });
});
