import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { User } from '../src/modules/users/schemas/user.schema';
import { startSpacesTestApp } from './helpers/spaces-test-app';
type Actor = {
  userId: string;
  firstName: string | null;
  isAnonymized: boolean;
};
type DebtRow = {
  _id: string;
  createdBy: string;
  createdByActor: Actor;
  principalAmount: number;
  remainingAmount: number;
  status: string;
};
type Repayment = {
  _id: string;
  createdBy: string;
  createdByActor: Actor;
  incomeId?: string;
  amount: number;
  isIncome: boolean;
  cancelledAt: string | null;
  cancelledBy?: string;
  cancelledByActor?: Actor;
};
type Result = {
  debt: DebtRow;
  repayment: Repayment;
};
type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};
describe('Space debts HTTP contract', () => {
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
  async function fixture(currency = 'USD', opening = 500) {
    await ctx.connection.collection('spaceinvitationratelimits').deleteMany({});
    const space = await api('post', '/spaces')
      .send({ name: 'Debt budget' })
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
    const accountId = idOf(
      await api('post', `${base}/accounts`)
        .send({
          name: 'Cash',
          currency,
          amount: opening,
          openedAt: '2024-01-01T00:00:00Z',
        })
        .expect(201),
    );
    const body = {
      debtor: 'Borrower',
      currency,
      principalAmount: 100,
      description: 'Shared debt',
      dueDate: '2025-02-28',
    };
    const create = async (user = 1, changes: Record<string, unknown> = {}) =>
      (
        await api('post', `${base}/debts`, user)
          .send({ ...body, ...changes })
          .expect(201)
      ).body as DebtRow;
    const repay = async (
      id: string,
      changes: Record<string, unknown> = {},
      user = 1,
    ) =>
      (
        await api('post', `${base}/debts/${id}/repayments`, user)
          .send({
            amount: 40,
            isIncome: true,
            accountId,
            repaymentDate: '2025-02-15T12:00:00Z',
            ...changes,
          })
          .expect(201)
      ).body as Result;
    return { base, accountId, body, create, repay };
  }
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  it('creates server-owned receivables without financial effects and isolates budgets', async () => {
    const f = await fixture();
    const account = await ctx.connection
      .collection('accounts')
      .findOne({ _id: new Types.ObjectId(f.accountId) });
    const row = await f.create(1, {
      debtor: '  Borrower  ',
      currency: ' usd ',
    });
    expect(row).toMatchObject({
      principalAmount: 100,
      remainingAmount: 100,
      status: 'active',
      createdBy: ctx.users[1].id,
      spaceId: f.base.split('/')[2],
      debtor: 'Borrower',
      currency: 'USD',
    });
    for (const field of [
      'userId',
      'participantId',
      'participantActor',
      'type',
      'incomeId',
    ])
      expect(row).not.toHaveProperty(field);
    expect(
      await ctx.connection
        .collection('accounts')
        .findOne({ _id: new Types.ObjectId(f.accountId) }),
    ).toEqual(account);
    expect(
      await ctx.connection
        .collection('transactions')
        .countDocuments({ spaceId: new Types.ObjectId(f.base.split('/')[2]) }),
    ).toBe(0);
    await api('get', `${f.base}/debts`, -1).expect(401);
    await api('get', `${f.base}/debts/${row._id}`, 3).expect(404);
    await api('get', `/debts/${row._id}`, 1).expect(404);
    const other = await fixture();
    await api('get', `${other.base}/debts/${row._id}`).expect(404);
    await api('post', `${other.base}/debts/${row._id}/repayments`)
      .send({ amount: 1, isIncome: false, repaymentDate: '2025-01-01' })
      .expect(404);
  });
  it('uses debt authority rather than repayment authorship and respects revoked delegation', async () => {
    const f = await fixture();
    const debt = await f.create();
    await api('patch', `${f.base}/debts/${debt._id}`, 2)
      .send({ description: 'Denied' })
      .expect(403);
    await api('patch', `${f.base}/members/${ctx.users[2].id}/permissions`)
      .send({ manageLimits: true })
      .expect(200);
    await api('post', `${f.base}/debts/${debt._id}/repayments`, 2)
      .send({ amount: 5, isIncome: false, repaymentDate: '2025-01-01' })
      .expect(403);
    await api('patch', `${f.base}/members/${ctx.users[2].id}/permissions`)
      .send({ manageTransactions: true })
      .expect(200);
    const result = await f.repay(debt._id, {}, 2);
    expect(result.debt.createdBy).toBe(ctx.users[1].id);
    expect(result.repayment.createdBy).toBe(ctx.users[2].id);
    await api('patch', `${f.base}/members/${ctx.users[2].id}/permissions`)
      .send({ manageTransactions: false })
      .expect(200);
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${result.repayment._id}/cancel`,
      2,
    ).expect(403);
    await api('patch', `${f.base}/incomes/${result.repayment.incomeId}`, 2)
      .send({ amount: 41 })
      .expect(409);
    await api('patch', `${f.base}/incomes/${result.repayment.incomeId}`, 1)
      .send({ amount: 41 })
      .expect(403);
    const cancelled = (
      await api(
        'post',
        `${f.base}/debts/${debt._id}/repayments/${result.repayment._id}/cancel`,
        1,
      ).expect(200)
    ).body as Result;
    expect(cancelled.debt.remainingAmount).toBe(100);
    expect(cancelled.repayment).toMatchObject({
      cancelledBy: ctx.users[1].id,
      cancelledByActor: { userId: ctx.users[1].id, firstName: 'Grace' },
    });
  });
  it('validates strict DTOs, boolean body values and immutable server fields', async () => {
    const f = await fixture();
    const debt = await f.create();
    for (const changes of [
      { debtor: '' },
      { debtor: ' ' },
      { debtor: 'x'.repeat(151) },
      { description: 'x'.repeat(151) },
      { dueDate: '2025-02-30' },
      { principalAmount: null },
      { debtor: null },
      { remainingAmount: 10 },
      { status: 'closed' },
      { direction: 'receivable' },
      { createdBy: ctx.users[0].id },
      { spaceId: new Types.ObjectId().toString() },
      { ownerType: 'user' },
      { ownerId: ctx.users[0].id },
      { userId: ctx.users[0].id },
      { createdByActor: {} },
    ])
      await api('post', `${f.base}/debts`, 1)
        .send({ ...f.body, ...changes })
        .expect(400);
    for (const changes of [
      {},
      { debtor: null },
      { principalAmount: null },
      { description: null },
      { currency: 'RUB' },
      { remainingAmount: 20 },
      { status: 'closed' },
    ])
      await api('patch', `${f.base}/debts/${debt._id}`, 1)
        .send(changes)
        .expect(400);
    for (const value of ['true', 'false', 0, 1, null])
      await api('post', `${f.base}/debts/${debt._id}/repayments`, 1)
        .send({ amount: 1, isIncome: value, repaymentDate: '2025-01-01' })
        .expect(400);
    for (const body of [
      { amount: 1, repaymentDate: '2025-01-01' },
      { amount: 1, isIncome: true, repaymentDate: '2025-01-01' },
      {
        amount: 1,
        isIncome: false,
        accountId: f.accountId,
        repaymentDate: '2025-01-01',
      },
      { amount: 0, isIncome: false, repaymentDate: '2025-01-01' },
      { amount: 1, isIncome: false, repaymentDate: '2025-02-30' },
      {
        amount: 1,
        isIncome: false,
        incomeId: new Types.ObjectId().toString(),
        repaymentDate: '2025-01-01',
      },
      {
        amount: 1,
        isIncome: false,
        participantId: ctx.users[0].id,
        repaymentDate: '2025-01-01',
      },
    ])
      await api('post', `${f.base}/debts/${debt._id}/repayments`, 1)
        .send(body)
        .expect(400);
    for (const query of [
      'includeArchived=1',
      'includeArchived=yes',
      'status=cancelled',
      'unknown=1',
    ])
      await api('get', `${f.base}/debts?${query}`).expect(400);
    await api('post', `${f.base}/debts/${debt._id}/archive`, 1)
      .send({ unknown: true })
      .expect(400);
    await api('get', `${f.base}/debts/${debt._id}/transactions`).expect(404);
    await api('post', `${f.base}/debts/${debt._id}/close`, 1).expect(404);
  });
  it.each([
    ['JPY', 1, 0.1],
    ['RUB', 0.01, 0.001],
    ['KWD', 0.001, 0.0001],
  ] as const)(
    'uses %s precision for principal and repayment',
    async (currency, unit, invalid) => {
      const f = await fixture(currency);
      const debt = await f.create(1, { principalAmount: unit * 3 });
      for (const principalAmount of [invalid, 0, -1])
        await api('post', `${f.base}/debts`, 1)
          .send({ ...f.body, principalAmount })
          .expect(400);
      await api('post', `${f.base}/debts/${debt._id}/repayments`, 1)
        .send({ amount: invalid, isIncome: false, repaymentDate: '2025-01-01' })
        .expect(400);
      const first = await f.repay(debt._id, { amount: unit });
      expect(first.debt.remainingAmount).toBe(Number((unit * 2).toFixed(3)));
      const closed = await f.repay(debt._id, {
        amount: unit * 2,
        isIncome: false,
        accountId: undefined,
      });
      expect(closed.debt).toMatchObject({
        remainingAmount: 0,
        status: 'closed',
      });
    },
  );
  it('permits principal edits only before history and keeps metadata editable on closed debt', async () => {
    const f = await fixture();
    const debt = await f.create();
    expect(
      (
        await api('patch', `${f.base}/debts/${debt._id}`, 1)
          .send({ principalAmount: 200, dueDate: null, description: '' })
          .expect(200)
      ).body,
    ).toMatchObject({
      principalAmount: 200,
      remainingAmount: 200,
      dueDate: null,
      description: '',
    });
    const result = await f.repay(debt._id, {
      amount: 200,
      isIncome: false,
      accountId: undefined,
    });
    expect(result.debt).toMatchObject({ remainingAmount: 0, status: 'closed' });
    await api('patch', `${f.base}/debts/${debt._id}`, 1)
      .send({ debtor: 'Renamed' })
      .expect(200);
    await api('patch', `${f.base}/debts/${debt._id}`, 1)
      .send({ principalAmount: 300 })
      .expect(409);
    await api('post', `${f.base}/debts/${debt._id}/repayments`, 1)
      .send({ amount: 1, isIncome: false, repaymentDate: '2025-01-01' })
      .expect(400);
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${result.repayment._id}/cancel`,
      1,
    ).expect(200);
    await api('patch', `${f.base}/debts/${debt._id}`, 1)
      .send({ principalAmount: 300 })
      .expect(409);
  });
  it('separates financial/noncash accounting, closes once and compensates the original date', async () => {
    const f = await fixture();
    const debt = await f.create();
    const check = async (income: number, balance: number) => {
      expect(
        (await api('get', `${f.base}/accounts/${f.accountId}`).expect(200))
          .body,
      ).toMatchObject({ amount: balance });
      const report = (
        await api(
          'get',
          `${f.base}/reports/months?fromDate=2025-02-01&toDate=2025-02-28`,
        ).expect(200)
      ).body as {
        currencies: {
          currency: string;
          incomes: number;
          expenses: number;
        }[];
      }[];
      expect(report[0].currencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            currency: 'USD',
            incomes: income,
            expenses: 0,
          }),
        ]),
      );
    };
    const otherAccounts = await ctx.connection
      .collection('accounts')
      .find({ spaceId: { $ne: new Types.ObjectId(f.base.split('/')[2]) } })
      .sort({ _id: 1 })
      .toArray();
    const first = await f.repay(debt._id);
    expect(first.debt).toMatchObject({
      principalAmount: 100,
      remainingAmount: 60,
      status: 'active',
    });
    const income = (
      await api('get', `${f.base}/incomes/${first.repayment.incomeId}`).expect(
        200,
      )
    ).body as Record<string, unknown>;
    expect(income).toMatchObject({
      amount: 40,
      currency: 'USD',
      createdBy: ctx.users[1].id,
      origin: { type: 'debt', id: debt._id },
      transactionDate: '2025-02-15T12:00:00.000Z',
      description: 'Погашение долга Borrower',
    });
    await check(40, 540);
    const second = await f.repay(debt._id, {
      amount: 60,
      isIncome: false,
      accountId: undefined,
    });
    expect(second.debt).toMatchObject({ remainingAmount: 0, status: 'closed' });
    expect(second.repayment).not.toHaveProperty('incomeId');
    await check(40, 540);
    for (const changes of [{ amount: 41 }, { description: 'No' }])
      await api('patch', `${f.base}/incomes/${first.repayment.incomeId}`, 1)
        .send(changes)
        .expect(409);
    await api(
      'delete',
      `${f.base}/incomes/${first.repayment.incomeId}`,
      1,
    ).expect(409);
    await api('delete', `/transactions/${first.repayment.incomeId}`, 1).expect(
      404,
    );
    await api('patch', `/incomes/${first.repayment.incomeId}`, 1)
      .send({ amount: 41 })
      .expect(404);
    const cancelled = (
      await api(
        'post',
        `${f.base}/debts/${debt._id}/repayments/${first.repayment._id}/cancel`,
        1,
      ).expect(200)
    ).body as Result;
    expect(cancelled.debt).toMatchObject({
      principalAmount: 100,
      remainingAmount: 40,
      status: 'active',
    });
    expect(cancelled.repayment).toMatchObject({
      amount: 40,
      incomeId: first.repayment.incomeId,
      cancelledBy: ctx.users[1].id,
    });
    expect(cancelled.repayment.cancelledAt).not.toBeNull();
    await check(0, 500);
    await api('get', `${f.base}/incomes/${first.repayment.incomeId}`).expect(
      404,
    );
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${first.repayment._id}/cancel`,
      1,
    ).expect(409);
    const raw = await ctx.connection
      .collection('transactions')
      .findOne({ _id: new Types.ObjectId(first.repayment.incomeId) });
    expect(raw).toMatchObject({
      amount: 40,
      origin: { type: 'debt', id: new Types.ObjectId(debt._id) },
    });
    expect(raw?.deletedAt).toBeInstanceOf(Date);
    const history = (
      await api('get', `${f.base}/debts/${debt._id}/repayments`, 2).expect(200)
    ).body as Page<Repayment>;
    expect(history.total).toBe(2);
    expect(
      history.items.find((r) => r._id === first.repayment._id)?.cancelledAt,
    ).not.toBeNull();
    expect(
      await ctx.connection
        .collection('accounts')
        .find({ spaceId: { $ne: new Types.ObjectId(f.base.split('/')[2]) } })
        .sort({ _id: 1 })
        .toArray(),
    ).toEqual(otherAccounts);
  });
  it('rejects overpayment, foreign references, currency/date mismatch and corrupted cancellation without changes', async () => {
    const f = await fixture();
    const debt = await f.create();
    const other = await fixture();
    const rub = idOf(
      await api('post', `${f.base}/accounts`)
        .send({ name: 'RUB', currency: 'RUB' })
        .expect(201),
    );
    for (const [changes, status] of [
      [{ amount: 101 }, 400],
      [{ accountId: other.accountId }, 404],
      [{ accountId: rub }, 400],
      [{ repaymentDate: '2023-01-01' }, 400],
    ] as const)
      await api('post', `${f.base}/debts/${debt._id}/repayments`, 1)
        .send({
          amount: 40,
          isIncome: true,
          accountId: f.accountId,
          repaymentDate: '2025-01-01',
          ...changes,
        })
        .expect(status);
    expect(
      (await api('get', `${f.base}/debts/${debt._id}`).expect(200)).body,
    ).toMatchObject({ remainingAmount: 100 });
    const result = await f.repay(debt._id);
    const path = `${f.base}/debts/${debt._id}/repayments/${result.repayment._id}/cancel`;
    const txs = ctx.connection.collection('transactions');
    const filter = { _id: new Types.ObjectId(result.repayment.incomeId) };
    for (const changes of [
      { amount: 39 },
      { currency: 'RUB' },
      { transactionDate: new Date('2025-02-14') },
      { origin: { type: 'debt', id: new Types.ObjectId() } },
    ]) {
      const before = await txs.findOne(filter);
      await txs.updateOne(filter, { $set: changes });
      await api('post', path, 1).expect(409);
      expect(
        (await api('get', `${f.base}/debts/${debt._id}`).expect(200)).body,
      ).toMatchObject({ remainingAmount: 60 });
      await txs.replaceOne(filter, before!);
    }
    await api(
      'post',
      `${other.base}/debts/${debt._id}/repayments/${result.repayment._id}/cancel`,
    ).expect(404);
  });
  it('freezes archived debt/account and preserves ordinary 404 priority over the linked-income guard', async () => {
    const f = await fixture();
    const debt = await f.create();
    const result = await f.repay(debt._id);
    await api('post', `${f.base}/accounts/${f.accountId}/archive`).expect(204);
    await api('patch', `${f.base}/incomes/${result.repayment.incomeId}`, 1)
      .send({ amount: 41 })
      .expect(404);
    await api(
      'delete',
      `${f.base}/incomes/${result.repayment.incomeId}`,
      1,
    ).expect(404);
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${result.repayment._id}/cancel`,
      1,
    ).expect(404);
    const noncash = await f.repay(debt._id, {
      amount: 10,
      isIncome: false,
      accountId: undefined,
    });
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${noncash.repayment._id}/cancel`,
      1,
    ).expect(200);
    await api('post', `${f.base}/debts/${debt._id}/archive`, 1).expect(204);
    await api('get', `${f.base}/debts/${debt._id}`, 2).expect(200);
    await api('get', `${f.base}/debts/${debt._id}/repayments`, 2).expect(200);
    expect(
      (
        (await api('get', `${f.base}/debts?includeArchived=false`).expect(200))
          .body as Page<DebtRow>
      ).total,
    ).toBe(0);
    expect(
      (
        (await api('get', `${f.base}/debts?includeArchived=true`).expect(200))
          .body as Page<DebtRow>
      ).total,
    ).toBe(1);
    await api('patch', `${f.base}/debts/${debt._id}`, 1)
      .send({ description: 'Frozen' })
      .expect(404);
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${noncash.repayment._id}/cancel`,
      1,
    ).expect(404);
    await api('delete', `${f.base}/debts/${debt._id}`, 1).expect(409);
    await api('post', `${f.base}/debts/${debt._id}/archive`, 1).expect(404);
  });
  it('keeps debt and cancelled repayment pages deterministic at equal timestamps', async () => {
    const f = await fixture();
    const debts = [await f.create(), await f.create(), await f.create()];
    const createdAt = new Date('2025-01-01T00:00:00Z');
    await ctx.connection
      .collection('debts')
      .updateMany(
        { _id: { $in: debts.map((row) => new Types.ObjectId(row._id)) } },
        { $set: { createdAt } },
      );
    const debtIds = debts
      .map((row) => row._id)
      .sort()
      .reverse();
    for (let page = 1; page <= 3; page++) {
      const result = (
        await api(
          'get',
          `${f.base}/debts?page=${page}&limit=1&currency=usd&status=active`,
        ).expect(200)
      ).body as Page<DebtRow>;
      expect(result).toMatchObject({ total: 3, page, limit: 1 });
      expect(result.items.map((row) => row._id)).toEqual([debtIds[page - 1]]);
    }
    const rows = [] as Result[];
    for (let n = 0; n < 3; n++)
      rows.push(
        await f.repay(debts[0]._id, {
          amount: 10,
          isIncome: false,
          accountId: undefined,
        }),
      );
    await ctx.connection
      .collection('debttransactions')
      .updateMany(
        { debtId: new Types.ObjectId(debts[0]._id) },
        { $set: { createdAt } },
      );
    await api(
      'post',
      `${f.base}/debts/${debts[0]._id}/repayments/${rows[1].repayment._id}/cancel`,
      1,
    ).expect(200);
    const ids = rows
      .map((row) => row.repayment._id)
      .sort()
      .reverse();
    for (let page = 1; page <= 3; page++) {
      const result = (
        await api(
          'get',
          `${f.base}/debts/${debts[0]._id}/repayments?page=${page}&limit=1`,
        ).expect(200)
      ).body as Page<Repayment>;
      expect(result).toMatchObject({ total: 3, page, limit: 1 });
      expect(result.items.map((row) => row._id)).toEqual([ids[page - 1]]);
    }
  });
  it('cancels spent, backdated and future income on its original timeline without touching expense limits/revenue', async () => {
    const f = await fixture('USD', 0);
    const debt = await f.create();
    const cash = await f.repay(debt._id, { amount: 100 });
    const categoryId = idOf(
      await api('post', `${f.base}/expense-categories`)
        .send({ name: 'Spending' })
        .expect(201),
    );
    await api('post', `${f.base}/expense-limits`)
      .send({
        categoryId,
        currency: 'USD',
        total: 200,
        startDate: '2025-03-01',
        endDate: '2025-03-31',
      })
      .expect(201);
    await api('post', `${f.base}/expenses`, 1)
      .send({
        accountId: f.accountId,
        categoryId,
        amount: 120,
        transactionDate: '2025-03-01',
      })
      .expect(201);
    const report = async (
      fromDate: string,
      toDate: string,
      incomes: number,
      expenses: number,
      balance: number,
    ) => {
      const r = (
        await api(
          'get',
          `${f.base}/reports/months?fromDate=${fromDate}&toDate=${toDate}`,
        ).expect(200)
      ).body as {
        currencies: {
          currency: string;
          incomes: number;
          expenses: number;
          balance: number;
        }[];
      }[];
      expect(r[0].currencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            currency: 'USD',
            incomes,
            expenses,
            balance,
          }),
        ]),
      );
    };
    await report('2025-02-01', '2025-02-28', 100, 0, 100);
    await report('2025-03-01', '2025-03-31', 0, 120, -20);
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${cash.repayment._id}/cancel`,
      1,
    ).expect(200);
    expect(
      (await api('get', `${f.base}/accounts/${f.accountId}`).expect(200)).body,
    ).toMatchObject({ amount: -120 });
    await report('2025-02-01', '2025-02-28', 0, 0, 0);
    await report('2025-03-01', '2025-03-31', 0, 120, -120);
    const future = await f.repay(debt._id, {
      amount: 50,
      repaymentDate: '2035-01-15',
    });
    expect(
      (await api('get', `${f.base}/accounts/${f.accountId}`).expect(200)).body,
    ).toMatchObject({ amount: -120 });
    await report('2035-01-01', '2035-01-31', 50, 0, -70);
    await api(
      'post',
      `${f.base}/debts/${debt._id}/repayments/${future.repayment._id}/cancel`,
      1,
    ).expect(200);
    await report('2035-01-01', '2035-01-31', 0, 0, -120);
    expect(
      (await api('get', `${f.base}/expenses/revenue`).expect(200)).body,
    ).toMatchObject({ totalRevenue: 120 });
    expect(
      (
        await api(
          'get',
          `${f.base}/expense-limits?periodDate=2025-03-15`,
        ).expect(200)
      ).body,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ rest: 80 })]));
  });
  it('resolves current debt/repayment/canceller profiles once per page/response and anonymizes unavailable users', async () => {
    const f = await fixture();
    const debt = await f.create();
    const users = ctx.app.get<Model<User>>(getModelToken(User.name));
    const spy = jest.spyOn(users, 'find');
    const result = await f.repay(debt._id, {}, 0);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    const cancelled = (
      await api(
        'post',
        `${f.base}/debts/${debt._id}/repayments/${result.repayment._id}/cancel`,
        1,
      ).expect(200)
    ).body as Result;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cancelled.repayment.cancelledByActor).toMatchObject({
      userId: ctx.users[1].id,
      firstName: 'Grace',
    });
    spy.mockRestore();
    await users.updateOne(
      { _id: ctx.users[1].id },
      { $set: { firstName: 'Renamed' } },
    );
    await api('post', `${f.base}/leave`, 1).expect(204);
    await api('get', `${f.base}/debts/${debt._id}`, 1).expect(404);
    expect(
      (
        (await api('get', `${f.base}/debts/${debt._id}`).expect(200))
          .body as DebtRow
      ).createdByActor.firstName,
    ).toBe('Renamed');
    for (const status of ['deletion_pending', 'deleted']) {
      await users.updateOne({ _id: ctx.users[1].id }, { $set: { status } });
      expect(
        (
          (await api('get', `${f.base}/debts/${debt._id}`).expect(200))
            .body as DebtRow
        ).createdByActor,
      ).toMatchObject({ firstName: null, isAnonymized: true });
      const row = (
        await api(
          'get',
          `${f.base}/debts/${debt._id}/repayments/${result.repayment._id}`,
        ).expect(200)
      ).body as Repayment;
      expect(row.cancelledByActor).toMatchObject({
        firstName: null,
        isAnonymized: true,
      });
    }
    await ctx.connection
      .collection('debts')
      .updateOne(
        { _id: new Types.ObjectId(debt._id) },
        { $set: { createdBy: new Types.ObjectId() } },
      );
    expect(
      (
        (await api('get', `${f.base}/debts/${debt._id}`).expect(200))
          .body as DebtRow
      ).createdByActor.isAnonymized,
    ).toBe(true);
    await users.updateOne(
      { _id: ctx.users[1].id },
      { $set: { status: 'active', firstName: 'Grace' } },
    );
  });
});
