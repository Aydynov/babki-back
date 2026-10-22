import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
type SpaceResponse = {
  id: string;
  name: string;
  role: string;
  ownerId: string;
};
type InvitationResponse = {
  id: string;
  token: string;
  expiresAt: string;
};
type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};
describe('Spaces HTTP contracts (real replica set)', () => {
  let context: Awaited<ReturnType<typeof startSpacesTestApp>>;
  beforeAll(async () => {
    context = await startSpacesTestApp();
  }, 60000);
  beforeEach(async () => {
    for (const name of [
      'spaces',
      'spacememberships',
      'spacemembershipevents',
      'spaceinvitations',
      'spaceinvitationratelimits',
    ]) {
      await context.connection.collection(name).deleteMany({});
    }
  });
  afterAll(async () => {
    await context?.close();
  }, 30000);
  function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) {
    const call = request(
      context.app.getHttpServer() as Parameters<typeof request>[0],
    )[method](`/api/v1${path}`);
    return user < 0
      ? call
      : call.set('Authorization', `Bearer ${context.users[user].token}`);
  }
  async function space(_type = 'family', user = 0) {
    const response = await api('post', '/spaces', user)
      .send({ name: ' Family ' })
      .expect(201);
    return response.body as SpaceResponse;
  }
  async function invite(id: string, owner = 0) {
    const response = await api(
      'post',
      `/spaces/${id}/invitations`,
      owner,
    ).expect(201);
    return response.body as InvitationResponse;
  }
  async function join(id: string, user = 1, owner = 0) {
    const invitation = await invite(id, owner);
    await api('post', '/space-invitations/accept', user)
      .send({ token: invitation.token })
      .expect(200);
    return invitation;
  }
  it('creates a space with exactly one owner without exposing internal fields', async () => {
    const response = await api('post', '/spaces')
      .send({ name: ' Family ' })
      .expect(201);
    expect(response.body).toEqual({
      id: expect.any(String) as unknown,
      name: 'Family',
      ownerId: context.users[0].id,
      role: 'owner',
      permissions: {
        manageAccounts: true,
        manageCategories: true,
        manageLimits: true,
        manageTransactions: true,
      },
      createdAt: expect.any(String) as unknown,
      updatedAt: expect.any(String) as unknown,
    });
    const members = await api(
      'get',
      `/spaces/${(response.body as SpaceResponse).id}/members`,
    ).expect(200);
    expect((members.body as Page<unknown>).items).toEqual([
      {
        userId: context.users[0].id,
        firstName: 'Ada',
        lastName: 'Test',
        role: 'owner',
        permissions: {
          manageAccounts: true,
          manageCategories: true,
          manageLimits: true,
          manageTransactions: true,
        },
        joinedAt: expect.any(String) as unknown,
      },
    ]);
  });
  it('keeps a family and two organizations independent through membership lifecycle', async () => {
    const family = await space();
    const orgA = await space('organization');
    const orgB = await space('organization');
    await join(family.id);
    await join(orgA.id);
    await join(orgB.id);
    const list = await api('get', '/spaces?page=1&limit=2', 1).expect(200);
    expect((list.body as Page<SpaceResponse>).total).toBe(3);
    expect((list.body as Page<SpaceResponse>).items).toHaveLength(2);
    await api('post', `/spaces/${family.id}/ownership`)
      .send({ userId: context.users[1].id })
      .expect(200);
    await api('patch', `/spaces/${family.id}`)
      .send({ name: 'Denied' })
      .expect(403);
    await api('post', `/spaces/${family.id}/leave`).expect(204);
    await api('get', `/spaces/${family.id}`).expect(404);
    await join(family.id, 0, 1);
    await api(
      'delete',
      `/spaces/${orgA.id}/members/${context.users[1].id}`,
    ).expect(204);
    await api('get', `/spaces/${orgA.id}`, 1).expect(404);
    await api('get', `/spaces/${orgB.id}`, 1).expect(200);
    await api('delete', `/spaces/${family.id}`, 1).expect(204);
    await api('get', `/spaces/${family.id}`).expect(404);
    const result = await api('get', '/spaces', 1).expect(200);
    expect(
      (result.body as Page<SpaceResponse>).items.map((item) => item.id),
    ).toEqual([orgB.id]);
  });
  it('requires JWT for every new route', async () => {
    const id = new Types.ObjectId().toString();
    const routes: ['get' | 'post' | 'patch' | 'delete', string][] = [
      ['post', '/spaces'],
      ['get', '/spaces'],
      ['get', `/spaces/${id}`],
      ['patch', `/spaces/${id}`],
      ['delete', `/spaces/${id}`],
      ['get', `/spaces/${id}/members`],
      ['post', `/spaces/${id}/leave`],
      ['delete', `/spaces/${id}/members/${id}`],
      ['post', `/spaces/${id}/ownership`],
      ['post', `/spaces/${id}/invitations`],
      ['get', `/spaces/${id}/invitations`],
      ['delete', `/spaces/${id}/invitations/${id}`],
      ['post', '/space-invitations/accept'],
    ];
    for (const [method, path] of routes)
      await api(method, path, -1).send({}).expect(401);
  });
  it('conceals foreign spaces on every space route', async () => {
    const { id } = await space();
    const invitation = await invite(id);
    const routes: ['get' | 'post' | 'patch' | 'delete', string, object?][] = [
      ['get', `/spaces/${id}`],
      ['patch', `/spaces/${id}`, { name: 'Foreign' }],
      ['delete', `/spaces/${id}`],
      ['get', `/spaces/${id}/members`],
      ['post', `/spaces/${id}/leave`],
      ['delete', `/spaces/${id}/members/${context.users[0].id}`],
      ['post', `/spaces/${id}/ownership`, { userId: context.users[2].id }],
      ['post', `/spaces/${id}/invitations`],
      ['get', `/spaces/${id}/invitations`],
      ['delete', `/spaces/${id}/invitations/${invitation.id}`],
    ];
    for (const [method, path, body] of routes)
      await api(method, path, 2)
        .send(body ?? {})
        .expect(404);
  });
  it('limits ordinary members and refuses orphaning the owner', async () => {
    const { id } = await space();
    await join(id);
    const invitation = await invite(id);
    await api('patch', `/spaces/${id}`, 1).send({ name: 'No' }).expect(403);
    await api('delete', `/spaces/${id}`, 1).expect(403);
    await api('post', `/spaces/${id}/invitations`, 1).expect(403);
    await api('get', `/spaces/${id}/invitations`, 1).expect(403);
    await api('delete', `/spaces/${id}/invitations/${invitation.id}`, 1).expect(
      403,
    );
    await api('post', `/spaces/${id}/ownership`, 1)
      .send({ userId: context.users[0].id })
      .expect(403);
    await api(
      'delete',
      `/spaces/${id}/members/${context.users[0].id}`,
      1,
    ).expect(403);
    await api('post', `/spaces/${id}/leave`).expect(409);
    await api('delete', `/spaces/${id}/members/${context.users[0].id}`).expect(
      409,
    );
    await api('post', `/spaces/${id}/ownership`)
      .send({ userId: context.users[0].id })
      .expect(409);
    await api('post', `/spaces/${id}/ownership`)
      .send({ userId: context.users[2].id })
      .expect(404);
  });
  it('protects the owner when the same ObjectId uses uppercase hex', async () => {
    const { id } = await space();
    const upper = context.users[0].id.toUpperCase();
    await api('delete', `/spaces/${id}/members/${upper}`).expect(409);
    await api('post', `/spaces/${id}/ownership`)
      .send({ userId: upper })
      .expect(409);
    await api('get', `/spaces/${id}`).expect(200);
  });
  it('expires an invitation at the exact boundary and uses a seven-day lifetime', async () => {
    const { id } = await space();
    const fixed = new Date();
    jest.useFakeTimers({
      now: fixed,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'hrtime',
        'performance',
        'queueMicrotask',
      ],
    });
    try {
      const invitation = await invite(id);
      expect(new Date(invitation.expiresAt).getTime() - fixed.getTime()).toBe(
        7 * 24 * 60 * 60 * 1000,
      );
      await context.connection
        .collection('spaceinvitations')
        .updateOne(
          { _id: new Types.ObjectId(invitation.id) },
          { $set: { expiresAt: fixed } },
        );
      await api('post', '/space-invitations/accept', 1)
        .send({ token: invitation.token })
        .expect(400);
      await api('get', `/spaces/${id}`, 1).expect(404);
    } finally {
      jest.useRealTimers();
    }
  });
  it('lets the new owner revoke an inherited invitation and scopes invitation ids to their space', async () => {
    const first = await space();
    const second = await space('organization');
    await join(first.id);
    const pending = await invite(first.id);
    await api(
      'delete',
      `/spaces/${second.id}/invitations/${pending.id}`,
    ).expect(404);
    await api('post', `/spaces/${first.id}/ownership`)
      .send({ userId: context.users[1].id })
      .expect(200);
    await api('delete', `/spaces/${first.id}/invitations/${pending.id}`).expect(
      403,
    );
    await api(
      'delete',
      `/spaces/${first.id}/invitations/${pending.id}`,
      1,
    ).expect(204);
    await api('post', '/space-invitations/accept', 2)
      .send({ token: pending.token })
      .expect(400);
  });
  it('validates space metadata and forbids privilege injection', async () => {
    for (const body of [
      { name: ' ' },
      { name: 'x'.repeat(101) },
      { name: 'Family', type: 'other' },
      { name: 'Family', type: 'family' },
      { name: 'Family', ownerId: context.users[1].id },
      { name: 'Family', description: 'x'.repeat(1001) },
    ]) {
      await api('post', '/spaces').send(body).expect(400);
    }
    const { id } = await space();
    for (const body of [
      {},
      { name: ' ' },
      {},
      { ownerId: context.users[1].id },
      { description: null },
      { deletedAt: new Date().toISOString() },
    ]) {
      await api('patch', `/spaces/${id}`).send(body).expect(400);
    }
    const changed = await api('patch', `/spaces/${id}`)
      .send({ name: ' Renamed ', description: '' })
      .expect(200);
    expect((changed.body as SpaceResponse).name).toBe('Renamed');
    await api('get', '/spaces/not-an-id').expect(400);
    await api('get', '/spaces?unexpected=true').expect(400);
    await api('post', `/spaces/${id}/ownership`)
      .send({ userId: 'bad' })
      .expect(400);
  });
  it('preserves membership history when leaving and rejoining', async () => {
    const { id } = await space();
    await join(id);
    const filter = {
      spaceId: new Types.ObjectId(id),
      userId: new Types.ObjectId(context.users[1].id),
    };
    const before = await context.connection
      .collection('spacememberships')
      .findOne(filter);
    await api('post', `/spaces/${id}/leave`, 1).expect(204);
    await api('get', `/spaces/${id}/members`, 1).expect(404);
    await join(id);
    const after = await context.connection
      .collection('spacememberships')
      .findOne(filter);
    expect(after?._id).toEqual(before?._id);
    expect(after?.status).toBe('active');
    const events = await context.connection
      .collection('spacemembershipevents')
      .find(filter)
      .sort({ occurredAt: 1 })
      .toArray();
    expect(events.map((event) => event.kind as string)).toEqual([
      'joined',
      'left',
      'joined',
    ]);
  });
  it('consumes an invitation once and keeps it unconsumed for existing members', async () => {
    const { id } = await space();
    await join(id);
    const invitation = await invite(id);
    await api('post', '/space-invitations/accept', 1)
      .send({ token: invitation.token })
      .expect(409);
    await api('post', '/space-invitations/accept', 2)
      .send({ token: invitation.token })
      .expect(200);
    const replay = await api('post', '/space-invitations/accept', 3)
      .send({ token: invitation.token })
      .expect(400);
    expect(JSON.stringify(replay.body)).not.toContain(id);
    expect(JSON.stringify(replay.body)).not.toContain(invitation.token);
  });
  it('rejects revoked, expired and deleted-space links without revealing their status', async () => {
    const { id } = await space();
    const revoked = await invite(id);
    const expired = await invite(id);
    const deleted = await invite(id);
    await api('delete', `/spaces/${id}/invitations/${revoked.id}`).expect(204);
    await api('delete', `/spaces/${id}/invitations/${revoked.id}`).expect(409);
    await context.connection
      .collection('spaceinvitations')
      .updateOne(
        { _id: new Types.ObjectId(expired.id) },
        { $set: { expiresAt: new Date(0) } },
      );
    await api('delete', `/spaces/${id}/invitations/${expired.id}`).expect(409);
    const expiredList = await api('get', `/spaces/${id}/invitations`).expect(
      200,
    );
    expect(
      (
        expiredList.body as Page<{
          id: string;
          status: string;
        }>
      ).items.find((item) => item.id === expired.id)?.status,
    ).toBe('expired');
    const errors: unknown[] = [];
    for (const token of [revoked.token, expired.token]) {
      const result = await api('post', '/space-invitations/accept', 1)
        .send({ token })
        .expect(400);
      errors.push(
        (
          result.body as {
            message: unknown;
          }
        ).message,
      );
    }
    await api('delete', `/spaces/${id}`).expect(204);
    const result = await api('post', '/space-invitations/accept', 1)
      .send({ token: deleted.token })
      .expect(400);
    errors.push(
      (
        result.body as {
          message: unknown;
        }
      ).message,
    );
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[1]).toEqual(errors[2]);
  });
  it('never returns token digests or personal credentials and never logs the invitation token', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      const { id } = await space();
      const invitation = await invite(id);
      const listed = await api('get', `/spaces/${id}/invitations`).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(invitation.token);
      expect(JSON.stringify(listed.body)).not.toContain('tokenDigest');
      const stored = await context.connection
        .collection('spaceinvitations')
        .findOne({ _id: new Types.ObjectId(invitation.id) });
      expect(JSON.stringify(stored)).not.toContain(invitation.token);
      expect(stored?.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
      await api('post', '/space-invitations/accept', 1)
        .send({ token: invitation.token })
        .expect(200);
      await api('post', '/space-invitations/accept', 1)
        .send({ token: invitation.token })
        .expect(400);
      const members = await api('get', `/spaces/${id}/members`).expect(200);
      for (const secret of [
        'email',
        'passwordHash',
        'authVersion',
        'description',
      ])
        expect(JSON.stringify(members.body)).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls)).not.toContain(invitation.token);
    } finally {
      log.mockRestore();
    }
  });
  it('counts malformed requests before validation and returns Retry-After at the limit', async () => {
    // Freeze Date only: real Mongo sockets and timers must continue working.
    jest.useFakeTimers({
      now: new Date('2026-09-20T12:00:10Z'),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'hrtime',
        'performance',
        'queueMicrotask',
      ],
    });
    try {
      for (let index = 0; index < 10; index++)
        await api('post', '/space-invitations/accept', 3)
          .send({ wrong: 'field' })
          .expect(400);
      const limited = await api('post', '/space-invitations/accept', 3)
        .send({ token: 'invalid' })
        .expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      jest.setSystemTime(new Date('2026-09-20T12:01:00Z'));
      await api('post', '/space-invitations/accept', 3)
        .send({ wrong: 'field' })
        .expect(400);
    } finally {
      jest.useRealTimers();
    }
  });
  it('does not modify another space finances or reports during deletion', async () => {
    const retained = await space();
    const account = await api('post', `/spaces/${retained.id}/accounts`)
      .send({
        name: 'Retained',
        currency: 'USD',
        amount: 100,
        openedAt: '2024-01-01',
      })
      .expect(201);
    const accountId = (account.body as { _id: string })._id;
    const before = await api(
      'get',
      `/spaces/${retained.id}/reports/years`,
    ).expect(200);
    const deleted = await space();
    await join(deleted.id);
    await api('delete', `/spaces/${deleted.id}`).expect(204);
    const after = await api(
      'get',
      `/spaces/${retained.id}/reports/years`,
    ).expect(200);
    expect(after.body).toEqual(before.body);
    const retainedAccount = await api(
      'get',
      `/spaces/${retained.id}/accounts/${accountId}`,
    ).expect(200);
    expect(retainedAccount.body).toMatchObject({
      amount: 100,
      spaceId: retained.id,
    });
  });
});
