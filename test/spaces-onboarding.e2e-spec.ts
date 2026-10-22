import request from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';

describe('Space onboarding contract', () => {
  let context: Awaited<ReturnType<typeof startSpacesTestApp>>;
  beforeAll(async () => {
    context = await startSpacesTestApp();
  }, 60_000);
  afterAll(async () => context?.close());

  it('registers without currency and starts with no financial defaults or spaces', async () => {
    const server = context.app.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        firstName: 'New',
        lastName: 'User',
        email: 'new@spaces.example',
        password: 'test-only-correct-horse-battery',
      })
      .expect(201);
    const body = response.body as {
      accessToken: string;
      user: Record<string, unknown>;
    };
    expect(body.user).not.toHaveProperty('defaultCurrency');
    expect(body.user).not.toHaveProperty('defaultAccountId');
    const spaces = await request(server)
      .get('/api/v1/spaces')
      .auth(body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(spaces.body).toMatchObject({ items: [], total: 0 });
  });

  it('creates an empty untyped space and rejects the former group route', async () => {
    const server = context.app.getHttpServer() as Parameters<typeof request>[0];
    const token = context.users[0].token;
    const created = await request(server)
      .post('/api/v1/spaces')
      .auth(token, { type: 'bearer' })
      .send({ name: 'My finances' })
      .expect(201);
    const space = created.body as { id: string };
    expect(space).not.toHaveProperty('type');
    const accounts = await request(server)
      .get(`/api/v1/spaces/${space.id}/accounts`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(accounts.body).toEqual([]);
    await request(server)
      .post('/api/v1/spaces')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Invalid', type: 'family' })
      .expect(400);
    await request(server)
      .get('/api/v1/groups')
      .auth(token, { type: 'bearer' })
      .expect(404);
  });

  it('joins without creating a space and keeps the account after leaving its last space', async () => {
    const server = context.app.getHttpServer() as Parameters<typeof request>[0];
    const owner = context.users[0].token;
    const member = context.users[1].token;
    const created = await request(server)
      .post('/api/v1/spaces')
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Invitation destination' })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const invitation = await request(server)
      .post(`/api/v1/spaces/${id}/invitations`)
      .auth(owner, { type: 'bearer' })
      .expect(201);
    await request(server)
      .post('/api/v1/space-invitations/accept')
      .auth(member, { type: 'bearer' })
      .send({ token: (invitation.body as { token: string }).token })
      .expect(200);
    const joined = await request(server)
      .get('/api/v1/spaces')
      .auth(member, { type: 'bearer' })
      .expect(200);
    expect(joined.body).toMatchObject({ total: 1, items: [{ id }] });
    await request(server)
      .post(`/api/v1/spaces/${id}/leave`)
      .auth(member, { type: 'bearer' })
      .expect(204);
    const empty = await request(server)
      .get('/api/v1/spaces')
      .auth(member, { type: 'bearer' })
      .expect(200);
    expect(empty.body).toMatchObject({ total: 0, items: [] });
    await request(server)
      .get('/api/v1/users/me')
      .auth(member, { type: 'bearer' })
      .expect(200);
    for (const path of [
      'accounts',
      'incomes',
      'expenses',
      'transfers',
      'transactions',
      'expense-categories',
      'expense-limits',
      'plans',
      'debts',
      'reports/years',
      'groups',
      'group-invitations/preview',
    ]) {
      await request(server)
        .get(`/api/v1/${path}`)
        .auth(member, { type: 'bearer' })
        .expect(404);
    }
  });
});
