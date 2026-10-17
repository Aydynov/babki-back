import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { User } from '../src/modules/users/schemas/user.schema';
import { startGroupsTestApp } from './helpers/groups-test-app';

type Row = {
  _id: string;
  type: string;
  createdBy: string;
  participantId?: string;
  createdByActor: Actor;
  participantActor?: Actor;
};
type Actor = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  isAnonymized: boolean;
};
type Page = { items: Row[]; total: number; page: number; limit: number };
describe('Group financial actor HTTP contract', () => {
  let ctx: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const idOf = (r: Response) => (r.body as { _id: string })._id;
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
  async function join(base: string, user: number) {
    const invitation = await api('post', `${base}/invitations`).expect(201);
    await api('post', '/group-invitations/accept', user)
      .send({ token: (invitation.body as { token: string }).token })
      .expect(200);
  }
  async function fixture() {
    const group = await api('post', '/groups')
      .send({ name: 'Actors', type: 'family' })
      .expect(201);
    const base = `/groups/${(group.body as { id: string }).id}`;
    await join(base, 1);
    const account = async (type: string) =>
      idOf(
        await api('post', `${base}/accounts`)
          .send({
            name: type,
            type,
            currency: 'USD',
            amount: type === 'balance' ? 100 : 0,
            openedAt: '2024-01-01T00:00:00Z',
          })
          .expect(201),
      );
    const accountId = await account('balance'),
      destinationAccountId = await account('saving');
    const categoryId = idOf(
      await api('post', `${base}/expense-categories`)
        .send({ name: 'Food' })
        .expect(201),
    );
    const incomeBody = {
      accountId,
      amount: 20,
      transactionDate: '2025-02-15T12:00:00Z',
    };
    const expenseBody = {
      ...incomeBody,
      amount: 5,
      categoryId,
      participantId: ctx.users[1].id,
    };
    const transferBody = {
      sourceAccountId: accountId,
      destinationAccountId,
      sourceAmount: 10,
      destinationAmount: 10,
      transactionDate: incomeBody.transactionDate,
    };
    const expense = await api('post', `${base}/expenses`)
      .send(expenseBody)
      .expect(201);
    const income = await api('post', `${base}/incomes`, 1)
      .send(incomeBody)
      .expect(201);
    const transfer = await api('post', `${base}/transfers`, 1)
      .send(transferBody)
      .expect(201);
    return {
      base,
      accountId,
      destinationAccountId,
      expenseBody,
      incomeBody,
      transferBody,
      expense,
      income,
      transfer,
    };
  }
  const actor = (user: number, name: string): Actor => ({
    userId: ctx.users[user].id,
    firstName: name,
    lastName: 'Test',
    isAnonymized: false,
  });
  beforeAll(async () => {
    ctx = await startGroupsTestApp();
  }, 60000);
  beforeEach(async () => {
    for (const name of [
      'groups',
      'groupmemberships',
      'groupmembershipevents',
      'groupinvitations',
      'groupinvitationratelimits',
      'accounts',
      'accountsnapshots',
      'expensecategories',
      'expenselimits',
      'transactions',
    ])
      await ctx.connection.collection(name).deleteMany({});
  });
  beforeEach(async () => {
    for (const [i, firstName] of [
      'Ada',
      'Grace',
      'Linus',
      'Margaret',
    ].entries())
      await ctx.connection
        .collection('users')
        .updateOne(
          { _id: new Types.ObjectId(ctx.users[i].id) },
          { $set: { firstName, lastName: 'Test' } },
        );
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await ctx?.close();
  });

  it('enriches all create, detail, list and mixed-history responses without changing attribution or money', async () => {
    const f = await fixture();
    for (const [path, created, expectedAuthor] of [
      ['expenses', f.expense, actor(0, 'Ada')],
      ['incomes', f.income, actor(1, 'Grace')],
      ['transfers', f.transfer, actor(1, 'Grace')],
    ] as const) {
      const row = created.body as Row;
      expect(row.createdByActor).toEqual(expectedAuthor);
      expect(row.createdBy).toBe(expectedAuthor.userId);
      if (path === 'expenses') {
        expect(row.participantActor).toEqual(actor(1, 'Grace'));
        expect(row.participantId).toBe(ctx.users[1].id);
      } else expect(row).not.toHaveProperty('participantActor');
      expect(
        (await api('get', `${f.base}/${path}/${row._id}`, 1).expect(200)).body,
      ).toEqual(row);
      expect(
        (await api('get', `${f.base}/${path}`, 1).expect(200)).body as Page,
      ).toMatchObject({ items: [row], total: 1, page: 1 });
    }
    const history = (await api('get', `${f.base}/transactions`, 1).expect(200))
      .body as Page;
    expect(history).toMatchObject({ total: 3, page: 1 });
    expect(history.items).toEqual([
      f.transfer.body,
      f.income.body,
      f.expense.body,
    ]);
    const page = (
      await api('get', `${f.base}/transactions?limit=1&page=2`, 1).expect(200)
    ).body as Page;
    expect(page).toMatchObject({
      total: 3,
      page: 2,
      limit: 1,
      items: [f.income.body],
    });
    expect(
      (await api('get', `${f.base}/accounts/${f.accountId}`).expect(200)).body,
    ).toHaveProperty('amount', 105);
    expect(
      (
        await api('get', `${f.base}/accounts/${f.destinationAccountId}`).expect(
          200,
        )
      ).body,
    ).toHaveProperty('amount', 10);
    expect(f.transfer.body).toMatchObject({
      type: 'transfer',
      effectiveRate: { rate: 1 },
    });
  });

  it('returns actor fields after PATCH and rejects client-supplied summaries', async () => {
    const f = await fixture();
    await join(f.base, 2);
    const changes = [
      ['expenses', f.expense, { participantId: ctx.users[2].id, amount: 6 }],
      ['incomes', f.income, { amount: 21 }],
      ['transfers', f.transfer, { sourceAmount: 11, destinationAmount: 11 }],
    ] as const;
    for (const [path, created, body] of changes) {
      const result = await api('patch', `${f.base}/${path}/${idOf(created)}`)
        .send(body)
        .expect(200);
      expect((result.body as Row).createdByActor).toEqual(
        (created.body as Row).createdByActor,
      );
      if (path === 'expenses')
        expect(result.body).toHaveProperty(
          'participantActor',
          actor(2, 'Linus'),
        );
      else expect(result.body).not.toHaveProperty('participantActor');
      for (const key of ['createdByActor', 'participantActor']) {
        await api('patch', `${f.base}/${path}/${idOf(created)}`)
          .send({ description: 'forged', [key]: actor(2, 'Linus') })
          .expect(400);
        const original =
          path === 'expenses'
            ? f.expenseBody
            : path === 'incomes'
              ? f.incomeBody
              : f.transferBody;
        await api('post', `${f.base}/${path}`)
          .send({ ...original, [key]: actor(2, 'Linus') })
          .expect(400);
      }
    }
    const model = ctx.app.get<Model<User>>(getModelToken(User.name));
    const lookup = jest.spyOn(model, 'find');
    for (const [path, created] of changes) {
      const response = await api(
        'delete',
        `${f.base}/${path}/${idOf(created)}`,
      ).expect(204);
      expect(response.text).toBe('');
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves current departed names while keeping member directory, filter and archive rules', async () => {
    const f = await fixture();
    await api('post', `${f.base}/leave`, 1).expect(204);
    await api('patch', '/users/me', 1)
      .send({ firstName: 'Renamed', lastName: 'Former' })
      .expect(200);
    const expected = { ...actor(1, 'Renamed'), lastName: 'Former' };
    for (const [path, response] of [
      ['expenses', f.expense],
      ['incomes', f.income],
      ['transfers', f.transfer],
    ] as const) {
      const result = await api(
        'get',
        `${f.base}/${path}/${idOf(response)}`,
      ).expect(200);
      expect(
        path === 'expenses'
          ? (result.body as Row).participantActor
          : (result.body as Row).createdByActor,
      ).toEqual(expected);
      await api('get', `${f.base}/${path}/${idOf(response)}`, 1).expect(404);
    }
    expect(
      (await api('get', `${f.base}/members`).expect(200)).body as Page,
    ).toHaveProperty('total', 1);
    await api('post', `${f.base}/accounts/${f.accountId}/archive`).expect(204);
    const filtered = (
      await api(
        'get',
        `${f.base}/expenses?participantId=${ctx.users[1].id}`,
      ).expect(200)
    ).body as Page;
    expect(filtered).toMatchObject({
      total: 1,
      items: [{ participantActor: expected }],
    });
    await api('patch', `${f.base}/expenses/${idOf(f.expense)}`)
      .send({ description: 'frozen' })
      .expect(404);
    await join(f.base, 1);
    await api('get', `${f.base}/incomes/${idOf(f.income)}`, 1).expect(200);
    await api('delete', `${f.base}/members/${ctx.users[1].id}`).expect(204);
    await api('get', `${f.base}/transactions`, 1).expect(404);
    expect(
      (await api('get', `${f.base}/incomes/${idOf(f.income)}`).expect(200))
        .body,
    ).toHaveProperty('createdByActor', expected);
  });

  it('scopes lookups to accessible page rows and keeps personal and aggregate contracts', async () => {
    const f = await fixture(),
      other = await fixture();
    const model = ctx.app.get<Model<User>>(getModelToken(User.name));
    const lookup = jest.spyOn(model, 'find');
    for (const [path, response] of [
      ['expenses', f.expense],
      ['incomes', f.income],
      ['transfers', f.transfer],
    ] as const) {
      await api('get', `${other.base}/${path}/${idOf(response)}`).expect(404);
      await api('get', `${f.base}/${path}/${idOf(response)}`, 3).expect(404);
      await api('get', `${f.base}/${path}/${idOf(response)}`, -1).expect(401);
    }
    const empty = await api(
      'get',
      `${f.base}/expenses?participantId=${ctx.users[3].id}`,
    ).expect(200);
    expect(empty.body).toMatchObject({ total: 0, items: [] });
    expect(lookup).not.toHaveBeenCalled();
    const page = (
      await api('get', `${f.base}/transactions?limit=1`).expect(200)
    ).body as Page;
    expect(page).toMatchObject({
      total: 3,
      items: [{ _id: idOf(f.transfer), createdByActor: actor(1, 'Grace') }],
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    const userFilter = lookup.mock.calls[0][0] as {
      _id: { $in: unknown[] };
      status: string;
    };
    expect(userFilter.status).toBe('active');
    expect(userFilter._id.$in.map(String)).toEqual([ctx.users[1].id]);
    lookup.mockClear();
    const personalAccount = idOf(
      await api('post', '/accounts')
        .send({
          name: 'Personal',
          type: 'balance',
          currency: 'USD',
          amount: 10,
          openedAt: '2024-01-01T00:00:00Z',
        })
        .expect(201),
    );
    const personal = await api('post', '/incomes')
      .send({
        accountId: personalAccount,
        amount: 1,
        transactionDate: '2025-02-15',
      })
      .expect(201);
    expect(personal.body).not.toHaveProperty('createdByActor');
    expect((await api('get', '/transactions').expect(200)).body).toMatchObject({
      total: 1,
    });
    const revenue = await api('get', `${f.base}/expenses/revenue`).expect(200);
    expect(revenue.body).toMatchObject({
      totalRevenue: 5,
      currencies: [{ currency: 'USD', totalRevenue: 5 }],
    });
    const report = await api(
      'get',
      `${f.base}/reports/months?fromDate=2025-02-01&toDate=2025-02-28`,
    ).expect(200);
    expect(JSON.stringify(report.body)).not.toContain('Actor');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('omits optional legacy participant and normalizes an absent last name', async () => {
    const f = await fixture();
    await ctx.connection
      .collection('transactions')
      .updateOne(
        { _id: new Types.ObjectId(idOf(f.expense)) },
        { $unset: { participantId: '' } },
      );
    await ctx.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(ctx.users[0].id) },
        { $unset: { lastName: '' } },
      );
    const result = await api(
      'get',
      `${f.base}/expenses/${idOf(f.expense)}`,
    ).expect(200);
    expect(result.body).not.toHaveProperty('participantActor');
    expect(result.body).toHaveProperty('createdByActor', {
      ...actor(0, 'Ada'),
      lastName: null,
    });
  });
});
