import { ExecutionContext, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { GroupInvitationRateLimitGuard } from '../src/modules/groups/group-invitation-rate-limit.guard';
import { Group } from '../src/modules/groups/schemas/group.schema';
import { GroupInvitationRateLimit } from '../src/modules/groups/schemas/group-invitation-rate-limit.schema';
import { startGroupsTestApp } from './helpers/groups-test-app';

type Invitation = { id: string; token: string; expiresAt: string };
describe('Invitation preview HTTP contract (real replica set)', () => {
  let context: Awaited<ReturnType<typeof startGroupsTestApp>>;
  beforeAll(async () => {
    context = await startGroupsTestApp();
  });
  beforeEach(async () => {
    for (const name of [
      'groups',
      'groupmemberships',
      'groupmembershipevents',
      'groupinvitations',
      'groupinvitationratelimits',
    ])
      await context.connection.collection(name).deleteMany({});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await context?.close();
  });
  function api(path: string, user = 1) {
    const call = request(
      context.app.getHttpServer() as Parameters<typeof request>[0],
    ).post(`/api/v1${path}`);
    return user < 0
      ? call
      : call.auth(context.users[user].token, { type: 'bearer' });
  }
  async function fixture(type = 'family') {
    const created = await api('/groups', 0)
      .send({ name: 'Shared budget', type })
      .expect(201);
    const groupId = (created.body as { id: string }).id;
    const invitation = await api(`/groups/${groupId}/invitations`, 0).expect(
      201,
    );
    return { groupId, ...(invitation.body as Invitation) };
  }
  const preview = (token: string, user = 1) =>
    api('/group-invitations/preview', user).send({ token });
  const accept = (token: string, user = 1) =>
    api('/group-invitations/accept', user).send({ token });

  it.each(['family', 'organization'])(
    'returns only current %s name/type and invitation expiry without joining',
    async (type) => {
      const invitation = await fixture(type);
      const result = await preview(invitation.token).expect(200);
      expect(result.body).toEqual({
        name: 'Shared budget',
        type,
        expiresAt: invitation.expiresAt,
      });
      expect(result.headers['cache-control']).toBe('no-store');
      await request(
        context.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${invitation.groupId}`)
        .auth(context.users[1].token, { type: 'bearer' })
        .expect(404);
      await request(
        context.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .patch(`/api/v1/groups/${invitation.groupId}`)
        .auth(context.users[0].token, { type: 'bearer' })
        .send({ name: 'Renamed' })
        .expect(200);
      expect((await preview(invitation.token).expect(200)).body).toEqual({
        name: 'Renamed',
        type,
        expiresAt: invitation.expiresAt,
      });
      await preview(invitation.token, 0).expect(200);
      await accept(invitation.token, 0).expect(409);
      await accept(invitation.token).expect(200);
      const next = await api(
        `/groups/${invitation.groupId}/invitations`,
        0,
      ).expect(201);
      await preview((next.body as Invitation).token).expect(200);
      await accept((next.body as Invitation).token).expect(409);
      await accept((next.body as Invitation).token, 2).expect(200);
    },
  );

  it('requires JWT before spending a personal quota', async () => {
    const invitation = await fixture();
    await preview(invitation.token, -1).expect(401);
    await api('/group-invitations/preview', -1).send({}).expect(401);
    expect(
      await context.connection
        .collection('groupinvitationratelimits')
        .countDocuments(),
    ).toBe(0);
  });

  it.each([
    {},
    { token: null },
    { token: 1 },
    { token: [] },
    { token: {} },
    { token: '' },
    { token: 'a'.repeat(42) },
    { token: 'a'.repeat(44) },
    { token: '+'.repeat(43) },
    { token: 'a'.repeat(43), extra: 'forbidden' },
    { token: { nested: 'a'.repeat(43) } },
  ])('rejects invalid preview body %j', async (body) => {
    await api('/group-invitations/preview').send(body).expect(400);
    expect(
      await context.connection.collection('groupmemberships').countDocuments(),
    ).toBe(0);
    expect(
      await context.connection
        .collection('groupinvitationratelimits')
        .findOne(),
    ).toMatchObject({ count: 1 });
  });

  it('rejects query fields even with a valid body token', async () => {
    const invitation = await fixture();
    await api('/group-invitations/preview?anything=value')
      .send({ token: invitation.token })
      .expect(400);
    await preview(invitation.token).expect(200);
    expect(
      await context.connection
        .collection('groupinvitations')
        .findOne({ _id: new Types.ObjectId(invitation.id) }),
    ).toMatchObject({ status: 'pending' });
  });

  it('returns the same unavailable error for every token state', async () => {
    const unknown = 'z'.repeat(43);
    const used = await fixture();
    await accept(used.token, 2).expect(200);
    const revoked = await fixture();
    await request(context.app.getHttpServer() as Parameters<typeof request>[0])
      .delete(`/api/v1/groups/${revoked.groupId}/invitations/${revoked.id}`)
      .auth(context.users[0].token, { type: 'bearer' })
      .expect(204);
    const expired = await fixture();
    await context.connection
      .collection('groupinvitations')
      .updateOne(
        { _id: new Types.ObjectId(expired.id) },
        { $set: { expiresAt: new Date(0) } },
      );
    const deleted = await fixture();
    await request(context.app.getHttpServer() as Parameters<typeof request>[0])
      .delete(`/api/v1/groups/${deleted.groupId}`)
      .auth(context.users[0].token, { type: 'bearer' })
      .expect(204);
    const errors: unknown[] = [];
    for (const token of [
      unknown,
      used.token,
      revoked.token,
      expired.token,
      deleted.token,
    ]) {
      const result = await preview(token).expect(400);
      const { statusCode, message, error } = result.body as Record<
        string,
        unknown
      >;
      errors.push({ statusCode, message, error });
      expect(message).toBe('Invalid invitation');
      for (const value of [
        token,
        used.groupId,
        revoked.groupId,
        expired.groupId,
        deleted.groupId,
      ])
        expect(JSON.stringify(result.body)).not.toContain(value);
    }
    expect(
      errors.every(
        (error) => JSON.stringify(error) === JSON.stringify(errors[0]),
      ),
    ).toBe(true);
  });

  it('expires at the exact boundary without extending the invitation', async () => {
    const invitation = await fixture();
    const boundary = new Date(Date.now() + 60000);
    await context.connection
      .collection('groupinvitations')
      .updateOne(
        { _id: new Types.ObjectId(invitation.id) },
        { $set: { expiresAt: boundary } },
      );
    jest.useFakeTimers({
      now: new Date(boundary.getTime() - 1),
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
      expect((await preview(invitation.token).expect(200)).body).toHaveProperty(
        'expiresAt',
        boundary.toISOString(),
      );
      jest.setSystemTime(boundary);
      await preview(invitation.token).expect(400);
      await accept(invitation.token).expect(400);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares the ten-attempt quota across preview and accept', async () => {
    const invitation = await fixture();
    for (let i = 0; i < 9; i++) await preview(invitation.token).expect(200);
    await accept(invitation.token).expect(200);
    for (const path of ['preview', 'accept']) {
      const result = await api(`/group-invitations/${path}`)
        .send({ token: invitation.token })
        .expect(429);
      expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
    }
    const other = await fixture();
    await preview(other.token, 2).expect(200);
  });

  it('counts malformed previews and resets at the next minute', async () => {
    const fixed = new Date();
    fixed.setUTCSeconds(10, 0);
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
      for (let i = 0; i < 10; i++)
        await api('/group-invitations/preview').send({}).expect(400);
      await api('/group-invitations/accept').send({}).expect(429);
      jest.setSystemTime(new Date(fixed.getTime() + 60000));
      await api('/group-invitations/preview').send({}).expect(400);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares a real counter between two guard instances', async () => {
    const model = context.app.get<Model<GroupInvitationRateLimit>>(
      getModelToken(GroupInvitationRateLimit.name),
    );
    const guards = [
      new GroupInvitationRateLimitGuard(model),
      new GroupInvitationRateLimitGuard(model),
    ];
    const header = jest.fn();
    const execution = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: context.users[1].id } }),
        getResponse: () => ({ setHeader: header }),
      }),
    } as unknown as ExecutionContext;
    for (let i = 0; i < 10; i++)
      await expect(guards[i % 2].canActivate(execution)).resolves.toBe(true);
    await expect(guards[0].canActivate(execution)).rejects.toMatchObject({
      status: 429,
    });
    expect(header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('fails closed on counter and group read failures without leaking secrets', async () => {
    const invitation = await fixture();
    const limits = context.app.get<Model<GroupInvitationRateLimit>>(
      getModelToken(GroupInvitationRateLimit.name),
    );
    const counter = jest
      .spyOn(limits, 'findOneAndUpdate')
      .mockImplementationOnce(() => {
        throw new Error(invitation.token);
      });
    const unavailable = await preview(invitation.token).expect(503);
    expect(JSON.stringify(unavailable.body)).not.toContain(invitation.token);
    counter.mockRestore();
    const groups = context.app.get<Model<Group>>(getModelToken(Group.name));
    jest.spyOn(groups, 'findOne').mockImplementationOnce(() => {
      throw new Error(invitation.token);
    });
    const failed = await preview(invitation.token).expect(503);
    expect(JSON.stringify(failed.body)).not.toContain(invitation.token);
    expect(
      await context.connection
        .collection('groupinvitations')
        .findOne({ _id: new Types.ObjectId(invitation.id) }),
    ).toMatchObject({ status: 'pending' });
  });

  it('keeps body and query secrets out of logs and complete error responses', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const invitation = await fixture();
    const digest = createHash('sha256').update(invitation.token).digest('hex');
    for (const route of ['preview', 'accept']) {
      for (const user of [-1, 1]) {
        for (const body of [{}, { token: invitation.token }]) {
          const result = await api(
            `/group-invitations/${route}?token=${invitation.token}`,
            user,
          ).send(body);
          expect([200, 400, 401]).toContain(result.status);
          expect(JSON.stringify(result.body)).not.toContain(invitation.token);
          expect(JSON.stringify(result.body)).not.toContain(digest);
        }
      }
    }
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain(invitation.token);
    expect(serialized).not.toContain(digest);
  });

  it('does not reflect a token used as an unknown field name', async () => {
    const invitation = await fixture();
    for (const route of ['preview', 'accept']) {
      for (const query of [true, false]) {
        const result = await api(
          `/group-invitations/${route}${query ? `?${invitation.token}=value` : ''}`,
        )
          .send(
            query
              ? {}
              : { token: invitation.token, [invitation.token]: 'value' },
          )
          .expect(400);
        expect(JSON.stringify(result.body)).not.toContain(invitation.token);
      }
    }
  });

  it('does not reflect secrets in validation, quota or storage failures', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const invitation = await fixture();
    const digest = createHash('sha256').update(invitation.token).digest('hex');
    for (const body of [
      { token: { nested: invitation.token } },
      { token: invitation.token, extra: { token: invitation.token, digest } },
    ]) {
      const result = await api('/group-invitations/preview')
        .send(body)
        .expect(400);
      expect(JSON.stringify(result.body)).not.toContain(invitation.token);
      expect(JSON.stringify(result.body)).not.toContain(digest);
    }
    for (let i = 0; i < 8; i++)
      await api('/group-invitations/preview').send({}).expect(400);
    const limited = await api(
      `/group-invitations/preview?token=${invitation.token}`,
    )
      .send({ token: invitation.token })
      .expect(429);
    expect(JSON.stringify(limited.body)).not.toContain(invitation.token);
    const limits = context.app.get<Model<GroupInvitationRateLimit>>(
      getModelToken(GroupInvitationRateLimit.name),
    );
    jest.spyOn(limits, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error(invitation.token);
    });
    const unavailable = await api(
      `/group-invitations/preview?token=${invitation.token}`,
    )
      .send({ token: invitation.token })
      .expect(503);
    expect(JSON.stringify(unavailable.body)).not.toContain(invitation.token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(invitation.token);
  });
});
