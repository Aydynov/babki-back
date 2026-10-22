import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { runIntegrityAudit } from '../src/database/integrity/integrity-audit';
import { MongooseIntegrityReader } from '../src/database/integrity/mongoose-integrity-reader';
import { DebtsService } from '../src/modules/debts/debts.service';
import { UserDeletionWorker } from '../src/modules/users/user-deletion.service';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Space Debt lifecycle on disposable replica set', () => {
  let ctx: Awaited<ReturnType<typeof startSpacesTestApp>>;
  const idOf = (r: Response) =>
    (
      r.body as {
        _id?: string;
        id?: string;
      }
    )._id ??
    (
      r.body as {
        id: string;
      }
    ).id;
  const oid = (id: string) => new Types.ObjectId(id);
  function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) {
    return request(ctx.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(ctx.users[user].token, { type: 'bearer' });
  }
  async function fixture(name: string) {
    const base = `/spaces/${idOf(await api('post', '/spaces').send({ name }).expect(201))}`;
    const invitation = await api('post', `${base}/invitations`).expect(201);
    await api('post', '/space-invitations/accept', 1)
      .send({
        token: (
          invitation.body as {
            token: string;
          }
        ).token,
      })
      .expect(200);
    const accountId = idOf(
      await api('post', `${base}/accounts`)
        .send({
          name,
          type: 'balance',
          currency: 'USD',
          amount: 100,
          openedAt: '2024-01-01T00:00:00Z',
        })
        .expect(201),
    );
    const create = async (user = 0) =>
      idOf(
        await api('post', `${base}/debts`, user)
          .send({ debtor: name, principalAmount: 100, currency: 'USD' })
          .expect(201),
      );
    const repay = async (debt: string, isIncome = true, user = 0) => {
      const result = await api('post', `${base}/debts/${debt}/repayments`, user)
        .send({
          amount: 10,
          repaymentDate: '2025-01-01T00:00:00Z',
          isIncome,
          ...(isIncome ? { accountId } : {}),
        })
        .expect(201);
      return (
        result.body as {
          repayment: {
            _id: string;
            incomeId?: string;
          };
        }
      ).repayment;
    };
    return { base, accountId, create, repay };
  }
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  }, 30000);
  it('allows delete only without history and preserves archived/cancelled financial history', async () => {
    const f = await fixture('delete-restrict');
    const empty = await f.create();
    await api('delete', `${f.base}/debts/${empty}`).expect(204);
    await api('delete', `${f.base}/debts/${empty}`).expect(404);
    const debt = await f.create();
    const repayment = await f.repay(debt);
    await api('delete', `${f.base}/debts/${debt}`).expect(409);
    await api(
      'post',
      `${f.base}/debts/${debt}/repayments/${repayment._id}/cancel`,
    )
      .send({})
      .expect(200);
    await api('delete', `${f.base}/debts/${debt}`).expect(409);
    await api('post', `${f.base}/debts/${debt}/archive`).expect(204);
    await api('post', `${f.base}/debts/${debt}/archive`).expect(404);
    await api('delete', `${f.base}/debts/${debt}`).expect(409);
    await api(
      'get',
      `${f.base}/debts/${debt}/repayments/${repayment._id}`,
    ).expect(200);
    const audit = await runIntegrityAudit(
      new MongooseIntegrityReader(ctx.connection),
    );
    expect(audit.byRelation).toMatchObject({
      'debt.space.balance': 0,
      'debtTransaction.income': 0,
      'income.debt.repayment': 0,
    });
  });
  it('detects exact link, reverse-history, balance and cancellation corruption', async () => {
    const f = await fixture('audit');
    const debt = await f.create();
    const repayment = await f.repay(debt);
    const histories = ctx.connection.collection('debttransactions');
    const transactions = ctx.connection.collection('transactions');
    const audit = async () =>
      (await runIntegrityAudit(new MongooseIntegrityReader(ctx.connection)))
        .byRelation;
    const income = await transactions.findOne({
      _id: oid(repayment.incomeId!),
    });
    await transactions.updateOne(
      { _id: income!._id },
      { $set: { amount: 11 } },
    );
    expect(await audit()).toMatchObject({
      'debtTransaction.income': 1,
      'income.debt.repayment': 1,
    });
    await transactions.replaceOne({ _id: income!._id }, income!);
    for (const mutation of [
      { spaceId: new Types.ObjectId() },
      { currency: 'EUR' },
      { transactionDate: new Date('2025-01-02') },
      { 'origin.id': new Types.ObjectId() },
      { deletedAt: new Date('2025-01-02') },
    ]) {
      await transactions.updateOne({ _id: income!._id }, { $set: mutation });
      expect(await audit()).toMatchObject({
        'debtTransaction.income': 1,
        'income.debt.repayment': 1,
      });
      await transactions.replaceOne({ _id: income!._id }, income!);
    }
    const history = await histories.findOne({ _id: oid(repayment._id) });
    await histories.updateOne(
      { _id: history!._id },
      { $unset: { incomeId: '' } },
    );
    expect(await audit()).toMatchObject({
      'debtTransaction.income': 1,
      'income.debt.repayment': 1,
    });
    await histories.replaceOne({ _id: history!._id }, history!);
    const noncash = await f.repay(debt, false);
    await histories.updateOne(
      { _id: oid(noncash._id) },
      { $set: { incomeId: null } },
    );
    expect(await audit()).toMatchObject({ 'debtTransaction.income': 1 });
    await histories.updateOne(
      { _id: oid(noncash._id) },
      { $unset: { incomeId: '' } },
    );
    await histories.updateOne(
      { _id: oid(repayment._id) },
      { $set: { cancelledAt: new Date() } },
    );
    expect(await audit()).toMatchObject({
      'debtTransaction.cancelledBy': 1,
      'debt.space.balance': 1,
      'debtTransaction.income': 1,
    });
    await histories.updateOne(
      { _id: oid(repayment._id) },
      { $set: { cancelledAt: null } },
    );
    expect(await audit()).toMatchObject({
      'debt.space.balance': 0,
      'debtTransaction.income': 0,
      'income.debt.repayment': 0,
    });
  });
  it('repeats additive index startup without dropping indexes and keeps income uniqueness partial', async () => {
    const debts = ctx.connection.collection('debts');
    const histories = ctx.connection.collection('debttransactions');
    const beforeDebts = await debts.indexes();
    const beforeHistory = await histories.indexes();
    const noncashIds = [new Types.ObjectId(), new Types.ObjectId()];
    await histories.insertMany(
      noncashIds.map((_id) => ({
        _id,
        spaceId: new Types.ObjectId(),
        createdBy: oid(ctx.users[0].id),
        isIncome: false,
      })),
    );
    try {
      await ctx.app.get(DebtsService).onModuleInit();
      await ctx.app.get(DebtsService).onModuleInit();
      expect(await debts.indexes()).toEqual(beforeDebts);
      expect(await histories.indexes()).toEqual(beforeHistory);
      const incomeId = new Types.ObjectId();
      const first = new Types.ObjectId(),
        second = new Types.ObjectId();
      await histories.insertOne({ _id: first, incomeId });
      try {
        await expect(
          histories.insertOne({ _id: second, incomeId }),
        ).rejects.toMatchObject({ code: 11000 });
      } finally {
        await histories.deleteMany({ _id: { $in: [first, second] } });
      }
    } finally {
      await histories.deleteMany({ _id: { $in: noncashIds } });
    }
  });
  it('real worker preserves two space budgets and anonymized pending/tombstone actors', async () => {
    const first = await fixture('worker-first'),
      second = await fixture('worker-second');
    const firstId = await first.create(1),
      secondId = await second.create(1);
    const firstRepay = await first.repay(firstId, true, 1),
      secondRepay = await second.repay(secondId, false, 1);
    const worker = ctx.app.get(UserDeletionWorker);
    await api('post', '/auth/account-deletion', 1)
      .send({ password: 'test-only-correct-horse-battery' })
      .expect(202);
    expect(
      (await api('get', `${first.base}/debts/${firstId}`).expect(200)).body,
    ).toMatchObject({ createdByActor: { isAnonymized: true } });
    for (let i = 0; i < 3; i++)
      expect(await worker.runOnce('debt-lifecycle')).toBe(true);
    for (const [f, id, repayment] of [
      [first, firstId, firstRepay],
      [second, secondId, secondRepay],
    ] as const) {
      expect(
        (await api('get', `${f.base}/debts/${id}`).expect(200)).body,
      ).toMatchObject({
        createdBy: ctx.users[1].id,
        createdByActor: { isAnonymized: true, firstName: null, lastName: null },
      });
      expect(
        (
          await api(
            'get',
            `${f.base}/debts/${id}/repayments/${repayment._id}`,
          ).expect(200)
        ).body,
      ).toMatchObject({ createdByActor: { isAnonymized: true } });
    }
    expect(
      await ctx.connection
        .collection('transactions')
        .findOne({ _id: oid(firstRepay.incomeId!) }),
    ).not.toBeNull();
    await api('delete', first.base).expect(204);
    await api('get', `${first.base}/debts/${firstId}`).expect(404);
    expect(
      await ctx.connection.collection('debts').findOne({ _id: oid(firstId) }),
    ).not.toBeNull();
  });
});
