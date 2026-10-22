import {
  createIsolatedSpaces,
  isolatedFinancialPath,
} from './helpers/isolated-spaces';
let isolatedSpaceIds: string[];
import request from 'supertest';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Space finances HTTP', () => {
  let fixture: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let space: string;
  let account: string;
  let category: string;
  let expense: string;
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${isolatedFinancialPath(isolatedSpaceIds[user], path)}`)
      .auth(fixture.users[user].token, { type: 'bearer' });
  beforeAll(async () => {
    fixture = await startSpacesTestApp();
    isolatedSpaceIds = await createIsolatedSpaces(fixture);
  }, 60000);
  afterAll(async () => {
    await fixture?.close();
  });
  it('creates a space wallet and independent category', async () => {
    const g = await call('post', '/spaces')
      .send({ name: 'Family' })
      .expect(201);
    space =
      (
        g.body as {
          _id: string;
          id: string;
        }
      ).id ??
      (
        g.body as {
          _id: string;
        }
      )._id;
    const a = await call('post', `/spaces/${space}/accounts`)
      .send({
        name: 'Family',
        currency: 'USD',
        amount: 1000,
        openedAt: '2024-01-01T00:00:00.000Z',
      })
      .expect(201);
    account = (
      a.body as {
        _id: string;
      }
    )._id;
    const c = await call('post', `/spaces/${space}/expense-categories`)
      .send({ name: 'Food' })
      .expect(201);
    category = (
      c.body as {
        _id: string;
      }
    )._id;
    await call('post', `/spaces/${space}/accounts`)
      .send({ name: 'Family', currency: 'USD' })
      .expect(201);
  });
  it('attributes expenses to another member while recording the author', async () => {
    const invite = await call('post', `/spaces/${space}/invitations`)
      .send({})
      .expect(201);
    await call('post', '/space-invitations/accept', 1)
      .send({
        token: (
          invite.body as {
            token: string;
          }
        ).token,
      })
      .expect(200);
    const res = await call('post', `/spaces/${space}/expenses`)
      .send({
        accountId: account,
        categoryId: category,
        participantId: fixture.users[1].id,
        amount: 100,
        transactionDate: '2024-02-10T00:00:00Z',
      })
      .expect(201);
    const body = res.body as {
      _id: string;
      createdBy: string;
      participantId: string;
    };
    expense = body._id;
    expect(body.createdBy).toBe(fixture.users[0].id);
    expect(body.participantId).toBe(fixture.users[1].id);
    const a = await call(
      'get',
      `/spaces/${space}/accounts/${account}`,
      1,
    ).expect(200);
    expect(
      (
        a.body as {
          amount: number;
        }
      ).amount,
    ).toBe(900);
  });
  it('lets the attributed member edit but prevents setting delegation escalation', async () => {
    await call('patch', `/spaces/${space}/expenses/${expense}`, 1)
      .send({ amount: 150 })
      .expect(200);
    const a = await call('get', `/spaces/${space}/accounts/${account}`).expect(
      200,
    );
    expect(
      (
        a.body as {
          amount: number;
        }
      ).amount,
    ).toBe(850);
    await call('post', `/spaces/${space}/expense-categories`, 1)
      .send({ name: 'Other' })
      .expect(403);
    await call('patch', `/spaces/${space}/expenses/${expense}`, 1)
      .send({ participantId: fixture.users[0].id })
      .expect(403);
  });
  it('retains historical participant filtering after leaving and isolates another space history', async () => {
    await call('post', `/spaces/${space}/leave`, 1).send({}).expect(204);
    await call('get', `/spaces/${space}/expenses/${expense}`, 1).expect(404);
    const list = await call(
      'get',
      `/spaces/${space}/expenses?participantId=${fixture.users[1].id}`,
    ).expect(200);
    expect(
      (
        list.body as {
          total: number;
        }
      ).total,
    ).toBe(1);
    await call('post', '/accounts')
      .send({
        openedAt: '2024-01-01',
        name: 'Personal balance',
        type: 'balance',
        currency: 'USD',
        amount: 0,
      })
      .expect(201);
    const control = await call('get', '/expenses').expect(200);
    expect(
      (
        control.body as {
          items: {
            _id: string;
          }[];
        }
      ).items.some((x) => x._id === expense),
    ).toBe(false);
    await call('post', `/spaces/${space}/expenses`)
      .send({
        accountId: account,
        categoryId: category,
        participantId: fixture.users[1].id,
        amount: 1,
        transactionDate: '2024-02-10T00:00:00Z',
      })
      .expect(404);
  });
  it('reports the full budget and reverses a deletion only once', async () => {
    const report = await call(
      'get',
      `/spaces/${space}/reports/months?fromDate=2024-02-01&toDate=2024-02-29`,
    ).expect(200);
    expect(report.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currencies: [
            expect.objectContaining({
              currency: 'USD',
              expenses: 150,
              balance: 850,
            }),
          ],
        }),
      ]),
    );
    await call('delete', `/spaces/${space}/expenses/${expense}`).expect(204);
    await call('delete', `/spaces/${space}/expenses/${expense}`).expect(404);
    expect(
      (await call('get', `/spaces/${space}/expenses`).expect(200)).body,
    ).toMatchObject({ total: 0, items: [] });
    const reportAfter = await call(
      'get',
      `/spaces/${space}/reports/months?fromDate=2024-02-01&toDate=2024-02-29`,
    ).expect(200);
    expect(reportAfter.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currencies: [
            expect.objectContaining({ currency: 'USD', expenses: 0 }),
          ],
        }),
      ]),
    );
    const a = await call('get', `/spaces/${space}/accounts/${account}`).expect(
      200,
    );
    expect(
      (
        a.body as {
          amount: number;
        }
      ).amount,
    ).toBe(1000);
    await call('delete', `/spaces/${space}/accounts/${account}`).expect(409);
    await call(
      'delete',
      `/spaces/${space}/expense-categories/${category}`,
    ).expect(409);
  });
});
