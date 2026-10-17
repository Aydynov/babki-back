import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AccountsSnapshotsService } from '../src/modules/accounts-snapshots/accounts-snapshots.service';
import { GroupsAccessService } from '../src/modules/groups/groups-access.service';
import { TransactionsService } from '../src/modules/transactions/transactions/transactions.service';
import { startGroupsTestApp } from './helpers/groups-test-app';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// This timeout only detects a broken rendezvous; ordering uses real group writes.
async function rendezvous(promise: Promise<void>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_done, reject) => {
        timer = setTimeout(
          () => reject(new Error('Group barrier not reached')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('Group transfer concurrency (real replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let groupId: string;
  let sourceId: string;
  let destinationId: string;
  const oid = (id: string) => new Types.ObjectId(id);
  const collection = (name: string) => harness.connection.collection(name);
  const base = () => `/groups/${groupId}`;
  const budget = () => ({ ownerType: 'group' as const, ownerId: oid(groupId) });
  const idOf = (r: Response) => {
    const b = r.body as { id?: string; _id?: string };
    return (b.id ?? b._id)!;
  };
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
  const create = (user = 1, amount = 10) =>
    api('post', `${base()}/transfers`, user, {
      sourceAccountId: sourceId,
      destinationAccountId: destinationId,
      sourceAmount: amount,
      destinationAmount: amount,
      transactionDate: '2026-02-15T12:00:00Z',
    });
  const patch = (id: string, user = 1, amount = 25) =>
    api('patch', `${base()}/transfers/${id}`, user, {
      sourceAmount: amount,
      destinationAmount: amount,
    });
  const remove = (id: string, user = 1) =>
    api('delete', `${base()}/transfers/${id}`, user);
  const grant = (enabled: boolean) =>
    api('patch', `${base()}/members/${harness.users[1].id}/permissions`, 0, {
      manageTransactions: enabled,
    });
  async function account(name: string, amount = 0) {
    return idOf(
      await api('post', `${base()}/accounts`, 0, {
        name,
        currency: 'USD',
        amount,
        openedAt: '2026-01-01T00:00:00Z',
      }).expect(201),
    );
  }
  async function snapshots() {
    return collection('accountsnapshots')
      .find({ accountId: { $in: [oid(sourceId), oid(destinationId)] } })
      .sort({ accountId: 1, date: 1 })
      .toArray();
  }
  async function money(source: number, destination: number, readable = true) {
    for (const [id, amount, opening] of [
      [sourceId, source, 100],
      [destinationId, destination, 0],
    ] as const) {
      if (readable)
        expect(
          (await api('get', `${base()}/accounts/${id}`).expect(200)).body,
        ).toMatchObject({ amount });
      const rows = await collection('accountsnapshots')
        .find({ accountId: oid(id) })
        .sort({ date: 1 })
        .toArray();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows)
        expect(row.amount).toBe(
          row.date < new Date('2026-02-01') ? opening : amount,
        );
      // Check the authoritative ledger separately from the stored snapshots.
      const stored = await collection('transactions')
        .find({ ...budget(), deletedAt: null })
        .toArray();
      const ledger = stored.reduce((sum, row) => {
        const from = row.source as {
          accountId: Types.ObjectId;
          amount: number;
        };
        const to = row.destination as {
          accountId: Types.ObjectId;
          amount: number;
        };
        return (
          sum -
          (String(from.accountId) === id ? from.amount : 0) +
          (String(to.accountId) === id ? to.amount : 0)
        );
      }, opening);
      expect(ledger).toBe(amount);
    }
  }
  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await harness?.close();
  }, 30000);
  afterEach(() => jest.restoreAllMocks());
  beforeEach(async () => {
    await collection('groupinvitationratelimits').deleteMany({});
    groupId = idOf(
      await api('post', '/groups', 0, {
        name: 'Transfer races',
        type: 'family',
      }).expect(201),
    );
    for (const user of [1, 2]) {
      const invite = await api('post', `${base()}/invitations`).expect(201);
      await api('post', '/group-invitations/accept', user, {
        token: (invite.body as { token: string }).token,
      }).expect(200);
    }
    sourceId = await account('Source', 100);
    destinationId = await account('Destination');
    // Existing later periods must be rebuilt by backdated mutations on both sides.
    for (const [id, amount] of [
      [sourceId, 100],
      [destinationId, 0],
    ] as const) {
      await collection('accountsnapshots').insertOne({
        accountId: oid(id),
        date: new Date('2026-04-30T23:59:59.999Z'),
        amount,
      });
    }
  });
  async function race(
    first: () => PromiseLike<Response>,
    second: () => PromiseLike<Response>,
  ) {
    const access = harness.app.get(GroupsAccessService);
    const serialize = access.serializeMutation.bind(
      access,
    ) as GroupsAccessService['serializeMutation'];
    const locked = signal();
    const contender = signal();
    const release = signal();
    let calls = 0;
    const spy = jest
      .spyOn(access, 'serializeMutation')
      .mockImplementation(async (...args: Parameters<typeof serialize>) => {
        const initial = ++calls === 1;
        if (!initial) contender.resolve();
        const result = await serialize(...args);
        if (initial) {
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
  it.each([true, false])(
    'serializes edit/delete (edit first: %s)',
    async (editFirst) => {
      const id = idOf(await create().expect(201));
      const responses = await race(
        editFirst ? () => patch(id) : () => remove(id),
        editFirst ? () => remove(id) : () => patch(id),
      );
      expect(responses.map((r) => r.status)).toEqual(
        editFirst ? [200, 204] : [204, 404],
      );
      await money(100, 0);
      await remove(id).expect(404);
      await money(100, 0);
      expect(
        await collection('transactions').findOne({ _id: oid(id) }),
      ).toMatchObject({
        deletedAt: expect.any(Date) as unknown,
        deletedBy: oid(harness.users[1].id),
        source: expect.objectContaining({
          amount: editFirst ? 25 : 10,
        }) as unknown,
      });
    },
  );
  it.each([1, 0])(
    'serializes delete/delete with first actor %s and compensates once',
    async (user) => {
      const id = idOf(await create().expect(201));
      const responses = await race(
        () => remove(id, user),
        () => remove(id, user === 1 ? 0 : 1),
      );
      expect(responses.map((r) => r.status)).toEqual([204, 404]);
      await money(100, 0);
      expect(
        (await collection('transactions').findOne({ _id: oid(id) }))?.deletedBy,
      ).toEqual(oid(harness.users[user].id));
    },
  );
  it('serializes competing source debits and rejects an overdraft after the first commit', async () => {
    const responses = await race(
      () => create(1, 70),
      () => create(2, 70),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 400]);
    expect(await collection('transactions').countDocuments(budget())).toBe(1);
    await money(30, 70);
  });
  it('treats repeated affordable POSTs as distinct facts', async () => {
    const responses = await race(
      () => create(),
      () => create(),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(idOf(responses[0])).not.toBe(idOf(responses[1]));
    await money(80, 20);
  });
  const archiveCases = (['source', 'destination'] as const).flatMap((side) =>
    (['create', 'patch', 'delete'] as const).flatMap((operation) =>
      [true, false].map((archiveFirst) => ({ side, operation, archiveFirst })),
    ),
  );
  it.each(archiveCases)(
    'serializes $side archive against $operation (archive first: $archiveFirst)',
    async ({ side, operation, archiveFirst }) => {
      const id = operation === 'create' ? '' : idOf(await create().expect(201));
      const change = () =>
        operation === 'create'
          ? create()
          : operation === 'patch'
            ? patch(id)
            : remove(id);
      const archive = () =>
        api(
          'post',
          `${base()}/accounts/${side === 'source' ? sourceId : destinationId}/archive`,
        );
      const responses = await race(
        archiveFirst ? archive : change,
        archiveFirst ? change : archive,
      );
      const success =
        operation === 'create' ? 201 : operation === 'patch' ? 200 : 204;
      expect(responses.map((r) => r.status)).toEqual(
        archiveFirst ? [204, 404] : [success, 204],
      );
      const moved = archiveFirst
        ? operation === 'create'
          ? 0
          : 10
        : operation === 'delete'
          ? 0
          : operation === 'patch'
            ? 25
            : 10;
      await money(100 - moved, moved);
      const before = await snapshots();
      await change().expect(404);
      expect(await snapshots()).toEqual(before);
    },
  );
  const transitionCases = (
    ['revoke', 'remove', 'ownership', 'group-delete'] as const
  ).flatMap((action) =>
    (['create', 'patch', 'delete'] as const).flatMap((operation) =>
      [true, false].map((transitionFirst) => ({
        action,
        operation,
        transitionFirst,
      })),
    ),
  );
  it.each(transitionCases)(
    'serializes $action against $operation (transition first: $transitionFirst)',
    async ({ action, operation, transitionFirst }) => {
      const id =
        operation === 'create' ? '' : idOf(await create(2).expect(201));
      await grant(true).expect(200);
      const actor = action === 'ownership' ? 0 : 1;
      const change = () =>
        operation === 'create'
          ? create(actor)
          : operation === 'patch'
            ? patch(id, actor)
            : remove(id, actor);
      const transition = () =>
        action === 'revoke'
          ? grant(false)
          : action === 'remove'
            ? api('delete', `${base()}/members/${harness.users[1].id}`)
            : action === 'ownership'
              ? api('post', `${base()}/ownership`, 0, {
                  userId: harness.users[1].id,
                })
              : api('delete', base());
      const responses = await race(
        transitionFirst ? transition : change,
        transitionFirst ? change : transition,
      );
      const transitionStatus =
        action === 'remove' || action === 'group-delete' ? 204 : 200;
      const denied =
        action === 'remove' || action === 'group-delete' ? 404 : 403;
      const success =
        operation === 'create' ? 201 : operation === 'patch' ? 200 : 204;
      const allowed =
        !transitionFirst ||
        (operation === 'create' &&
          (action === 'revoke' || action === 'ownership'));
      expect(responses.map((r) => r.status)).toEqual(
        transitionFirst
          ? [transitionStatus, allowed ? success : denied]
          : [success, transitionStatus],
      );
      const moved = allowed
        ? operation === 'delete'
          ? 0
          : operation === 'patch'
            ? 25
            : 10
        : operation === 'create'
          ? 0
          : 10;
      await money(100 - moved, moved, action !== 'group-delete');
      if (operation !== 'create') {
        const row = await collection('transactions').findOne({ _id: oid(id) });
        expect(String(row?.createdBy)).toBe(harness.users[2].id);
        if (operation === 'delete' && allowed)
          expect(String(row?.deletedBy)).toBe(harness.users[actor].id);
      }
    },
  );
  it.each(['create', 'patch', 'delete'] as const)(
    'rolls back %s after the first completed account effect',
    async (operation) => {
      const id = operation === 'create' ? '' : idOf(await create().expect(201));
      const rows = await collection('transactions')
        .find(budget())
        .sort({ _id: 1 })
        .toArray();
      const beforeSnapshots = await snapshots();
      const accounts = await collection('accounts')
        .find(budget())
        .sort({ _id: 1 })
        .toArray();
      const group = await collection('groups').findOne({ _id: oid(groupId) });
      const effects = harness.app.get(AccountsSnapshotsService);
      const apply = effects.applyForBudget.bind(
        effects,
      ) as AccountsSnapshotsService['applyForBudget'];
      let calls = 0;
      const fault = jest
        .spyOn(effects, 'applyForBudget')
        .mockImplementation(async (...args: Parameters<typeof apply>) => {
          if (++calls === 2)
            throw new Error('Injected second transfer account effect failure');
          return apply(...args);
        });
      const change = () =>
        operation === 'create'
          ? create()
          : operation === 'patch'
            ? patch(id)
            : remove(id);
      await change().expect(503);
      fault.mockRestore();
      expect(calls).toBe(2);
      expect(
        await collection('transactions')
          .find(budget())
          .sort({ _id: 1 })
          .toArray(),
      ).toEqual(rows);
      expect(await snapshots()).toEqual(beforeSnapshots);
      expect(
        await collection('accounts').find(budget()).sort({ _id: 1 }).toArray(),
      ).toEqual(accounts);
      expect(
        (await collection('groups').findOne({ _id: oid(groupId) }))
          ?.mutationVersion,
      ).toBe(group?.mutationVersion);
      await money(
        operation === 'create' ? 100 : 90,
        operation === 'create' ? 0 : 10,
      );
      await change().expect(
        operation === 'create' ? 201 : operation === 'patch' ? 200 : 204,
      );
    },
  );
  it('restricts both zero-opening accounts with real active/deleted transfer history and blocks generic deletion', async () => {
    const reserveId = sourceId;
    sourceId = await account('Intermediate');
    const funding = idOf(
      await api('post', `${base()}/transfers`, 1, {
        sourceAccountId: reserveId,
        destinationAccountId: sourceId,
        sourceAmount: 10,
        destinationAmount: 10,
        transactionDate: '2026-02-01T00:00:00Z',
      }).expect(201),
    );
    const id = idOf(await create().expect(201));
    const history = harness.app.get(TransactionsService);
    async function hasHistory(accountId: string) {
      const session = await harness.connection.startSession();
      try {
        return await history.hasHistoryForBudget(budget(), accountId, session);
      } finally {
        await session.endSession();
      }
    }
    for (const accountId of [sourceId, destinationId]) {
      expect(await hasHistory(accountId)).toBe(true);
      await api('delete', `${base()}/accounts/${accountId}`).expect(409);
    }
    const before = await snapshots();
    const stored = await collection('transactions').findOne({ _id: oid(id) });
    await api('delete', `/transactions/${id}`, 1).expect(404);
    await api('delete', `${base()}/transactions/${id}`, 1).expect(404);
    expect(await snapshots()).toEqual(before);
    expect(await collection('transactions').findOne({ _id: oid(id) })).toEqual(
      stored,
    );
    await remove(id).expect(204);
    await remove(funding).expect(204);
    for (const accountId of [sourceId, destinationId]) {
      expect(await hasHistory(accountId)).toBe(true);
      await api('delete', `${base()}/accounts/${accountId}`).expect(409);
    }
  });
});
