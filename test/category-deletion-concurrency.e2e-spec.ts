import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal category lifecycle (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let sequence = 0;
  let accountId: string;
  const oid = (value: string) => new Types.ObjectId(value);
  const collection = (name: string) => harness.connection.collection(name);
  const api = () => {
    const server = harness.app.getHttpServer() as Parameters<typeof request>[0];
    const token = harness.users[0].token;
    const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      request(server)[method](`/api/v1${path}`).auth(token, { type: 'bearer' });
    return {
      get: (path: string) => call('get', path),
      post: (path: string, body: object) => call('post', path).send(body),
      patch: (path: string, body: object) => call('patch', path).send(body),
      delete: (path: string) => call('delete', path),
    };
  };
  const idOf = (response: Response) => (response.body as { _id: string })._id;
  const date = '2026-09-21T00:00:00.000Z';

  async function category() {
    sequence += 1;
    return idOf(
      await api()
        .post('/expense-categories', { name: `Category-${sequence}` })
        .expect(201),
    );
  }

  async function balance() {
    sequence += 1;
    return idOf(
      await api()
        .post('/accounts', {
          name: `Balance-${sequence}`,
          type: 'balance',
          currency: 'USD',
          amount: 100,
        })
        .expect(201),
    );
  }

  function createDependency(
    kind: 'expense' | 'limit' | 'plan',
    categoryId: string,
  ) {
    if (kind === 'expense') {
      return api().post('/expenses', {
        accountId,
        categoryId,
        amount: 10,
        transactionDate: date,
      });
    }
    if (kind === 'limit') {
      return api().post('/expense-limits', {
        categoryId,
        currency: 'USD',
        total: 50,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });
    }
    return api().post('/plans', {
      categoryId,
      currency: 'USD',
      description: 'Plan dependency',
      amount: 50,
      targetDate: '2026-12-01',
    });
  }

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);

  beforeEach(async () => {
    const user = oid(harness.users[0].id);
    for (const name of [
      'transactions',
      'accountsnapshots',
      'accounts',
      'expenselimits',
      'plans',
      'expensecategories',
    ]) {
      await collection(name).deleteMany(
        name === 'plans'
          ? { userId: user }
          : { $or: [{ ownerId: user }, { userId: user }] },
      );
    }
    accountId = await balance();
  });

  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it.each(['expense', 'limit', 'plan'] as const)(
    'restricts category deletion when referenced by a %s',
    async (kind) => {
      const categoryId = await category();
      const dependency = await createDependency(kind, categoryId).expect(201);
      if (kind === 'expense') {
        await api()
          .delete(`/transactions/${idOf(dependency)}`)
          .expect(204);
      }
      if (kind === 'plan') {
        expect(dependency.body).toMatchObject({ categoryId });
      }

      await api().delete(`/expense-categories/${categoryId}`).expect(409);
      expect(
        await collection('expensecategories').countDocuments({
          _id: oid(categoryId),
        }),
      ).toBe(1);
    },
  );

  it('deletes only a leaf limit and preserves its category and financial history', async () => {
    const categoryId = await category();
    const expense = await createDependency('expense', categoryId).expect(201);
    const limit = await createDependency('limit', categoryId).expect(201);

    await api()
      .delete(`/expense-limits/${idOf(limit)}`)
      .expect(204);

    expect(
      await collection('expensecategories').countDocuments({
        _id: oid(categoryId),
      }),
    ).toBe(1);
    expect(
      await collection('transactions').countDocuments({
        _id: oid(idOf(expense)),
      }),
    ).toBe(1);
  });

  it('archives a used category, hides it and allows edits without reassignment', async () => {
    const categoryId = await category();
    const expense = await createDependency('expense', categoryId).expect(201);

    await api()
      .patch(`/expense-categories/${categoryId}`, { isArchived: true })
      .expect(200);

    expect((await api().get('/expense-categories').expect(200)).body).toEqual(
      [],
    );
    await createDependency('expense', categoryId).expect(409);
    await createDependency('limit', categoryId).expect(409);
    await createDependency('plan', categoryId).expect(409);
    await api()
      .patch(`/expenses/${idOf(expense)}`, { amount: 20 })
      .expect(200);
  });

  it.each(['expense', 'limit', 'plan'] as const)(
    'serializes category deletion against %s creation',
    async (kind) => {
      const categoryId = await category();
      const [deletion, creation] = await Promise.all([
        api().delete(`/expense-categories/${categoryId}`),
        createDependency(kind, categoryId),
      ]);

      expect([
        [204, 404],
        [409, 201],
      ]).toContainEqual([deletion.status, creation.status]);
    },
  );

  it.each(['expense', 'limit', 'plan'] as const)(
    'serializes category archival against %s creation',
    async (kind) => {
      const categoryId = await category();
      const [archival, creation] = await Promise.all([
        api().patch(`/expense-categories/${categoryId}`, { isArchived: true }),
        createDependency(kind, categoryId),
      ]);

      expect(archival.status).toBe(200);
      expect([201, 409]).toContain(creation.status);
      expect(
        (
          await collection('expensecategories').findOne({
            _id: oid(categoryId),
          })
        )?.isArchived,
      ).toBe(true);
    },
  );
});
