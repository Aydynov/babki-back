import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

type GroupResponse = {
  id: string;
  name: string;
  role: string;
  ownerId: string;
};
type InvitationResponse = { id: string; token: string; expiresAt: string };
type Page<T> = { items: T[]; total: number; page: number; limit: number };

describe('Groups HTTP contracts (real replica set)', () => {
  let context: Awaited<ReturnType<typeof startGroupsTestApp>>;
  beforeAll(async () => {
    context = await startGroupsTestApp();
  }, 60_000);
  beforeEach(async () => {
    for (const name of [
      'groups',
      'groupmemberships',
      'groupmembershipevents',
      'groupinvitations',
      'groupinvitationratelimits',
    ]) {
      await context.connection.collection(name).deleteMany({});
    }
  });
  afterAll(async () => {
    await context?.close();
  }, 30_000);
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
  async function group(type = 'family', user = 0) {
    const response = await api('post', '/groups', user)
      .send({ name: ' Family ', type })
      .expect(201);
    return response.body as GroupResponse;
  }
  async function invite(id: string, owner = 0) {
    const response = await api(
      'post',
      `/groups/${id}/invitations`,
      owner,
    ).expect(201);
    return response.body as InvitationResponse;
  }
  async function join(id: string, user = 1, owner = 0) {
    const invitation = await invite(id, owner);
    await api('post', '/group-invitations/accept', user)
      .send({ token: invitation.token })
      .expect(200);
    return invitation;
  }

  it('creates a group with exactly one owner without exposing internal fields', async () => {
    const response = await api('post', '/groups')
      .send({ name: ' Family ', type: 'family' })
      .expect(201);
    expect(response.body).toEqual({
      id: expect.any(String) as unknown,
      name: 'Family',
      type: 'family',
      ownerId: context.users[0].id,
      role: 'owner',
      createdAt: expect.any(String) as unknown,
      updatedAt: expect.any(String) as unknown,
    });
    const members = await api(
      'get',
      `/groups/${(response.body as GroupResponse).id}/members`,
    ).expect(200);
    expect((members.body as Page<unknown>).items).toEqual([
      {
        userId: context.users[0].id,
        firstName: 'Ada',
        lastName: 'Test',
        role: 'owner',
        joinedAt: expect.any(String) as unknown,
      },
    ]);
  });

  it('keeps a family and two organizations independent through membership lifecycle', async () => {
    const family = await group();
    const orgA = await group('organization');
    const orgB = await group('organization');
    await join(family.id);
    await join(orgA.id);
    await join(orgB.id);
    const list = await api('get', '/groups?page=1&limit=2', 1).expect(200);
    expect((list.body as Page<GroupResponse>).total).toBe(3);
    expect((list.body as Page<GroupResponse>).items).toHaveLength(2);
    await api('post', `/groups/${family.id}/ownership`)
      .send({ userId: context.users[1].id })
      .expect(200);
    await api('patch', `/groups/${family.id}`)
      .send({ name: 'Denied' })
      .expect(403);
    await api('post', `/groups/${family.id}/leave`).expect(204);
    await api('get', `/groups/${family.id}`).expect(404);
    await join(family.id, 0, 1);
    await api(
      'delete',
      `/groups/${orgA.id}/members/${context.users[1].id}`,
    ).expect(204);
    await api('get', `/groups/${orgA.id}`, 1).expect(404);
    await api('get', `/groups/${orgB.id}`, 1).expect(200);
    await api('delete', `/groups/${family.id}`, 1).expect(204);
    await api('get', `/groups/${family.id}`).expect(404);
    const result = await api('get', '/groups', 1).expect(200);
    expect(
      (result.body as Page<GroupResponse>).items.map((item) => item.id),
    ).toEqual([orgB.id]);
  });

  it('requires JWT for every new route', async () => {
    const id = new Types.ObjectId().toString();
    const routes: ['get' | 'post' | 'patch' | 'delete', string][] = [
      ['post', '/groups'],
      ['get', '/groups'],
      ['get', `/groups/${id}`],
      ['patch', `/groups/${id}`],
      ['delete', `/groups/${id}`],
      ['get', `/groups/${id}/members`],
      ['post', `/groups/${id}/leave`],
      ['delete', `/groups/${id}/members/${id}`],
      ['post', `/groups/${id}/ownership`],
      ['post', `/groups/${id}/invitations`],
      ['get', `/groups/${id}/invitations`],
      ['delete', `/groups/${id}/invitations/${id}`],
      ['post', '/group-invitations/accept'],
    ];
    for (const [method, path] of routes)
      await api(method, path, -1).send({}).expect(401);
  });

  it('conceals foreign groups on every group route', async () => {
    const { id } = await group();
    const invitation = await invite(id);
    const routes: ['get' | 'post' | 'patch' | 'delete', string, object?][] = [
      ['get', `/groups/${id}`],
      ['patch', `/groups/${id}`, { name: 'Foreign' }],
      ['delete', `/groups/${id}`],
      ['get', `/groups/${id}/members`],
      ['post', `/groups/${id}/leave`],
      ['delete', `/groups/${id}/members/${context.users[0].id}`],
      ['post', `/groups/${id}/ownership`, { userId: context.users[2].id }],
      ['post', `/groups/${id}/invitations`],
      ['get', `/groups/${id}/invitations`],
      ['delete', `/groups/${id}/invitations/${invitation.id}`],
    ];
    for (const [method, path, body] of routes)
      await api(method, path, 2)
        .send(body ?? {})
        .expect(404);
  });

  it('limits ordinary members and refuses orphaning the owner', async () => {
    const { id } = await group();
    await join(id);
    const invitation = await invite(id);
    await api('patch', `/groups/${id}`, 1).send({ name: 'No' }).expect(403);
    await api('delete', `/groups/${id}`, 1).expect(403);
    await api('post', `/groups/${id}/invitations`, 1).expect(403);
    await api('get', `/groups/${id}/invitations`, 1).expect(403);
    await api('delete', `/groups/${id}/invitations/${invitation.id}`, 1).expect(
      403,
    );
    await api('post', `/groups/${id}/ownership`, 1)
      .send({ userId: context.users[0].id })
      .expect(403);
    await api(
      'delete',
      `/groups/${id}/members/${context.users[0].id}`,
      1,
    ).expect(403);
    await api('post', `/groups/${id}/leave`).expect(409);
    await api('delete', `/groups/${id}/members/${context.users[0].id}`).expect(
      409,
    );
    await api('post', `/groups/${id}/ownership`)
      .send({ userId: context.users[0].id })
      .expect(409);
    await api('post', `/groups/${id}/ownership`)
      .send({ userId: context.users[2].id })
      .expect(404);
  });

  it('protects the owner when the same ObjectId uses uppercase hex', async () => {
    const { id } = await group();
    const upper = context.users[0].id.toUpperCase();
    await api('delete', `/groups/${id}/members/${upper}`).expect(409);
    await api('post', `/groups/${id}/ownership`)
      .send({ userId: upper })
      .expect(409);
    await api('get', `/groups/${id}`).expect(200);
  });

  it('expires an invitation at the exact boundary and uses a seven-day lifetime', async () => {
    const { id } = await group();
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
        .collection('groupinvitations')
        .updateOne(
          { _id: new Types.ObjectId(invitation.id) },
          { $set: { expiresAt: fixed } },
        );
      await api('post', '/group-invitations/accept', 1)
        .send({ token: invitation.token })
        .expect(400);
      await api('get', `/groups/${id}`, 1).expect(404);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets the new owner revoke an inherited invitation and scopes invitation ids to their group', async () => {
    const first = await group();
    const second = await group('organization');
    await join(first.id);
    const pending = await invite(first.id);
    await api(
      'delete',
      `/groups/${second.id}/invitations/${pending.id}`,
    ).expect(404);
    await api('post', `/groups/${first.id}/ownership`)
      .send({ userId: context.users[1].id })
      .expect(200);
    await api('delete', `/groups/${first.id}/invitations/${pending.id}`).expect(
      403,
    );
    await api(
      'delete',
      `/groups/${first.id}/invitations/${pending.id}`,
      1,
    ).expect(204);
    await api('post', '/group-invitations/accept', 2)
      .send({ token: pending.token })
      .expect(400);
  });

  it('validates group metadata and forbids privilege injection', async () => {
    for (const body of [
      { name: ' ', type: 'family' },
      { name: 'x'.repeat(101), type: 'family' },
      { name: 'Family', type: 'other' },
      { name: 'Family' },
      { name: 'Family', type: 'family', ownerId: context.users[1].id },
      { name: 'Family', type: 'family', description: 'x'.repeat(1001) },
    ]) {
      await api('post', '/groups').send(body).expect(400);
    }
    const { id } = await group();
    for (const body of [
      {},
      { name: ' ' },
      { type: 'organization' },
      { ownerId: context.users[1].id },
      { description: null },
      { deletedAt: new Date().toISOString() },
    ]) {
      await api('patch', `/groups/${id}`).send(body).expect(400);
    }
    const changed = await api('patch', `/groups/${id}`)
      .send({ name: ' Renamed ', description: '' })
      .expect(200);
    expect((changed.body as GroupResponse).name).toBe('Renamed');
    await api('get', '/groups/not-an-id').expect(400);
    await api('get', '/groups?unexpected=true').expect(400);
    await api('post', `/groups/${id}/ownership`)
      .send({ userId: 'bad' })
      .expect(400);
  });

  it('preserves membership history when leaving and rejoining', async () => {
    const { id } = await group();
    await join(id);
    const filter = {
      groupId: new Types.ObjectId(id),
      userId: new Types.ObjectId(context.users[1].id),
    };
    const before = await context.connection
      .collection('groupmemberships')
      .findOne(filter);
    await api('post', `/groups/${id}/leave`, 1).expect(204);
    await api('get', `/groups/${id}/members`, 1).expect(404);
    await join(id);
    const after = await context.connection
      .collection('groupmemberships')
      .findOne(filter);
    expect(after?._id).toEqual(before?._id);
    expect(after?.status).toBe('active');
    const events = await context.connection
      .collection('groupmembershipevents')
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
    const { id } = await group();
    await join(id);
    const invitation = await invite(id);
    await api('post', '/group-invitations/accept', 1)
      .send({ token: invitation.token })
      .expect(409);
    await api('post', '/group-invitations/accept', 2)
      .send({ token: invitation.token })
      .expect(200);
    const replay = await api('post', '/group-invitations/accept', 3)
      .send({ token: invitation.token })
      .expect(400);
    expect(JSON.stringify(replay.body)).not.toContain(id);
    expect(JSON.stringify(replay.body)).not.toContain(invitation.token);
  });

  it('rejects revoked, expired and deleted-group links without revealing their status', async () => {
    const { id } = await group();
    const revoked = await invite(id);
    const expired = await invite(id);
    const deleted = await invite(id);
    await api('delete', `/groups/${id}/invitations/${revoked.id}`).expect(204);
    await api('delete', `/groups/${id}/invitations/${revoked.id}`).expect(409);
    await context.connection
      .collection('groupinvitations')
      .updateOne(
        { _id: new Types.ObjectId(expired.id) },
        { $set: { expiresAt: new Date(0) } },
      );
    await api('delete', `/groups/${id}/invitations/${expired.id}`).expect(409);
    const expiredList = await api('get', `/groups/${id}/invitations`).expect(
      200,
    );
    expect(
      (expiredList.body as Page<{ id: string; status: string }>).items.find(
        (item) => item.id === expired.id,
      )?.status,
    ).toBe('expired');
    const errors: unknown[] = [];
    for (const token of [revoked.token, expired.token]) {
      const result = await api('post', '/group-invitations/accept', 1)
        .send({ token })
        .expect(400);
      errors.push((result.body as { message: unknown }).message);
    }
    await api('delete', `/groups/${id}`).expect(204);
    const result = await api('post', '/group-invitations/accept', 1)
      .send({ token: deleted.token })
      .expect(400);
    errors.push((result.body as { message: unknown }).message);
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[1]).toEqual(errors[2]);
  });

  it('never returns token digests or personal credentials and never logs the invitation token', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      const { id } = await group();
      const invitation = await invite(id);
      const listed = await api('get', `/groups/${id}/invitations`).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(invitation.token);
      expect(JSON.stringify(listed.body)).not.toContain('tokenDigest');
      const stored = await context.connection
        .collection('groupinvitations')
        .findOne({ _id: new Types.ObjectId(invitation.id) });
      expect(JSON.stringify(stored)).not.toContain(invitation.token);
      expect(stored?.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
      await api('post', '/group-invitations/accept', 1)
        .send({ token: invitation.token })
        .expect(200);
      await api('post', '/group-invitations/accept', 1)
        .send({ token: invitation.token })
        .expect(400);
      const members = await api('get', `/groups/${id}/members`).expect(200);
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
        await api('post', '/group-invitations/accept', 3)
          .send({ wrong: 'field' })
          .expect(400);
      const limited = await api('post', '/group-invitations/accept', 3)
        .send({ token: 'invalid' })
        .expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      jest.setSystemTime(new Date('2026-09-20T12:01:00Z'));
      await api('post', '/group-invitations/accept', 3)
        .send({ wrong: 'field' })
        .expect(400);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not modify personal finance records or report results', async () => {
    const owner = new Types.ObjectId(context.users[0].id);
    const account = new Types.ObjectId();
    const snapshot = new Types.ObjectId();
    const category = new Types.ObjectId();
    await context.connection.collection('accounts').insertMany([
      { _id: account, userId: owner, type: 'balance' },
      { userId: owner, type: 'saving' },
    ]);
    await context.connection.collection('accountsnapshots').insertOne({
      _id: snapshot,
      userId: owner,
      accountId: account,
      date: new Date('2026-01-01'),
      amount: 90,
    });
    await context.connection.collection('expensecategories').insertOne({
      _id: category,
      userId: owner,
      name: 'Food',
      isArchived: false,
    });
    await context.connection.collection('transactions').insertOne({
      userId: owner,
      accountId: account,
      snapshotId: snapshot,
      category,
      type: 'expense',
      amount: 10,
      transactionDate: new Date('2026-01-02'),
      items: [],
    });
    const names = [
      'accounts',
      'accountsnapshots',
      'expensecategories',
      'transactions',
    ];
    const before = await Promise.all(
      names.map((name) =>
        context.connection.collection(name).find({ userId: owner }).toArray(),
      ),
    );
    const reportBefore = await api('get', '/reports/years').expect(200);
    const { id } = await group();
    await join(id);
    await api('delete', `/groups/${id}`).expect(204);
    const after = await Promise.all(
      names.map((name) =>
        context.connection.collection(name).find({ userId: owner }).toArray(),
      ),
    );
    expect(after).toEqual(before);
    const reportAfter = await api('get', '/reports/years').expect(200);
    expect(reportAfter.body).toEqual(reportBefore.body);
  });
});
