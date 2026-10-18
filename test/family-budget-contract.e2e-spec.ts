import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import {
  UserDeletionService,
  UserDeletionWorker,
} from '../src/modules/users/user-deletion.service';
import { startGroupsTestApp } from './helpers/groups-test-app';

type Row = { _id: string } & Record<string, unknown>;
type Page = { items: Row[]; total: number; page: number; limit: number };
type RepaymentResult = { debt: Row; repayment: Row };
const idOf = (response: Response) => (response.body as Row)._id;

describe('Family budget final HTTP contract (real replica set)', () => {
  let ctx: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const api = (method: 'get' | 'post' | 'patch', path: string, user = 0) => {
    const call = request(
      ctx.app.getHttpServer() as Parameters<typeof request>[0],
    )[method](`/api/v1${path}`);
    return user < 0
      ? call
      : call.auth(ctx.users[user].token, { type: 'bearer' });
  };
  const get = async (path: string, user = 0): Promise<unknown> =>
    (await api('get', path, user).expect(200)).body as unknown;
  const createGroup = async (name: string) =>
    (
      (await api('post', '/groups').send({ name, type: 'family' }).expect(201))
        .body as { id: string }
    ).id;
  const january = '/reports/months?fromDate=2024-01-01&toDate=2024-01-31';
  beforeAll(async () => {
    ctx = await startGroupsTestApp(['USD', 'EUR']);
  }, 60000);
  afterAll(async () => ctx?.close());

  it('connects invitation, delegated finances, plans, debts, isolation and anonymous history', async () => {
    // Personal settings and control budgets are independent of family currencies.
    const controls: { path: string; user: number; before: unknown }[] = [];
    const personalIds: string[] = [];
    for (const [user, currency] of ['USD', 'EUR'].entries()) {
      expect(await get('/users/me', user)).toMatchObject({
        defaultCurrency: currency,
      });
      personalIds.push(
        idOf(
          await api('post', '/accounts', user)
            .send({
              name: `Personal ${currency}`,
              type: 'balance',
              currency,
              amount: 37,
            })
            .expect(201),
        ),
      );
      for (const path of ['/accounts', '/transactions', '/plans', '/debts'])
        controls.push({ path, user, before: await get(path, user) });
    }
    const second = `/groups/${await createGroup('Second budget')}`;
    const secondAccount = idOf(
      await api('post', `${second}/accounts`)
        .send({
          name: 'Independent',
          currency: 'EUR',
          amount: 71,
          openedAt: '2024-01-01T00:00:00Z',
        })
        .expect(201),
    );
    for (const suffix of [
      '/accounts',
      '/transactions',
      '/plans',
      '/debts',
      january,
    ]) {
      const path = `${second}${suffix}`;
      controls.push({ path, user: 0, before: await get(path) });
    }
    const groupId = await createGroup('Family contract');
    const base = `/groups/${groupId}`;
    const invite = (await api('post', `${base}/invitations`).expect(201))
      .body as {
      token: string;
      expiresAt: string;
    };
    const preview = await api('post', '/group-invitations/preview', 1)
      .send({ token: invite.token })
      .expect(200);
    expect(preview.body).toEqual({
      name: 'Family contract',
      type: 'family',
      expiresAt: invite.expiresAt,
    });
    expect(preview.headers['cache-control']).toBe('no-store');
    await api('get', base, 1).expect(404);
    await api('post', '/group-invitations/accept', 1)
      .send({ token: invite.token })
      .expect(200);
    const permissions = {
      manageAccounts: true,
      manageCategories: true,
      manageLimits: true,
      manageTransactions: true,
    };
    await api('patch', `${base}/members/${ctx.users[1].id}/permissions`)
      .send(permissions)
      .expect(200);
    expect(await get(base, 1)).toMatchObject({
      id: groupId,
      role: 'member',
      permissions,
    });
    const createAccount = async (
      name: string,
      type: string,
      currency: string,
      amount: number,
    ) =>
      idOf(
        await api('post', `${base}/accounts`, 1)
          .send({
            name,
            type,
            currency,
            amount,
            openedAt: '2024-01-01T00:00:00Z',
          })
          .expect(201),
      );
    const cash = await createAccount('Family cash', 'balance', 'RUB', 1000);
    const saving = await createAccount('Reserve', 'saving', 'RUB', 100);
    const dollars = await createAccount('Dollars', 'balance', 'USD', 50);
    const category = idOf(
      await api('post', `${base}/expense-categories`, 1)
        .send({ name: 'Purchases' })
        .expect(201),
    );
    await api('post', `${base}/expense-limits`, 1)
      .send({
        categoryId: category,
        currency: 'RUB',
        total: 500,
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-31T23:59:59.999Z',
      })
      .expect(201);
    const income = idOf(
      await api('post', `${base}/incomes`)
        .send({
          accountId: cash,
          amount: 200,
          transactionDate: '2024-01-02T12:00:00Z',
        })
        .expect(201),
    );
    await api('post', `${base}/expenses`, 1)
      .send({
        accountId: cash,
        categoryId: category,
        amount: 50,
        participantId: ctx.users[0].id,
        transactionDate: '2024-01-03T12:00:00Z',
      })
      .expect(201);
    await api('post', `${base}/transfers`, 1)
      .send({
        sourceAccountId: cash,
        destinationAccountId: saving,
        sourceAmount: 100,
        destinationAmount: 100,
        transactionDate: '2024-01-04T12:00:00Z',
      })
      .expect(201);
    const beforePlan = await get(`${base}${january}`);
    const plan = idOf(
      await api('post', `${base}/plans`)
        .send({
          description: 'Planned purchase',
          amount: 100,
          currency: 'RUB',
          targetDate: '2024-01-05T12:00:00Z',
          categoryId: category,
        })
        .expect(201),
    );
    expect(await get(`${base}${january}`)).toEqual(beforePlan);
    const closed = (
      await api('post', `${base}/plans/${plan}/close`, 1)
        .send({
          accountId: cash,
          amount: 120,
          closingDate: '2024-01-05T12:00:00Z',
          participantId: ctx.users[0].id,
        })
        .expect(201)
    ).body as Row;
    expect(closed).toMatchObject({
      amount: 100,
      status: 'closed',
      createdBy: ctx.users[0].id,
    });
    expect(
      await get(`${base}/expenses/${String(closed.expenseId)}`),
    ).toMatchObject({
      amount: 120,
      createdBy: ctx.users[1].id,
      participantId: ctx.users[0].id,
      origin: { type: 'plan', id: plan },
    });
    const beforeDebt = await get(`${base}${january}`);
    const debt = idOf(
      await api('post', `${base}/debts`)
        .send({ debtor: 'Borrower', principalAmount: 200, currency: 'RUB' })
        .expect(201),
    );
    expect(await get(`${base}${january}`)).toEqual(beforeDebt);
    const repay = async (amount: number, isIncome: boolean, date: string) =>
      (
        await api('post', `${base}/debts/${debt}/repayments`, 1)
          .send({
            amount,
            isIncome,
            repaymentDate: date,
            ...(isIncome ? { accountId: cash } : {}),
          })
          .expect(201)
      ).body as RepaymentResult;
    const financial = await repay(60, true, '2024-01-06T12:00:00Z');
    expect(
      await get(`${base}/incomes/${String(financial.repayment.incomeId)}`),
    ).toMatchObject({
      amount: 60,
      currency: 'RUB',
      createdBy: ctx.users[1].id,
      origin: { type: 'debt', id: debt },
    });
    const beforeNoncash = await get(`${base}${january}`);
    const noncash = await repay(20, false, '2024-01-07T12:00:00Z');
    expect(noncash.repayment).not.toHaveProperty('incomeId');
    expect(await get(`${base}${january}`)).toEqual(beforeNoncash);
    const cancelled = await repay(10, true, '2024-01-08T12:00:00Z');
    const cancelledResult = (
      await api(
        'post',
        `${base}/debts/${debt}/repayments/${cancelled.repayment._id}/cancel`,
        1,
      ).expect(200)
    ).body as RepaymentResult;
    expect(cancelledResult).toMatchObject({
      debt: { remainingAmount: 120, status: 'active' },
      repayment: {
        incomeId: cancelled.repayment.incomeId,
        cancelledBy: ctx.users[1].id,
      },
    });
    expect(cancelledResult.repayment.cancelledAt).toEqual(expect.any(String));
    await api(
      'get',
      `${base}/incomes/${String(cancelled.repayment.incomeId)}`,
    ).expect(404);

    const expectedReport = [
      {
        period: '2024-01',
        currencies: [
          {
            currency: 'RUB',
            incomes: 260,
            expenses: 170,
            transfersIn: 100,
            transfersOut: 100,
            balance: 990,
            saving: 200,
            expensesByCategory: [{ categoryId: category, total: 170 }],
          },
          {
            currency: 'USD',
            incomes: 0,
            expenses: 0,
            transfersIn: 0,
            transfersOut: 0,
            balance: 50,
            saving: 0,
            expensesByCategory: [{ categoryId: category, total: 0 }],
          },
        ],
      },
    ];
    for (const user of [0, 1]) {
      expect(await get(`${base}${january}`, user)).toEqual(expectedReport);
      for (const [account, amount, currency] of [
        [cash, 990, 'RUB'],
        [saving, 200, 'RUB'],
        [dollars, 50, 'USD'],
      ] as const)
        expect(await get(`${base}/accounts/${account}`, user)).toMatchObject({
          amount,
          currency,
        });
      expect(await get(`${base}/expenses/revenue`, user)).toMatchObject({
        totalRevenue: 170,
        currencies: [{ currency: 'RUB', totalRevenue: 170 }],
      });
      expect(
        await get(`${base}/expense-limits?periodDate=2024-01-15`, user),
      ).toEqual([
        expect.objectContaining({ total: 500, rest: 330, currency: 'RUB' }),
      ]);
      const history = (await get(
        `${base}/debts/${debt}/repayments`,
        user,
      )) as Page;
      expect(history).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(history.items.map((row) => row._id)).toEqual([
        cancelled.repayment._id,
        noncash.repayment._id,
        financial.repayment._id,
      ]);
      const page = (await get(`${base}/transactions?limit=2`, user)) as Page;
      expect(page).toMatchObject({ total: 5, page: 1, limit: 2 });
      expect(page.items).toHaveLength(2);
    }
    // Failed references and DTO validation leave all family money unchanged.
    for (const accountId of [secondAccount, personalIds[0]])
      await api('post', `${base}/incomes`, 1)
        .send({ accountId, amount: 1, transactionDate: '2024-01-09T12:00:00Z' })
        .expect(404);
    const bad = await api('post', `${base}/incomes`, 1)
      .send({
        accountId: cash,
        amount: 1,
        currency: 'EUR',
        transactionDate: '2024-01-09T12:00:00Z',
      })
      .expect(400);
    expect(bad.body).toEqual({
      statusCode: 400,
      message: ['property currency should not exist'],
      error: 'Bad Request',
      path: `/api/v1${base}/incomes`,
      timestamp: expect.any(String) as unknown,
    });
    const unauthorized = await api('get', `${base}/accounts`, -1).expect(401);
    expect(unauthorized.body).toMatchObject({
      statusCode: 401,
      path: `/api/v1${base}/accounts`,
      error: 'Error',
    });
    await api('patch', `${base}/members/${ctx.users[1].id}/permissions`)
      .send({ manageTransactions: false })
      .expect(200);
    const forbidden = await api('patch', `${base}/incomes/${income}`, 1)
      .send({ amount: 250 })
      .expect(403);
    expect(forbidden.body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      path: `/api/v1${base}/incomes/${income}`,
    });
    expect(await get(`${base}${january}`)).toEqual(expectedReport);
    for (const control of controls)
      expect(await get(control.path, control.user)).toEqual(control.before);

    await api('patch', '/users/me', 1)
      .send({ firstName: 'Renamed spouse' })
      .expect(200);
    await api('post', `${base}/leave`, 1).expect(204);
    await api('get', `${base}/transactions`, 1).expect(404);
    expect(
      await get(`${base}/expenses/${String(closed.expenseId)}`),
    ).toMatchObject({
      createdByActor: { firstName: 'Renamed spouse', isAnonymized: false },
    });
    const assertAnonymous = async () => {
      const actor = {
        userId: ctx.users[1].id,
        firstName: null,
        lastName: null,
        isAnonymized: true,
      };
      const expense = (await get(
        `${base}/expenses/${String(closed.expenseId)}`,
      )) as Row;
      expect(expense.createdByActor).toEqual(actor);
      expect(expense).toMatchObject({
        createdBy: ctx.users[1].id,
        origin: { type: 'plan', id: plan },
        amount: 120,
      });
      const history = (await get(`${base}/debts/${debt}/repayments`)) as Page;
      for (const row of history.items)
        expect(row.createdByActor).toEqual(actor);
      expect(history.items[0].cancelledByActor).toEqual(actor);
      const serialized = JSON.stringify([
        expense,
        history,
        await get(`${base}/accounts`),
      ]);
      for (const field of [
        'Renamed spouse',
        'email',
        'authVersion',
        'password',
        'mutationVersion',
        'lockVersion',
        '__v',
      ])
        expect(serialized).not.toContain(field);
      expect(await get(`${base}${january}`)).toEqual(expectedReport);
      for (const control of controls.filter((c) => c.user === 0))
        expect(await get(control.path)).toEqual(control.before);
    };
    await ctx.app.get(UserDeletionService).request(ctx.users[1].id);
    await assertAnonymous();
    const worker = ctx.app.get(UserDeletionWorker);
    for (let stage = 0; stage < 4; stage++)
      await expect(worker.runOnce('family-contract')).resolves.toBe(true);
    expect(
      await ctx.connection
        .collection('users')
        .findOne({ _id: new Types.ObjectId(ctx.users[1].id) }),
    ).toMatchObject({ status: 'deleted' });
    await assertAnonymous();
  }, 60000);
});
