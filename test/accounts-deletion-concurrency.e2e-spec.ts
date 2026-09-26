import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal account deletion (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const oid = (value: string) => new Types.ObjectId(value);
  const collection = (name: string) => harness.connection.collection(name);
  const api = () => {
    const server = harness.app.getHttpServer() as Parameters<typeof request>[0];
    const token = harness.users[0].token;
    return {
      get: (path: string) =>
        request(server).get(`/api/v1${path}`).auth(token, { type: 'bearer' }),
      post: (path: string, body: object = {}) =>
        request(server)
          .post(`/api/v1${path}`)
          .auth(token, { type: 'bearer' })
          .send(body),
      delete: (path: string) =>
        request(server)
          .delete(`/api/v1${path}`)
          .auth(token, { type: 'bearer' }),
    };
  };
  const idOf = (response: Response) => {
    const body = response.body as { _id: string } | Array<{ _id: string }>;
    return Array.isArray(body) ? body[0]._id : body._id;
  };
  const date = '2026-09-21T00:00:00.000Z';

  async function balance(amount = 0) {
    return idOf(
      await api()
        .post('/accounts', {
          name: `Balance-${Date.now()}-${Math.random()}`,
          type: 'balance',
          currency: 'USD',
          amount,
        })
        .expect(201),
    );
  }

  async function saving(amount = 0) {
    return idOf(
      await api()
        .post('/accounts', {
          name: `Saving-${Date.now()}-${Math.random()}`,
          type: 'saving',
          currency: 'USD',
          amount,
        })
        .expect(201),
    );
  }

  async function category() {
    return idOf(
      await api()
        .post('/expense-categories', { name: `Food-${Date.now()}` })
        .expect(201),
    );
  }

  async function latestAmount(accountId: string) {
    const snapshot = await collection('accountsnapshots').findOne(
      { accountId: oid(accountId) },
      { sort: { date: -1, createdAt: -1 } },
    );
    return snapshot?.amount as number | undefined;
  }

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);

  beforeEach(async () => {
    const user = oid(harness.users[0].id);
    await Promise.all([
      collection('transactions').deleteMany({
        ownerType: 'user',
        ownerId: user,
      }),
      collection('accountsnapshots').deleteMany({}),
      collection('accounts').deleteMany({ ownerType: 'user', ownerId: user }),
      collection('expensecategories').deleteMany({
        ownerType: 'user',
        ownerId: user,
      }),
    ]);
  });

  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('preserves both accounts, snapshots and transfer when either transfer account is deleted', async () => {
    const balanceId = await balance();
    const savingId = await saving();
    await collection('accountsnapshots').updateMany(
      { accountId: oid(balanceId) },
      { $set: { amount: 100 } },
    );
    await api()
      .post('/transfers', {
        sourceAmount: 25,
        destinationAmount: 25,
        sourceAccountId: balanceId,
        destinationAccountId: savingId,
        transactionDate: date,
      })
      .expect(201);
    const snapshotsBefore = await collection('accountsnapshots')
      .find({ accountId: { $in: [oid(balanceId), oid(savingId)] } })
      .sort({ _id: 1 })
      .toArray();

    await api().delete(`/accounts/${balanceId}`).expect(409);
    await api().delete(`/accounts/${savingId}`).expect(409);

    expect(
      await collection('accounts').countDocuments({
        _id: { $in: [oid(balanceId), oid(savingId)] },
      }),
    ).toBe(2);
    expect(
      await collection('transactions').countDocuments({
        type: 'transfer',
        'source.accountId': oid(balanceId),
        'destination.accountId': oid(savingId),
      }),
    ).toBe(1);
    expect(
      await collection('accountsnapshots')
        .find({ accountId: { $in: [oid(balanceId), oid(savingId)] } })
        .sort({ _id: 1 })
        .toArray(),
    ).toEqual(snapshotsBefore);
  });

  it('keeps archived account history readable and rejects a new operation', async () => {
    const accountId = await balance();
    await api()
      .post('/incomes', { accountId, amount: 10, transactionDate: date })
      .expect(201);

    await api().post(`/accounts/${accountId}/archive`).expect(204);

    await api()
      .post('/incomes', { accountId, amount: 5, transactionDate: date })
      .expect(404);
    const history = await api().get('/transactions').expect(200);
    expect((history.body as { total: number }).total).toBe(1);
    expect(
      (await collection('accounts').findOne({ _id: oid(accountId) }))
        ?.archivedAt,
    ).toBeInstanceOf(Date);
  });

  it.each(['income', 'expense', 'transfer'] as const)(
    'serializes account deletion against %s creation',
    async (kind) => {
      const sourceAccountId =
        kind === 'transfer' ? await balance(100) : undefined;
      const accountId = kind === 'transfer' ? await saving() : await balance();
      const categoryId = kind === 'expense' ? await category() : undefined;
      const create = () => {
        if (kind === 'income') {
          return api().post('/incomes', {
            accountId,
            amount: 10,
            transactionDate: date,
          });
        }
        if (kind === 'expense') {
          return api().post('/expenses', {
            categoryId,
            accountId,
            amount: 10,
            transactionDate: date,
          });
        }
        return api().post('/transfers', {
          sourceAccountId,
          destinationAccountId: accountId,
          sourceAmount: 10,
          destinationAmount: 10,
          transactionDate: date,
        });
      };

      const [deletion, creation] = await Promise.all([
        api().delete(`/accounts/${accountId}`),
        create(),
      ]);

      expect([
        [204, 404],
        [409, 201],
      ]).toContainEqual([deletion.status, creation.status]);
      const accountExists = await collection('accounts').countDocuments({
        _id: oid(accountId),
      });
      const transactionExists = await collection('transactions').countDocuments(
        {
          $or: [
            { accountId: oid(accountId) },
            { 'source.accountId': oid(accountId) },
            { 'destination.accountId': oid(accountId) },
          ],
        },
      );
      expect([accountExists, transactionExists]).toEqual(
        creation.status === 201 ? [1, 1] : [0, 0],
      );
      expect(
        await collection('accountsnapshots').countDocuments({
          accountId: oid(accountId),
        }),
      ).toBe(creation.status === 201 ? 1 : 0);
      if (sourceAccountId) {
        expect(
          await collection('accounts').countDocuments({
            _id: oid(sourceAccountId),
          }),
        ).toBe(1);
      }
    },
  );

  it.each(['income', 'expense', 'transfer'] as const)(
    'soft deletes a personal %s, hides it and preserves immutable dependencies',
    async (kind) => {
      const sourceAccountId =
        kind === 'transfer' ? await balance(100) : undefined;
      const accountId =
        kind === 'transfer'
          ? await saving()
          : await balance(kind === 'expense' ? 100 : 0);
      const categoryId = kind === 'expense' ? await category() : undefined;
      const created =
        kind === 'income'
          ? await api()
              .post('/incomes', {
                accountId,
                amount: 10,
                transactionDate: date,
              })
              .expect(201)
          : kind === 'expense'
            ? await api()
                .post('/expenses', {
                  categoryId,
                  accountId,
                  amount: 10,
                  transactionDate: date,
                })
                .expect(201)
            : await api()
                .post('/transfers', {
                  sourceAccountId,
                  destinationAccountId: accountId,
                  sourceAmount: 10,
                  destinationAmount: 10,
                  transactionDate: date,
                })
                .expect(201);
      const transactionId = idOf(created);

      const deletionPath =
        kind === 'transfer'
          ? `/transfers/${transactionId}`
          : `/transactions/${transactionId}`;
      await api().delete(deletionPath).expect(204);
      await api().delete(deletionPath).expect(404);
      await api().get(`/transactions/${transactionId}`).expect(404);

      expect((await api().get('/transactions').expect(200)).body).toMatchObject(
        {
          total: 0,
          items: [],
        },
      );
      const typedPath =
        kind === 'income'
          ? '/incomes'
          : kind === 'expense'
            ? '/expenses'
            : '/transfers';
      expect((await api().get(typedPath).expect(200)).body).toMatchObject({
        total: 0,
        items: [],
      });
      if (kind !== 'transfer') {
        expect(
          (await api().get(`${typedPath}/revenue`).expect(200)).body,
        ).toMatchObject({ totalRevenue: 0 });
      }

      const stored = await collection('transactions').findOne({
        _id: oid(transactionId),
      });
      expect(stored?.deletedAt).toBeInstanceOf(Date);
      expect(stored?.deletedBy).toEqual(oid(harness.users[0].id));
      expect(await latestAmount(accountId)).toBe(kind === 'expense' ? 100 : 0);
      if (sourceAccountId) {
        expect(await latestAmount(sourceAccountId)).toBe(100);
      }

      await api().delete(`/accounts/${accountId}`).expect(409);
      if (categoryId) {
        await api().delete(`/expense-categories/${categoryId}`).expect(409);
      }
    },
  );

  it('compensates a transaction only once under concurrent deletion', async () => {
    const accountId = await balance();
    const created = await api()
      .post('/incomes', { accountId, amount: 25, transactionDate: date })
      .expect(201);
    const transactionId = idOf(created);

    const responses = await Promise.all([
      api().delete(`/transactions/${transactionId}`),
      api().delete(`/transactions/${transactionId}`),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([204, 404]);
    expect(await latestAmount(accountId)).toBe(0);
    expect(
      await collection('transactions').countDocuments({
        _id: oid(transactionId),
        deletedAt: { $type: 'date' },
      }),
    ).toBe(1);
  });
});
