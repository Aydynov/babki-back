import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { GroupsAccessService } from '../src/modules/groups/groups-access.service';
import { startGroupsTestApp } from './helpers/groups-test-app';

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

describe('Groups concurrent transactions (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const collections = [
    'groups',
    'groupmemberships',
    'groupmembershipevents',
    'groupinvitations',
    'groupinvitationratelimits',
  ];
  const objectId = (id: string) => new Types.ObjectId(id);
  const collection = (name: string) => harness.connection.collection(name);
  const api = (user: number) => ({
    post: (path: string, body: object = {}) =>
      request(harness.app.getHttpServer() as Parameters<typeof request>[0])
        .post(`/api/v1${path}`)
        .auth(harness.users[user].token, { type: 'bearer' })
        .send(body),
    delete: (path: string) =>
      request(harness.app.getHttpServer() as Parameters<typeof request>[0])
        .delete(`/api/v1${path}`)
        .auth(harness.users[user].token, { type: 'bearer' }),
  });
  const idOf = (response: Response) => (response.body as { id: string }).id;
  const tokenOf = (response: Response) =>
    (response.body as { token: string }).token;
  const accept = (user: number, invitation: Response) =>
    api(user).post('/group-invitations/accept', { token: tokenOf(invitation) });
  async function group() {
    return idOf(
      await api(0)
        .post('/groups', { name: 'Shared budget', type: 'family' })
        .expect(201),
    );
  }
  async function invite(groupId: string) {
    return api(0).post(`/groups/${groupId}/invitations`).expect(201);
  }
  async function join(groupId: string, user: number) {
    await accept(user, await invite(groupId)).expect(200);
  }
  async function events(groupId: string, kind: string) {
    return collection('groupmembershipevents').countDocuments({
      groupId: objectId(groupId),
      kind,
    });
  }
  async function activeMembers(groupId: string) {
    return collection('groupmemberships').countDocuments({
      groupId: objectId(groupId),
      status: 'active',
    });
  }

  /** Hold the first transaction after its real group write. Start the second
   * operation while the lock is held; driver retry and every write stay real. */
  async function race(
    first: () => PromiseLike<Response>,
    second: () => PromiseLike<Response>,
  ) {
    const access = harness.app.get<GroupsAccessService>(GroupsAccessService);
    const serialize = access.serializeMutation.bind(
      access,
    ) as GroupsAccessService['serializeMutation'];
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

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);
  beforeEach(async () => {
    for (const name of collections) await collection(name).deleteMany({});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('allows exactly one of two recipients to consume a single invitation', async () => {
    const groupId = await group();
    const invitation = await invite(groupId);
    const [winner, loser] = await race(
      () => accept(1, invitation),
      () => accept(2, invitation),
    );
    expect([winner.status, loser.status]).toEqual([200, 400]);
    expect(await activeMembers(groupId)).toBe(2);
    expect(await events(groupId, 'joined')).toBe(2);
    const stored = await collection('groupinvitations').findOne({
      _id: objectId(idOf(invitation)),
    });
    expect(stored?.status).toBe('accepted');
    expect(String(stored?.acceptedBy)).toBe(harness.users[1].id);
    expect(
      await collection('groupmemberships').countDocuments({
        groupId: objectId(groupId),
        userId: objectId(harness.users[2].id),
      }),
    ).toBe(0);
  });

  it('does not consume the second invitation when the same recipient races two links', async () => {
    const groupId = await group();
    const first = await invite(groupId);
    const second = await invite(groupId);
    const responses = await race(
      () => accept(1, first),
      () => accept(1, second),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 409]);
    expect(await activeMembers(groupId)).toBe(2);
    expect(await events(groupId, 'joined')).toBe(2);
    expect(
      (
        await collection('groupinvitations').findOne({
          _id: objectId(idOf(second)),
        })
      )?.status,
    ).toBe('pending');
    await accept(2, second).expect(200);
    expect(await activeMembers(groupId)).toBe(3);
  });

  it.each([true, false])(
    'serializes acceptance against revocation (accept first: %s)',
    async (acceptFirst) => {
      const groupId = await group();
      const invitation = await invite(groupId);
      const accepting = () => accept(1, invitation);
      const revoking = () =>
        api(0).delete(`/groups/${groupId}/invitations/${idOf(invitation)}`);
      const responses = await race(
        acceptFirst ? accepting : revoking,
        acceptFirst ? revoking : accepting,
      );
      expect(responses[0].status).toBe(acceptFirst ? 200 : 204);
      expect(responses[1].status).toBe(acceptFirst ? 409 : 400);
      expect(await activeMembers(groupId)).toBe(acceptFirst ? 2 : 1);
      expect(await events(groupId, 'joined')).toBe(acceptFirst ? 2 : 1);
      const stored = await collection('groupinvitations').findOne({
        _id: objectId(idOf(invitation)),
      });
      expect(stored?.status).toBe(acceptFirst ? 'accepted' : 'revoked');
      expect(!!stored?.acceptedBy).toBe(acceptFirst);
      expect(!!stored?.revokedBy).toBe(!acceptFirst);
    },
  );

  it.each([true, false])(
    'serializes acceptance against deletion (accept first: %s)',
    async (acceptFirst) => {
      const groupId = await group();
      const invitation = await invite(groupId);
      const accepting = () => accept(1, invitation);
      const deleting = () => api(0).delete(`/groups/${groupId}`);
      const responses = await race(
        acceptFirst ? accepting : deleting,
        acceptFirst ? deleting : accepting,
      );
      expect(responses.map((response) => response.status)).toEqual(
        acceptFirst ? [200, 204] : [204, 400],
      );
      expect(
        (await collection('groups').findOne({ _id: objectId(groupId) }))
          ?.deletedAt,
      ).toBeInstanceOf(Date);
      expect(await events(groupId, 'group-deleted')).toBe(1);
      expect(await events(groupId, 'joined')).toBe(acceptFirst ? 2 : 1);
      // Physical membership history is retained, but every active period ends.
      expect(await activeMembers(groupId)).toBe(0);
      expect(
        await collection('groupmemberships').countDocuments({
          groupId: objectId(groupId),
          status: 'removed',
          endReason: 'group_deleted',
          endedAt: { $type: 'date' },
        }),
      ).toBe(acceptFirst ? 2 : 1);
      if (!acceptFirst) {
        const storedInvitation = await collection('groupinvitations').findOne({
          _id: objectId(idOf(invitation)),
        });
        expect(storedInvitation).toMatchObject({
          status: 'revoked',
          revocationReason: 'group_deleted',
          revokedAt: expect.any(Date),
        });
        const deletedGroup = await collection('groups').findOne({
          _id: objectId(groupId),
        });
        const endedMembership = await collection('groupmemberships').findOne({
          groupId: objectId(groupId),
        });
        expect(storedInvitation?.revokedAt).toEqual(deletedGroup?.deletedAt);
        expect(endedMembership?.endedAt).toEqual(deletedGroup?.deletedAt);
      }
      await request(
        harness.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${groupId}`)
        .auth(harness.users[1].token, { type: 'bearer' })
        .expect(404);
    },
  );

  it.each([true, false])(
    'serializes member leave against deletion (leave first: %s)',
    async (leaveFirst) => {
      const groupId = await group();
      await join(groupId, 1);
      const leave = () => api(1).post(`/groups/${groupId}/leave`);
      const deletion = () => api(0).delete(`/groups/${groupId}`);
      const responses = await race(
        leaveFirst ? leave : deletion,
        leaveFirst ? deletion : leave,
      );
      expect(responses.map(({ status }) => status)).toEqual(
        leaveFirst ? [204, 204] : [204, 404],
      );
      expect(await activeMembers(groupId)).toBe(0);
      const member = await collection('groupmemberships').findOne({
        groupId: objectId(groupId),
        userId: objectId(harness.users[1].id),
      });
      expect(member?.endReason).toBe(
        leaveFirst ? 'member_left' : 'group_deleted',
      );
    },
  );

  it.each([true, false])(
    'serializes member removal against group deletion (removal first: %s)',
    async (removalFirst) => {
      const groupId = await group();
      await join(groupId, 1);
      const removal = () =>
        api(0).delete(`/groups/${groupId}/members/${harness.users[1].id}`);
      const deletion = () => api(0).delete(`/groups/${groupId}`);
      const responses = await race(
        removalFirst ? removal : deletion,
        removalFirst ? deletion : removal,
      );
      expect(responses.map(({ status }) => status)).toEqual(
        removalFirst ? [204, 204] : [204, 404],
      );
      expect(await activeMembers(groupId)).toBe(0);
      const member = await collection('groupmemberships').findOne({
        groupId: objectId(groupId),
        userId: objectId(harness.users[1].id),
      });
      expect(member?.endReason).toBe(
        removalFirst ? 'member_removed' : 'group_deleted',
      );
    },
  );

  it.each([true, false])(
    'keeps the owner active during transfer versus leave (transfer first: %s)',
    async (transferFirst) => {
      const groupId = await group();
      await join(groupId, 1);
      const transfer = () =>
        api(0).post(`/groups/${groupId}/ownership`, {
          userId: harness.users[1].id,
        });
      const leave = () => api(1).post(`/groups/${groupId}/leave`);
      const responses = await race(
        transferFirst ? transfer : leave,
        transferFirst ? leave : transfer,
      );
      expect(responses[0].status).toBe(transferFirst ? 200 : 204);
      expect(responses[1].status).toBe(transferFirst ? 409 : 404);
      const stored = await collection('groups').findOne({
        _id: objectId(groupId),
      });
      expect(String(stored?.ownerId)).toBe(
        harness.users[transferFirst ? 1 : 0].id,
      );
      expect(
        await collection('groupmemberships').countDocuments({
          groupId: objectId(groupId),
          userId: stored?.ownerId,
          status: 'active',
        }),
      ).toBe(1);
      expect(await events(groupId, 'ownership-transferred')).toBe(
        transferFirst ? 1 : 0,
      );
      expect(await events(groupId, 'left')).toBe(transferFirst ? 0 : 1);
    },
  );

  it.each([true, false])(
    'rechecks owner rights during transfer versus removal (transfer first: %s)',
    async (transferFirst) => {
      const groupId = await group();
      await join(groupId, 1);
      const transfer = () =>
        api(0).post(`/groups/${groupId}/ownership`, {
          userId: harness.users[1].id,
        });
      const remove = () =>
        api(0).delete(`/groups/${groupId}/members/${harness.users[1].id}`);
      const responses = await race(
        transferFirst ? transfer : remove,
        transferFirst ? remove : transfer,
      );
      expect(responses[0].status).toBe(transferFirst ? 200 : 204);
      expect(responses[1].status).toBe(transferFirst ? 403 : 404);
      expect(await events(groupId, 'ownership-transferred')).toBe(
        transferFirst ? 1 : 0,
      );
      expect(await events(groupId, 'removed')).toBe(transferFirst ? 0 : 1);
      const stored = await collection('groups').findOne({
        _id: objectId(groupId),
      });
      expect(String(stored?.ownerId)).toBe(
        harness.users[transferFirst ? 1 : 0].id,
      );
      expect(
        await collection('groupmemberships').countDocuments({
          groupId: objectId(groupId),
          userId: stored?.ownerId,
          status: 'active',
        }),
      ).toBe(1);
    },
  );

  it.each([true, false])(
    'serializes ownership transfer against deletion (transfer first: %s)',
    async (transferFirst) => {
      const groupId = await group();
      await join(groupId, 1);
      const transfer = () =>
        api(0).post(`/groups/${groupId}/ownership`, {
          userId: harness.users[1].id,
        });
      const remove = () => api(0).delete(`/groups/${groupId}`);
      const responses = await race(
        transferFirst ? transfer : remove,
        transferFirst ? remove : transfer,
      );
      expect(responses.map((response) => response.status)).toEqual(
        transferFirst ? [200, 403] : [204, 404],
      );
      const stored = await collection('groups').findOne({
        _id: objectId(groupId),
      });
      expect(!!stored?.deletedAt).toBe(!transferFirst);
      expect(String(stored?.ownerId)).toBe(
        harness.users[transferFirst ? 1 : 0].id,
      );
      expect(await events(groupId, 'ownership-transferred')).toBe(
        transferFirst ? 1 : 0,
      );
      expect(await events(groupId, 'group-deleted')).toBe(
        transferFirst ? 0 : 1,
      );
      expect(await activeMembers(groupId)).toBe(transferFirst ? 2 : 0);
    },
  );

  it('only commits one competing transfer by the former owner', async () => {
    const groupId = await group();
    await join(groupId, 1);
    await join(groupId, 2);
    const responses = await race(
      () =>
        api(0).post(`/groups/${groupId}/ownership`, {
          userId: harness.users[1].id,
        }),
      () =>
        api(0).post(`/groups/${groupId}/ownership`, {
          userId: harness.users[2].id,
        }),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 403]);
    expect(
      String(
        (await collection('groups').findOne({ _id: objectId(groupId) }))
          ?.ownerId,
      ),
    ).toBe(harness.users[1].id);
    expect(await events(groupId, 'ownership-transferred')).toBe(1);
    expect(await activeMembers(groupId)).toBe(3);
  });

  it('rolls back creation if the membership event cannot be written', async () => {
    const model = harness.app.get<Model<object>>(
      getModelToken('GroupMembershipEvent'),
    );
    jest
      .spyOn(model, 'create')
      .mockRejectedValueOnce(new Error('Injected event write failure'));
    const response = await api(0).post('/groups', {
      name: 'Must roll back',
      type: 'organization',
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
    for (const name of [
      'groups',
      'groupmemberships',
      'groupmembershipevents',
    ]) {
      expect(await collection(name).countDocuments({})).toBe(0);
    }
  });

  it('rolls back invitation consumption, membership and version if the joined event fails', async () => {
    const groupId = await group();
    const invitation = await invite(groupId);
    const before = await collection('groups').findOne({
      _id: objectId(groupId),
    });
    const model = harness.app.get<Model<object>>(
      getModelToken('GroupMembershipEvent'),
    );
    const fault = jest
      .spyOn(model, 'create')
      .mockRejectedValueOnce(new Error('Injected event write failure'));
    const response = await accept(1, invitation);
    expect(response.status).toBeGreaterThanOrEqual(500);
    fault.mockRestore();
    expect(await activeMembers(groupId)).toBe(1);
    expect(await events(groupId, 'joined')).toBe(1);
    expect(
      (await collection('groups').findOne({ _id: objectId(groupId) }))
        ?.mutationVersion,
    ).toBe(before?.mutationVersion);
    expect(
      (
        await collection('groupinvitations').findOne({
          _id: objectId(idOf(invitation)),
        })
      )?.status,
    ).toBe('pending');
    await accept(1, invitation).expect(200);
  });

  it('reactivates the same membership while retaining each period in immutable events', async () => {
    const groupId = await group();
    await join(groupId, 1);
    const filter = {
      groupId: objectId(groupId),
      userId: objectId(harness.users[1].id),
    };
    const initial = await collection('groupmemberships').findOne(filter);
    await api(1).post(`/groups/${groupId}/leave`).expect(204);
    await join(groupId, 1);
    await api(0)
      .delete(`/groups/${groupId}/members/${harness.users[1].id}`)
      .expect(204);
    await join(groupId, 1);
    const current = await collection('groupmemberships').findOne(filter);
    expect(String(current?._id)).toBe(String(initial?._id));
    expect(current?.status).toBe('active');
    expect(current?.endedAt ?? null).toBeNull();
    expect(await collection('groupmemberships').countDocuments(filter)).toBe(1);
    const history = await collection('groupmembershipevents')
      .find(filter)
      .sort({ occurredAt: 1, _id: 1 })
      .toArray();
    expect(history.map((event) => String(event.kind))).toEqual([
      'joined',
      'left',
      'joined',
      'removed',
      'joined',
    ]);
  });
});
