import { GroupsAccessService } from '../src/modules/groups/groups-access.service';
import { Types } from 'mongoose';
import request from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

const none = {
  manageAccounts: false,
  manageCategories: false,
  manageLimits: false,
};
const all = {
  manageAccounts: true,
  manageCategories: true,
  manageLimits: true,
};
describe('Group financial permissions', () => {
  let ctx: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let id: string;
  beforeAll(async () => {
    ctx = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  });
  function api(
    method: 'post' | 'patch' | 'get' | 'delete',
    path: string,
    user = 0,
  ) {
    return request(ctx.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${ctx.users[user].token}`);
  }
  async function join(user = 1, owner = 0) {
    const invite = await api('post', `/groups/${id}/invitations`, owner).expect(
      201,
    );
    await api('post', '/group-invitations/accept', user)
      .send({ token: (invite.body as { token: string }).token })
      .expect(200);
  }
  beforeEach(async () => {
    await ctx.connection.collection('groupinvitationratelimits').deleteMany({});
    const group = await api('post', '/groups')
      .send({ name: 'Permissions', type: 'family' })
      .expect(201);
    id = (group.body as { id: string }).id;
    await join();
  });
  function patch(body: unknown, actor = 0, target = 1) {
    return api(
      'patch',
      `/groups/${id}/members/${ctx.users[target].id}/permissions`,
      actor,
    ).send(body as object);
  }
  it('delegates independently, preserves omitted rights, audits and exposes effective permissions', async () => {
    expect((await patch({ manageCategories: true }).expect(200)).body).toEqual({
      ...none,
      manageCategories: true,
    });
    expect((await patch({ manageLimits: true }).expect(200)).body).toEqual({
      ...none,
      manageCategories: true,
      manageLimits: true,
    });
    expect((await patch({ manageCategories: false }).expect(200)).body).toEqual(
      { ...none, manageLimits: true },
    );
    const members = (await api('get', `/groups/${id}/members`, 1).expect(200))
      .body as { items: { userId: string; permissions: unknown }[] };
    expect(
      members.items.find((m) => m.userId === ctx.users[0].id)?.permissions,
    ).toEqual(all);
    expect(
      members.items.find((m) => m.userId === ctx.users[1].id)?.permissions,
    ).toEqual({ ...none, manageLimits: true });
    const events = await ctx.connection
      .collection('groupmembershipevents')
      .find({ groupId: new Types.ObjectId(id), kind: 'permissions-updated' })
      .toArray();
    expect(events).toHaveLength(3);
    expect(events[0].before).toEqual(none);
    expect(events[0].after).toEqual({ ...none, manageCategories: true });
    expect(String(events[0].targetUserId)).toBe(ctx.users[1].id);
  });
  it('checks current permission values independently using the same identity', async () => {
    const access = ctx.app.get(GroupsAccessService);
    const userId = ctx.users[1].id;
    await expect(
      access.requirePermission(id, userId, 'manageCategories'),
    ).rejects.toMatchObject({ status: 403 });
    await patch({ manageCategories: true }).expect(200);
    await expect(
      access.requirePermission(id, userId, 'manageCategories'),
    ).resolves.toBeDefined();
    await expect(
      access.requirePermission(id, userId, 'manageAccounts'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.requirePermission(id, userId, 'manageLimits'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.requirePermission(
        id,
        ctx.users[0].id.toUpperCase(),
        'manageAccounts',
      ),
    ).resolves.toBeDefined();
    await patch({ manageCategories: false }).expect(200);
    await expect(
      access.requirePermission(id, userId, 'manageCategories'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.requirePermission(id, ctx.users[2].id, 'manageCategories'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects invalid patches, privilege escalation, owners and unavailable members', async () => {
    for (const body of [
      {},
      { manageAccounts: null },
      { manageAccounts: 'false' },
      { manageAccounts: 1 },
      { unknown: true },
    ])
      await patch(body).expect(400);
    await patch({ manageAccounts: true }, 1).expect(403);
    await patch({ manageAccounts: true }, 0, 0).expect(409);
    await patch({ manageAccounts: true }, 0, 2).expect(404);
    await patch({ manageAccounts: true }, 2).expect(404);
  });
  it('resets rights after removal, rejoin, leaving and ownership transfer', async () => {
    await patch(all).expect(200);
    await api('delete', `/groups/${id}/members/${ctx.users[1].id}`).expect(204);
    await join();
    expect((await patch({ manageLimits: false }).expect(200)).body).toEqual(
      none,
    );
    await patch(all).expect(200);
    await api('post', `/groups/${id}/leave`, 1).expect(204);
    await join();
    expect((await patch({ manageLimits: false }).expect(200)).body).toEqual(
      none,
    );
    await patch(all).expect(200);
    await join(2);
    await patch({ manageAccounts: true }, 0, 2).expect(200);
    await api('post', `/groups/${id}/ownership`)
      .send({ userId: ctx.users[1].id })
      .expect(200);
    const access = ctx.app.get(GroupsAccessService);
    await expect(
      access.requirePermission(id, ctx.users[0].id, 'manageAccounts'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.requirePermission(id, ctx.users[1].id, 'manageLimits'),
    ).resolves.toBeDefined();
    await expect(
      access.requirePermission(id, ctx.users[2].id, 'manageAccounts'),
    ).resolves.toBeDefined();
    await api('post', `/groups/${id}/ownership`, 1)
      .send({ userId: ctx.users[0].id })
      .expect(200);
    expect((await patch({ manageLimits: false }).expect(200)).body).toEqual(
      none,
    );
  });
});
