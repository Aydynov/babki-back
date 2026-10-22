import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { runIntegrityAudit } from '../src/database/integrity/integrity-audit';
import { MongooseIntegrityReader } from '../src/database/integrity/mongoose-integrity-reader';
import { UserDeletionWorker } from '../src/modules/users/user-deletion.service';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Space Plan lifecycle on disposable replica set', () => {
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
    const categoryId = idOf(
      await api('post', `${base}/expense-categories`)
        .send({ name })
        .expect(201),
    );
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
        await api('post', `${base}/plans`, user)
          .send({
            description: name,
            amount: 10,
            currency: 'USD',
            categoryId,
            targetDate: '2025-01-01T00:00:00Z',
          })
          .expect(201),
      );
    return { base, categoryId, accountId, create };
  }
  beforeAll(async () => {
    ctx = await startSpacesTestApp();
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  }, 30000);
  it.each(['active', 'closed', 'archived'])(
    'keeps category RESTRICT for %s Plan history',
    async (state) => {
      const f = await fixture(`restrict-${state}`);
      const planId = await f.create();
      if (state === 'closed')
        await api('post', `${f.base}/plans/${planId}/close`)
          .send({ accountId: f.accountId, closingDate: '2025-01-02T00:00:00Z' })
          .expect(201);
      if (state === 'archived')
        await api('post', `${f.base}/plans/${planId}/archive`).expect(204);
      await api(
        'delete',
        `${f.base}/expense-categories/${f.categoryId}`,
      ).expect(409);
      await api('get', `${f.base}/plans/${planId}`).expect(200);
    },
  );
  it('keeps closed links valid after expense soft-delete and detects cross-budget category/expense/origin corruption', async () => {
    const f = await fixture('audit');
    const planId = await f.create();
    const closed = await api('post', `${f.base}/plans/${planId}/close`)
      .send({ accountId: f.accountId, closingDate: '2025-01-02T00:00:00Z' })
      .expect(201);
    const expenseId = (
      closed.body as {
        expenseId: string;
      }
    ).expenseId;
    await api('delete', `${f.base}/expenses/${expenseId}`).expect(204);
    const reader = new MongooseIntegrityReader(ctx.connection);
    expect((await runIntegrityAudit(reader)).byRelation).toMatchObject({
      'plan.category.budget': 0,
      'plan.expense.budget': 0,
      'plan.expense.origin': 0,
    });
    const transactions = ctx.connection.collection('transactions');
    const expense = await transactions.findOne({ _id: oid(expenseId) });
    await transactions.updateOne(
      { _id: oid(expenseId) },
      {
        $set: {
          spaceId: new Types.ObjectId(),
          'origin.id': new Types.ObjectId(),
        },
      },
    );
    expect((await runIntegrityAudit(reader)).byRelation).toMatchObject({
      'plan.expense.budget': 1,
      'plan.expense.origin': 1,
    });
    await transactions.replaceOne({ _id: oid(expenseId) }, expense!);
    const plans = ctx.connection.collection('plans');
    await plans.updateOne(
      { _id: oid(planId) },
      { $set: { categoryId: new Types.ObjectId() } },
    );
    expect(
      (await runIntegrityAudit(reader)).byRelation['plan.category.budget'],
    ).toBe(1);
    await plans.updateOne(
      { _id: oid(planId) },
      { $set: { categoryId: oid(f.categoryId) } },
    );
  });
  it('audits a legitimate expense category edit and reports a closed Plan with no expenseId', async () => {
    const f = await fixture('audit-category-edit');
    const planId = await f.create();
    const closed = await api('post', `${f.base}/plans/${planId}/close`)
      .send({ accountId: f.accountId, closingDate: '2025-01-02T00:00:00Z' })
      .expect(201);
    const expenseId = (
      closed.body as {
        expenseId: string;
      }
    ).expenseId;
    const categoryId = idOf(
      await api('post', `${f.base}/expense-categories`)
        .send({ name: 'Actual category' })
        .expect(201),
    );
    await api('patch', `${f.base}/expenses/${expenseId}`)
      .send({ categoryId })
      .expect(200);
    const reader = new MongooseIntegrityReader(ctx.connection);
    expect((await runIntegrityAudit(reader)).byRelation).toMatchObject({
      'plan.expense.origin': 0,
      'expense.plan.origin': 0,
    });
    const plans = ctx.connection.collection('plans');
    const categories = ctx.connection.collection('expensecategories');
    const actualCategory = await categories.findOne({ _id: oid(categoryId) });
    await categories.updateOne(
      { _id: oid(categoryId) },
      { $set: { spaceId: new Types.ObjectId() } },
    );
    expect(
      (await runIntegrityAudit(reader)).byRelation[
        'expense.plan.category.budget'
      ],
    ).toBe(1);
    await categories.replaceOne({ _id: oid(categoryId) }, actualCategory!);
    await plans.updateOne({ _id: oid(planId) }, { $unset: { expenseId: '' } });
    expect(
      (await runIntegrityAudit(reader)).byRelation['plan.expense.origin'],
    ).toBe(1);
    await plans.updateOne(
      { _id: oid(planId) },
      { $set: { expenseId: oid(expenseId) } },
    );
  });
  it('runs the real worker: preserves creator plans in two spaces, anonymizes actors and preserves deleted-space data', async () => {
    const first = await fixture('worker-first');
    const second = await fixture('worker-second');
    const firstId = await first.create(1),
      secondId = await second.create(1);
    const worker = ctx.app.get(UserDeletionWorker);
    await api('post', '/auth/account-deletion', 1)
      .send({ password: 'test-only-correct-horse-battery' })
      .expect(202);
    const pending = await api('get', `${first.base}/plans/${firstId}`).expect(
      200,
    );
    expect(
      (
        pending.body as {
          createdByActor: {
            isAnonymized: boolean;
          };
        }
      ).createdByActor.isAnonymized,
    ).toBe(true);
    for (let i = 0; i < 3; i++)
      expect(await worker.runOnce('plan-lifecycle')).toBe(true);
    for (const [base, id] of [
      [first.base, firstId],
      [second.base, secondId],
    ]) {
      const response = await api('get', `${base}/plans/${id}`).expect(200);
      expect(response.body).toMatchObject({
        createdBy: ctx.users[1].id,
        createdByActor: { isAnonymized: true, firstName: null, lastName: null },
      });
      expect(
        await ctx.connection.collection('plans').findOne({ _id: oid(id) }),
      ).toMatchObject({ createdBy: oid(ctx.users[1].id) });
    }
    await api('delete', first.base).expect(204);
    await api('get', `${first.base}/plans/${firstId}`).expect(404);
    expect(
      await ctx.connection.collection('plans').findOne({ _id: oid(firstId) }),
    ).not.toBeNull();
  });
});
