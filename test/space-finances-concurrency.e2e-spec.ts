import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { SpacesAccessService } from '../src/modules/spaces/spaces-access.service';
import { startSpacesTestApp } from './helpers/spaces-test-app';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// Timeouts only fail a missing rendezvous; the ordering itself uses explicit barriers.
async function rendezvous(promise: Promise<void>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Transaction barrier was not reached')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
describe('Space finance concurrent transactions (real replica set)', () => {
  let harness: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let spaceId: string;
  let accountId: string;
  let categoryId: string;
  const oid = (id: string) => new Types.ObjectId(id);
  const collection = (name: string) => harness.connection.collection(name);
  function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
    body: object = {},
  ) {
    return request(harness.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(harness.users[user].token, { type: 'bearer' })
      .send(body);
  }
  const idOf = (response: Response) => {
    const body = response.body as {
      id?: string;
      _id?: string;
    };
    return (body.id ?? body._id)!;
  };
  const base = () => `/spaces/${spaceId}`;
  const expense = (user = 1, participant = 1) =>
    api('post', `${base()}/expenses`, user, {
      accountId,
      categoryId,
      amount: 10,
      transactionDate: '2026-02-15T12:00:00.000Z',
      participantId: harness.users[participant].id,
    });
  const remove = (user: number) =>
    api('delete', `${base()}/members/${harness.users[user].id}`);
  const delegate = (enabled: boolean) =>
    api('patch', `${base()}/members/${harness.users[1].id}/permissions`, 0, {
      manageCategories: enabled,
    });
  const createCategory = () =>
    api('post', `${base()}/expense-categories`, 1, { name: 'Delegated' });
  const transfer = () =>
    api('post', `${base()}/ownership`, 0, { userId: harness.users[1].id });
  const budget = () => ({ spaceId: oid(spaceId) });
  async function checkBalance(amount: number) {
    const response = await api('get', `${base()}/accounts/${accountId}`).expect(
      200,
    );
    expect(
      (
        response.body as {
          amount: number;
        }
      ).amount,
    ).toBe(amount);
    const snapshot = await collection('accountsnapshots').findOne({
      accountId: oid(accountId),
      date: new Date('2026-02-28T23:59:59.999Z'),
    });
    expect(snapshot?.amount).toBe(amount);
  }
  beforeAll(async () => {
    harness = await startSpacesTestApp();
  }, 60000);
  afterAll(async () => {
    await harness?.close();
  }, 30000);
  afterEach(() => jest.restoreAllMocks());
  beforeEach(async () => {
    await collection('spaceinvitationratelimits').deleteMany({});
    spaceId = idOf(
      await api('post', '/spaces', 0, { name: 'Races' }).expect(201),
    );
    for (const user of [1, 2]) {
      const invitation = await api('post', `${base()}/invitations`).expect(201);
      await api('post', '/space-invitations/accept', user, {
        token: (
          invitation.body as {
            token: string;
          }
        ).token,
      }).expect(200);
    }
    accountId = idOf(
      await api('post', `${base()}/accounts`, 0, {
        name: 'Family',
        currency: 'USD',
        amount: 0,
        openedAt: '2026-01-01T00:00:00.000Z',
      }).expect(201),
    );
    categoryId = idOf(
      await api('post', `${base()}/expense-categories`, 0, {
        name: 'Food',
      }).expect(201),
    );
  });
  /** Hold the first transaction after its real space write. Start the second
   * operation while the lock is held; driver retry and every write stay real. */
  async function race(
    first: () => PromiseLike<Response>,
    second: () => PromiseLike<Response>,
  ) {
    const access = harness.app.get<SpacesAccessService>(SpacesAccessService);
    const serialize = access.serializeMutation.bind(
      access,
    ) as SpacesAccessService['serializeMutation'];
    const locked = deferred();
    const contender = deferred();
    const release = deferred();
    let calls = 0;
    const spy = jest
      .spyOn(access, 'serializeMutation')
      .mockImplementation(async (...args: Parameters<typeof serialize>) => {
        const firstCall = ++calls === 1;
        if (!firstCall) contender.resolve();
        const result = await serialize(...args);
        if (firstCall) {
          locked.resolve();
          await release.promise;
        }
        return result;
      });
    const firstResponse = Promise.resolve(first());
    let secondResponse: Promise<Response> | undefined;
    try {
      await rendezvous(locked.promise);
      secondResponse = Promise.resolve(second());
      await rendezvous(contender.promise);
      release.resolve();
      return await Promise.all([firstResponse, secondResponse]);
    } finally {
      release.resolve();
      await Promise.allSettled([
        firstResponse,
        ...(secondResponse ? [secondResponse] : []),
      ]);
      spy.mockRestore();
    }
  }
  it.each(['revoke', 'leave', 'exclude', 'ownership'] as const)(
    'serializes %s against delegated correction of another author expense',
    async (action) => {
      for (const first of [true, false]) {
        // Use a fresh third-party expense for each ordering. Restore membership
        // and ownership after each round so both orders exercise the same actor.
        const id = idOf(await expense(2, 2).expect(201));
        await api(
          'patch',
          `${base()}/members/${harness.users[1].id}/permissions`,
          0,
          { manageTransactions: true },
        ).expect(200);
        const change = () =>
          api('patch', `${base()}/expenses/${id}`, 1, { amount: 20 });
        const transition = () =>
          action === 'revoke'
            ? api(
                'patch',
                `${base()}/members/${harness.users[1].id}/permissions`,
                0,
                { manageTransactions: false },
              )
            : action === 'leave'
              ? api('post', `${base()}/leave`, 1)
              : action === 'exclude'
                ? remove(1)
                : // Transfer to the delegate, making the former owner lose rights;
                  // the new owner retains authority regardless of the old delegation.
                  transfer();
        const responses = await race(
          first ? transition : change,
          first ? change : transition,
        );
        const status = action === 'leave' || action === 'exclude' ? 204 : 200;
        const denied =
          action === 'revoke' ? 403 : action === 'ownership' ? 200 : 404;
        expect(responses.map((r) => r.status)).toEqual(
          first ? [status, denied] : [200, status],
        );
        const row = await collection('transactions').findOne({ _id: oid(id) });
        expect(row?.amount).toBe(first && action !== 'ownership' ? 10 : 20);
        if (action === 'leave' || action === 'exclude') {
          const invitation = await api('post', `${base()}/invitations`).expect(
            201,
          );
          await api('post', '/space-invitations/accept', 1, {
            token: (
              invitation.body as {
                token: string;
              }
            ).token,
          }).expect(200);
        } else if (action === 'ownership') {
          await api('post', `${base()}/ownership`, 1, {
            userId: harness.users[0].id,
          }).expect(200);
        }
      }
      await checkBalance(action === 'ownership' ? -40 : -30);
    },
  );
  it.each([true, false])(
    'serializes revocation against category creation (revoke first: %s)',
    async (first) => {
      await delegate(true).expect(200);
      const responses = await race(
        first ? () => delegate(false) : createCategory,
        first ? createCategory : () => delegate(false),
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [200, 403] : [201, 200],
      );
      expect(
        await collection('expensecategories').countDocuments({
          ...budget(),
          name: 'Delegated',
        }),
      ).toBe(first ? 0 : 1);
      await createCategory().expect(403);
    },
  );
  it.each([true, false])(
    'serializes actor exclusion against expense creation (exclude first: %s)',
    async (first) => {
      const responses = await race(
        first ? () => remove(1) : () => expense(),
        first ? () => expense() : () => remove(1),
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [204, 404] : [201, 204],
      );
      expect(await collection('transactions').countDocuments(budget())).toBe(
        first ? 0 : 1,
      );
      if (!first) await checkBalance(-10);
    },
  );
  it.each([true, false])(
    'serializes participant exclusion against expense assignment (exclude first: %s)',
    async (first) => {
      const responses = await race(
        first ? () => remove(2) : () => expense(1, 2),
        first ? () => expense(1, 2) : () => remove(2),
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [204, 404] : [201, 204],
      );
      expect(await collection('transactions').countDocuments(budget())).toBe(
        first ? 0 : 1,
      );
      if (!first) await checkBalance(-10);
    },
  );
  it.each([true, false])(
    'rechecks former owner rights against another author expense (transfer first: %s)',
    async (first) => {
      const id = idOf(await expense(2, 2).expect(201));
      const change = () =>
        api('patch', `${base()}/expenses/${id}`, 0, { amount: 20 });
      const responses = await race(
        first ? transfer : change,
        first ? change : transfer,
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [200, 403] : [200, 200],
      );
      await checkBalance(first ? -10 : -20);
    },
  );
  it.each([true, false])(
    'serializes space deletion against expense creation (delete first: %s)',
    async (first) => {
      const deletion = () => api('delete', base());
      const responses = await race(
        first ? deletion : () => expense(),
        first ? () => expense() : deletion,
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [204, 404] : [201, 204],
      );
      expect(await collection('transactions').countDocuments(budget())).toBe(
        first ? 0 : 1,
      );
      await api('get', `${base()}/expenses`).expect(404);
    },
  );
  it.each([true, false])(
    'serializes update against delete without double compensation (update first: %s)',
    async (first) => {
      const id = idOf(await expense().expect(201));
      const update = () =>
        api('patch', `${base()}/expenses/${id}`, 1, { amount: 25 });
      const deletion = () => api('delete', `${base()}/expenses/${id}`, 1);
      const responses = await race(
        first ? update : deletion,
        first ? deletion : update,
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [200, 204] : [204, 404],
      );
      await checkBalance(0);
      await deletion().expect(404);
      await checkBalance(0);
      expect(
        await collection('transactions').countDocuments({
          ...budget(),
          deletedAt: { $ne: null },
        }),
      ).toBe(1);
    },
  );
  it('serializes concurrent expense updates using the committed previous amount', async () => {
    const id = idOf(await expense().expect(201));
    const responses = await race(
      () => api('patch', `${base()}/expenses/${id}`, 1, { amount: 25 }),
      () => api('patch', `${base()}/expenses/${id}`, 1, { amount: 40 }),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await checkBalance(-40);
  });
  it('creates independent competing accounts', async () => {
    await api('delete', `${base()}/accounts/${accountId}`).expect(204);
    const create = () =>
      api('post', `${base()}/accounts`, 0, {
        name: 'Family',
        currency: 'USD',
        openedAt: '2026-01-01T00:00:00.000Z',
      });
    expect((await race(create, create)).map((r) => r.status)).toEqual([
      201, 201,
    ]);
    expect(await collection('accounts').countDocuments(budget())).toBe(2);
  });
  it.each([true, false])(
    'serializes category deletion against expense creation (delete first: %s)',
    async (first) => {
      const deletion = () =>
        api('delete', `${base()}/expense-categories/${categoryId}`);
      const responses = await race(
        first ? deletion : () => expense(),
        first ? () => expense() : deletion,
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [204, 404] : [201, 409],
      );
      expect(await collection('transactions').countDocuments(budget())).toBe(
        first ? 0 : 1,
      );
    },
  );
  it.each([true, false])(
    'serializes category archival against expense creation (archive first: %s)',
    async (first) => {
      const archive = () =>
        api('patch', `${base()}/expense-categories/${categoryId}`, 0, {
          isArchived: true,
        });
      const responses = await race(
        first ? archive : () => expense(),
        first ? () => expense() : archive,
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [200, 409] : [201, 200],
      );
      expect(await collection('transactions').countDocuments(budget())).toBe(
        first ? 0 : 1,
      );
    },
  );
  it('rejects a concurrent overlapping limit after the first commit', async () => {
    const limit = (startDate: string, endDate: string) =>
      api('post', `${base()}/expense-limits`, 0, {
        currency: 'USD',
        categoryId,
        total: 100,
        startDate,
        endDate,
      });
    const responses = await race(
      () => limit('2026-02-01', '2026-02-15'),
      () => limit('2026-02-15', '2026-03-01'),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 409]);
    expect(await collection('expenselimits').countDocuments(budget())).toBe(1);
  });
  it.each([true, false])(
    'serializes wallet deletion against expense creation (delete first: %s)',
    async (first) => {
      const deletion = () => api('delete', `${base()}/accounts/${accountId}`);
      const responses = await race(
        first ? deletion : () => expense(),
        first ? () => expense() : deletion,
      );
      expect(responses.map((r) => r.status)).toEqual(
        first ? [204, 404] : [201, 409],
      );
      expect(await collection('transactions').countDocuments(budget())).toBe(
        first ? 0 : 1,
      );
      expect(await collection('accounts').countDocuments(budget())).toBe(
        first ? 0 : 1,
      );
    },
  );
  it('rolls back transaction, snapshots and space version when final snapshot write fails', async () => {
    const model = harness.app.get<Model<object>>(
      getModelToken('AccountSnapshot'),
    );
    const original = model.updateOne.bind(model) as typeof model.updateOne;
    let calls = 0;
    const before = await collection('spaces').findOne({ _id: oid(spaceId) });
    const snapshots = await collection('accountsnapshots')
      .find({ accountId: oid(accountId) })
      .toArray();
    const fault = jest
      .spyOn(model, 'updateOne')
      .mockImplementation((...args: Parameters<typeof model.updateOne>) => {
        if (++calls === 2)
          throw new Error('Injected final snapshot write failure');
        return original(...args);
      });
    await expense().expect(503);
    fault.mockRestore();
    expect(calls).toBe(2);
    expect(await collection('transactions').countDocuments(budget())).toBe(0);
    expect(
      await collection('accountsnapshots')
        .find({ accountId: oid(accountId) })
        .toArray(),
    ).toEqual(snapshots);
    expect(
      (await collection('spaces').findOne({ _id: oid(spaceId) }))
        ?.mutationVersion,
    ).toBe(before?.mutationVersion);
    await expense().expect(201);
    await checkBalance(-10);
  });
});
