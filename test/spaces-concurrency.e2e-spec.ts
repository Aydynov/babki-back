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
describe('Spaces concurrent transactions (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startSpacesTestApp>>;
  const collections = [
    'spaces',
    'spacememberships',
    'spacemembershipevents',
    'spaceinvitations',
    'spaceinvitationratelimits',
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
  const idOf = (response: Response) =>
    (
      response.body as {
        id: string;
      }
    ).id;
  const tokenOf = (response: Response) =>
    (
      response.body as {
        token: string;
      }
    ).token;
  const accept = (user: number, invitation: Response) =>
    api(user).post('/space-invitations/accept', { token: tokenOf(invitation) });
  async function space() {
    return idOf(
      await api(0).post('/spaces', { name: 'Shared budget' }).expect(201),
    );
  }
  async function invite(spaceId: string) {
    return api(0).post(`/spaces/${spaceId}/invitations`).expect(201);
  }
  async function join(spaceId: string, user: number) {
    await accept(user, await invite(spaceId)).expect(200);
  }
  async function events(spaceId: string, kind: string) {
    return collection('spacemembershipevents').countDocuments({
      spaceId: objectId(spaceId),
      kind,
    });
  }
  async function activeMembers(spaceId: string) {
    return collection('spacememberships').countDocuments({
      spaceId: objectId(spaceId),
      status: 'active',
    });
  }
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
  beforeAll(async () => {
    harness = await startSpacesTestApp();
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
    const spaceId = await space();
    const invitation = await invite(spaceId);
    const [winner, loser] = await race(
      () => accept(1, invitation),
      () => accept(2, invitation),
    );
    expect([winner.status, loser.status]).toEqual([200, 400]);
    expect(await activeMembers(spaceId)).toBe(2);
    expect(await events(spaceId, 'joined')).toBe(2);
    const stored = await collection('spaceinvitations').findOne({
      _id: objectId(idOf(invitation)),
    });
    expect(stored?.status).toBe('accepted');
    expect(String(stored?.acceptedBy)).toBe(harness.users[1].id);
    expect(
      await collection('spacememberships').countDocuments({
        spaceId: objectId(spaceId),
        userId: objectId(harness.users[2].id),
      }),
    ).toBe(0);
  });
  it('does not consume the second invitation when the same recipient races two links', async () => {
    const spaceId = await space();
    const first = await invite(spaceId);
    const second = await invite(spaceId);
    const responses = await race(
      () => accept(1, first),
      () => accept(1, second),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 409]);
    expect(await activeMembers(spaceId)).toBe(2);
    expect(await events(spaceId, 'joined')).toBe(2);
    expect(
      (
        await collection('spaceinvitations').findOne({
          _id: objectId(idOf(second)),
        })
      )?.status,
    ).toBe('pending');
    await accept(2, second).expect(200);
    expect(await activeMembers(spaceId)).toBe(3);
  });
  it.each([true, false])(
    'serializes acceptance against revocation (accept first: %s)',
    async (acceptFirst) => {
      const spaceId = await space();
      const invitation = await invite(spaceId);
      const accepting = () => accept(1, invitation);
      const revoking = () =>
        api(0).delete(`/spaces/${spaceId}/invitations/${idOf(invitation)}`);
      const responses = await race(
        acceptFirst ? accepting : revoking,
        acceptFirst ? revoking : accepting,
      );
      expect(responses[0].status).toBe(acceptFirst ? 200 : 204);
      expect(responses[1].status).toBe(acceptFirst ? 409 : 400);
      expect(await activeMembers(spaceId)).toBe(acceptFirst ? 2 : 1);
      expect(await events(spaceId, 'joined')).toBe(acceptFirst ? 2 : 1);
      const stored = await collection('spaceinvitations').findOne({
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
      const spaceId = await space();
      const invitation = await invite(spaceId);
      const accepting = () => accept(1, invitation);
      const deleting = () => api(0).delete(`/spaces/${spaceId}`);
      const responses = await race(
        acceptFirst ? accepting : deleting,
        acceptFirst ? deleting : accepting,
      );
      expect(responses.map((response) => response.status)).toEqual(
        acceptFirst ? [200, 204] : [204, 400],
      );
      expect(
        (await collection('spaces').findOne({ _id: objectId(spaceId) }))
          ?.deletedAt,
      ).toBeInstanceOf(Date);
      expect(await events(spaceId, 'space-deleted')).toBe(1);
      expect(await events(spaceId, 'joined')).toBe(acceptFirst ? 2 : 1);
      // Physical membership history is retained, but every active period ends.
      expect(await activeMembers(spaceId)).toBe(0);
      expect(
        await collection('spacememberships').countDocuments({
          spaceId: objectId(spaceId),
          status: 'removed',
          endReason: 'space_deleted',
          endedAt: { $type: 'date' },
        }),
      ).toBe(acceptFirst ? 2 : 1);
      if (!acceptFirst) {
        const storedInvitation = await collection('spaceinvitations').findOne({
          _id: objectId(idOf(invitation)),
        });
        expect(storedInvitation).toMatchObject({
          status: 'revoked',
          revocationReason: 'space_deleted',
          revokedAt: expect.any(Date) as unknown,
        });
        const deletedSpace = await collection('spaces').findOne({
          _id: objectId(spaceId),
        });
        const endedMembership = await collection('spacememberships').findOne({
          spaceId: objectId(spaceId),
        });
        expect(storedInvitation?.revokedAt).toEqual(deletedSpace?.deletedAt);
        expect(endedMembership?.endedAt).toEqual(deletedSpace?.deletedAt);
      }
      await request(
        harness.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/spaces/${spaceId}`)
        .auth(harness.users[1].token, { type: 'bearer' })
        .expect(404);
    },
  );
  it.each([true, false])(
    'serializes member leave against deletion (leave first: %s)',
    async (leaveFirst) => {
      const spaceId = await space();
      await join(spaceId, 1);
      const leave = () => api(1).post(`/spaces/${spaceId}/leave`);
      const deletion = () => api(0).delete(`/spaces/${spaceId}`);
      const responses = await race(
        leaveFirst ? leave : deletion,
        leaveFirst ? deletion : leave,
      );
      expect(responses.map(({ status }) => status)).toEqual(
        leaveFirst ? [204, 204] : [204, 404],
      );
      expect(await activeMembers(spaceId)).toBe(0);
      const member = await collection('spacememberships').findOne({
        spaceId: objectId(spaceId),
        userId: objectId(harness.users[1].id),
      });
      expect(member?.endReason).toBe(
        leaveFirst ? 'member_left' : 'space_deleted',
      );
    },
  );
  it.each([true, false])(
    'serializes member removal against space deletion (removal first: %s)',
    async (removalFirst) => {
      const spaceId = await space();
      await join(spaceId, 1);
      const removal = () =>
        api(0).delete(`/spaces/${spaceId}/members/${harness.users[1].id}`);
      const deletion = () => api(0).delete(`/spaces/${spaceId}`);
      const responses = await race(
        removalFirst ? removal : deletion,
        removalFirst ? deletion : removal,
      );
      expect(responses.map(({ status }) => status)).toEqual(
        removalFirst ? [204, 204] : [204, 404],
      );
      expect(await activeMembers(spaceId)).toBe(0);
      const member = await collection('spacememberships').findOne({
        spaceId: objectId(spaceId),
        userId: objectId(harness.users[1].id),
      });
      expect(member?.endReason).toBe(
        removalFirst ? 'member_removed' : 'space_deleted',
      );
    },
  );
  it.each([true, false])(
    'keeps the owner active during transfer versus leave (transfer first: %s)',
    async (transferFirst) => {
      const spaceId = await space();
      await join(spaceId, 1);
      const transfer = () =>
        api(0).post(`/spaces/${spaceId}/ownership`, {
          userId: harness.users[1].id,
        });
      const leave = () => api(1).post(`/spaces/${spaceId}/leave`);
      const responses = await race(
        transferFirst ? transfer : leave,
        transferFirst ? leave : transfer,
      );
      expect(responses[0].status).toBe(transferFirst ? 200 : 204);
      expect(responses[1].status).toBe(transferFirst ? 409 : 404);
      const stored = await collection('spaces').findOne({
        _id: objectId(spaceId),
      });
      expect(String(stored?.ownerId)).toBe(
        harness.users[transferFirst ? 1 : 0].id,
      );
      expect(
        await collection('spacememberships').countDocuments({
          spaceId: objectId(spaceId),
          userId: stored?.ownerId,
          status: 'active',
        }),
      ).toBe(1);
      expect(await events(spaceId, 'ownership-transferred')).toBe(
        transferFirst ? 1 : 0,
      );
      expect(await events(spaceId, 'left')).toBe(transferFirst ? 0 : 1);
    },
  );
  it.each([true, false])(
    'rechecks owner rights during transfer versus removal (transfer first: %s)',
    async (transferFirst) => {
      const spaceId = await space();
      await join(spaceId, 1);
      const transfer = () =>
        api(0).post(`/spaces/${spaceId}/ownership`, {
          userId: harness.users[1].id,
        });
      const remove = () =>
        api(0).delete(`/spaces/${spaceId}/members/${harness.users[1].id}`);
      const responses = await race(
        transferFirst ? transfer : remove,
        transferFirst ? remove : transfer,
      );
      expect(responses[0].status).toBe(transferFirst ? 200 : 204);
      expect(responses[1].status).toBe(transferFirst ? 403 : 404);
      expect(await events(spaceId, 'ownership-transferred')).toBe(
        transferFirst ? 1 : 0,
      );
      expect(await events(spaceId, 'removed')).toBe(transferFirst ? 0 : 1);
      const stored = await collection('spaces').findOne({
        _id: objectId(spaceId),
      });
      expect(String(stored?.ownerId)).toBe(
        harness.users[transferFirst ? 1 : 0].id,
      );
      expect(
        await collection('spacememberships').countDocuments({
          spaceId: objectId(spaceId),
          userId: stored?.ownerId,
          status: 'active',
        }),
      ).toBe(1);
    },
  );
  it.each([true, false])(
    'serializes ownership transfer against deletion (transfer first: %s)',
    async (transferFirst) => {
      const spaceId = await space();
      await join(spaceId, 1);
      const transfer = () =>
        api(0).post(`/spaces/${spaceId}/ownership`, {
          userId: harness.users[1].id,
        });
      const remove = () => api(0).delete(`/spaces/${spaceId}`);
      const responses = await race(
        transferFirst ? transfer : remove,
        transferFirst ? remove : transfer,
      );
      expect(responses.map((response) => response.status)).toEqual(
        transferFirst ? [200, 403] : [204, 404],
      );
      const stored = await collection('spaces').findOne({
        _id: objectId(spaceId),
      });
      expect(!!stored?.deletedAt).toBe(!transferFirst);
      expect(String(stored?.ownerId)).toBe(
        harness.users[transferFirst ? 1 : 0].id,
      );
      expect(await events(spaceId, 'ownership-transferred')).toBe(
        transferFirst ? 1 : 0,
      );
      expect(await events(spaceId, 'space-deleted')).toBe(
        transferFirst ? 0 : 1,
      );
      expect(await activeMembers(spaceId)).toBe(transferFirst ? 2 : 0);
    },
  );
  it('only commits one competing transfer by the former owner', async () => {
    const spaceId = await space();
    await join(spaceId, 1);
    await join(spaceId, 2);
    const responses = await race(
      () =>
        api(0).post(`/spaces/${spaceId}/ownership`, {
          userId: harness.users[1].id,
        }),
      () =>
        api(0).post(`/spaces/${spaceId}/ownership`, {
          userId: harness.users[2].id,
        }),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 403]);
    expect(
      String(
        (await collection('spaces').findOne({ _id: objectId(spaceId) }))
          ?.ownerId,
      ),
    ).toBe(harness.users[1].id);
    expect(await events(spaceId, 'ownership-transferred')).toBe(1);
    expect(await activeMembers(spaceId)).toBe(3);
  });
  it('rolls back creation if the membership event cannot be written', async () => {
    const model = harness.app.get<Model<object>>(
      getModelToken('SpaceMembershipEvent'),
    );
    jest
      .spyOn(model, 'create')
      .mockRejectedValueOnce(new Error('Injected event write failure'));
    const response = await api(0).post('/spaces', {
      name: 'Must roll back',
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
    for (const name of [
      'spaces',
      'spacememberships',
      'spacemembershipevents',
    ]) {
      expect(await collection(name).countDocuments({})).toBe(0);
    }
  });
  it('rolls back invitation consumption, membership and version if the joined event fails', async () => {
    const spaceId = await space();
    const invitation = await invite(spaceId);
    const before = await collection('spaces').findOne({
      _id: objectId(spaceId),
    });
    const model = harness.app.get<Model<object>>(
      getModelToken('SpaceMembershipEvent'),
    );
    const fault = jest
      .spyOn(model, 'create')
      .mockRejectedValueOnce(new Error('Injected event write failure'));
    const response = await accept(1, invitation);
    expect(response.status).toBeGreaterThanOrEqual(500);
    fault.mockRestore();
    expect(await activeMembers(spaceId)).toBe(1);
    expect(await events(spaceId, 'joined')).toBe(1);
    expect(
      (await collection('spaces').findOne({ _id: objectId(spaceId) }))
        ?.mutationVersion,
    ).toBe(before?.mutationVersion);
    expect(
      (
        await collection('spaceinvitations').findOne({
          _id: objectId(idOf(invitation)),
        })
      )?.status,
    ).toBe('pending');
    await accept(1, invitation).expect(200);
  });
  it('reactivates the same membership while retaining each period in immutable events', async () => {
    const spaceId = await space();
    await join(spaceId, 1);
    const filter = {
      spaceId: objectId(spaceId),
      userId: objectId(harness.users[1].id),
    };
    const initial = await collection('spacememberships').findOne(filter);
    await api(1).post(`/spaces/${spaceId}/leave`).expect(204);
    await join(spaceId, 1);
    await api(0)
      .delete(`/spaces/${spaceId}/members/${harness.users[1].id}`)
      .expect(204);
    await join(spaceId, 1);
    const current = await collection('spacememberships').findOne(filter);
    expect(String(current?._id)).toBe(String(initial?._id));
    expect(current?.status).toBe('active');
    expect(current?.endedAt ?? null).toBeNull();
    expect(await collection('spacememberships').countDocuments(filter)).toBe(1);
    const history = await collection('spacemembershipevents')
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
