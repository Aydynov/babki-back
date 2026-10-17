import { ClientSession, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { GroupsTransactionService } from '../src/modules/groups/groups-transaction.service';
import { startGroupsTestApp } from './helpers/groups-test-app';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// A timeout only fails a missing rendezvous; ordering uses explicit barriers.
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

describe('Invitation preview domain isolation (real replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const domainCollections = [
    'groups',
    'groupinvitations',
    'groupmemberships',
    'groupmembershipevents',
    'accounts',
    'accountsnapshots',
    'expensecategories',
    'expenselimits',
    'transactions',
    'debts',
    'plans',
  ];
  const collection = (name: string) => harness.connection.collection(name);
  const oid = (id: string) => new Types.ObjectId(id);
  function api(
    method: 'post' | 'get' | 'delete',
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
    const body = response.body as { id?: string; _id?: string };
    return (body.id ?? body._id)!;
  };
  const tokenOf = (invitation: Response) =>
    (invitation.body as { token: string }).token;
  const preview = (invitation: Response, user = 1) =>
    api('post', '/group-invitations/preview', user, {
      token: tokenOf(invitation),
    });
  const accept = (invitation: Response, user = 2) =>
    api('post', '/group-invitations/accept', user, {
      token: tokenOf(invitation),
    });
  async function setup() {
    const groupId = idOf(
      await api('post', '/groups', 0, {
        name: 'Preview budget',
        type: 'family',
      }).expect(201),
    );
    const invitation = await api(
      'post',
      `/groups/${groupId}/invitations`,
    ).expect(201);
    return { groupId, invitation };
  }
  async function domainSnapshot() {
    return Promise.all(
      domainCollections.map(async (name) => ({
        name,
        documents: JSON.stringify(
          await collection(name).find({}).sort({ _id: 1 }).toArray(),
        ),
      })),
    );
  }
  async function assertOneAcceptance(groupId: string, invitation: Response) {
    expect(
      await collection('groupmemberships').countDocuments({
        groupId: oid(groupId),
        status: 'active',
      }),
    ).toBe(2);
    expect(
      await collection('groupmemberships').countDocuments({
        groupId: oid(groupId),
        userId: oid(harness.users[1].id),
      }),
    ).toBe(0);
    expect(
      await collection('groupmembershipevents').countDocuments({
        groupId: oid(groupId),
        kind: 'joined',
      }),
    ).toBe(2);
    const stored = await collection('groupinvitations').findOne({
      _id: oid(idOf(invitation)),
    });
    expect(stored?.status).toBe('accepted');
    expect(String(stored?.acceptedBy)).toBe(harness.users[2].id);
    const afterAccept = await domainSnapshot();
    for (const action of [preview, accept]) {
      const response = await action(invitation, 1).expect(400);
      expect(response.body as object).toMatchObject({
        message: 'Invalid invitation',
        error: 'Bad Request',
      });
    }
    expect(await domainSnapshot()).toEqual(afterAccept);
  }

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);
  beforeEach(async () => {
    for (const name of [...domainCollections, 'groupinvitationratelimits'])
      await collection(name).deleteMany({});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('allows repeated previews without domain writes before one acceptance', async () => {
    const { groupId, invitation } = await setup();
    const accountId = idOf(
      await api('post', `/groups/${groupId}/accounts`, 0, {
        name: 'Shared cash',
        currency: 'USD',
        amount: 100,
        openedAt: '2026-01-01T00:00:00.000Z',
      }).expect(201),
    );
    const categoryId = idOf(
      await api('post', `/groups/${groupId}/expense-categories`, 0, {
        name: 'Food',
      }).expect(201),
    );
    await api('post', `/groups/${groupId}/expenses`, 0, {
      accountId,
      categoryId,
      amount: 10,
      transactionDate: '2026-02-15T12:00:00.000Z',
    }).expect(201);
    expect(
      await collection('accountsnapshots').countDocuments({}),
    ).toBeGreaterThan(0);
    const before = await domainSnapshot();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await preview(invitation, 2).expect(200);
      expect(response.body as object).toEqual({
        name: 'Preview budget',
        type: 'family',
        expiresAt: (invitation.body as { expiresAt: string }).expiresAt,
      });
      expect(await domainSnapshot()).toEqual(before);
      await api('get', `/groups/${groupId}`, 2).expect(404);
      await api('get', `/groups/${groupId}/accounts`, 2).expect(404);
    }
    const counters = await collection('groupinvitationratelimits')
      .find({ userId: oid(harness.users[2].id) })
      .toArray();
    expect(
      counters.reduce((total, counter) => total + Number(counter.count), 0),
    ).toBe(2);
    await accept(invitation).expect(200);
    await assertOneAcceptance(groupId, invitation);
  });

  it.each(['revoked', 'expired', 'accepted', 'deleted'] as const)(
    'rechecks %s invitations after a successful preview',
    async (state) => {
      const { groupId, invitation } = await setup();
      await preview(invitation).expect(200);
      if (state === 'revoked')
        await api(
          'delete',
          `/groups/${groupId}/invitations/${idOf(invitation)}`,
        ).expect(204);
      if (state === 'expired')
        await collection('groupinvitations').updateOne(
          { _id: oid(idOf(invitation)) },
          { $set: { expiresAt: new Date(0) } },
        );
      if (state === 'accepted') await accept(invitation).expect(200);
      if (state === 'deleted')
        await api('delete', `/groups/${groupId}`).expect(204);
      const before = await domainSnapshot();
      const responses = [
        await preview(invitation).expect(400),
        await accept(invitation, 1).expect(400),
      ];
      for (const response of responses)
        expect(response.body as object).toMatchObject({
          message: 'Invalid invitation',
          error: 'Bad Request',
        });
      expect(await domainSnapshot()).toEqual(before);
      expect(
        await collection('groupmemberships').countDocuments({
          groupId: oid(groupId),
          userId: oid(harness.users[1].id),
        }),
      ).toBe(0);
      expect(
        await collection('groupmembershipevents').countDocuments({
          groupId: oid(groupId),
          kind: 'joined',
        }),
      ).toBe(state === 'accepted' ? 2 : 1);
    },
  );

  it.each([true, false])(
    'keeps preview read-only while acceptance overlaps (preview first: %s)',
    async (previewFirst) => {
      const { groupId, invitation } = await setup();
      const transactions = harness.app.get<GroupsTransactionService>(
        GroupsTransactionService,
      );
      const run = transactions.run.bind(
        transactions,
      ) as GroupsTransactionService['run'];
      const held = deferred();
      const release = deferred();
      let first = true;
      // Wrap the real callback after its reads/writes, before real transaction commit.
      // The other request still runs its own real session and transaction.
      const spy = jest
        .spyOn(transactions, 'run')
        .mockImplementation(
          <T>(callback: (session: ClientSession) => Promise<T>): Promise<T> => {
            const hold = first;
            first = false;
            return run(async (session) => {
              const result = await callback(session);
              if (hold) {
                held.resolve();
                await release.promise;
              }
              return result;
            });
          },
        );
      const before = await domainSnapshot();
      const firstResponse = Promise.resolve(
        previewFirst ? preview(invitation) : accept(invitation),
      );
      let secondResponse: Promise<Response> | undefined;
      try {
        await rendezvous(held.promise);
        // Neither preview nor an uncommitted accept is externally visible here.
        expect(await domainSnapshot()).toEqual(before);
        secondResponse = Promise.resolve(
          previewFirst ? accept(invitation) : preview(invitation),
        );
        const second = await secondResponse;
        expect(second.status).toBe(200);
        const afterSecond = await domainSnapshot();
        if (!previewFirst) expect(afterSecond).toEqual(before);
        release.resolve();
        const firstResult = await firstResponse;
        expect(firstResult.status).toBe(200);
        if (previewFirst) expect(await domainSnapshot()).toEqual(afterSecond);
        const previewResult = previewFirst ? firstResult : second;
        expect(previewResult.body as object).toEqual({
          name: 'Preview budget',
          type: 'family',
          expiresAt: (invitation.body as { expiresAt: string }).expiresAt,
        });
      } finally {
        release.resolve();
        await Promise.allSettled([
          firstResponse,
          ...(secondResponse ? [secondResponse] : []),
        ]);
        spy.mockRestore();
      }
      await assertOneAcceptance(groupId, invitation);
    },
  );
});
