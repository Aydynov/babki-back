import request from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal and group finance compatibility', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(fixture.users[0].token, { type: 'bearer' });
  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await fixture?.close();
  });
  it('keeps personal HTTP results isolated while group finances coexist', async () => {
    const balance = await api('post', '/accounts')
      .send({
        name: 'Main account',
        type: 'balance',
        currency: 'USD',
        amount: 1000,
      })
      .expect(201);
    const saving = await api('post', '/accounts')
      .send({
        name: 'Savings',
        type: 'saving',
        currency: 'USD',
        amount: 0,
      })
      .expect(201);
    const balanceId = (balance.body as { _id: string })._id;
    const savingId = (saving.body as { _id: string })._id;
    const categories = await api('post', '/expense-categories')
      .send({ name: 'Food' })
      .expect(201);
    const categoryId = (categories.body as { _id: string })._id;
    const date = new Date().toISOString();
    const created = await api('post', '/expenses')
      .send({
        accountId: balanceId,
        categoryId,
        amount: 100,
        transactionDate: date,
      })
      .expect(201);
    const expenseId = (created.body as { _id: string })._id;
    await api('patch', `/expenses/${expenseId}`)
      .send({ amount: 150 })
      .expect(200);
    const account = (await api('get', `/accounts/${balanceId}`).expect(200))
      .body as { _id: string; amount: number };
    expect(account.amount).toBe(850);
    const paths = [
      '/accounts',
      '/expenses',
      '/incomes',
      '/transfers',
      '/reports/years',
      '/expense-categories',
    ];
    const baseline = new Map<string, unknown>();
    for (const path of paths)
      baseline.set(path, (await api('get', path).expect(200)).body as unknown);
    const group = await api('post', '/groups')
      .send({ name: 'Compatibility group', type: 'organization' })
      .expect(201);
    const groupId = (group.body as { id: string }).id;
    const wallet = await api('post', `/groups/${groupId}/accounts`)
      .send({ amount: 500, openedAt: date })
      .expect(201);
    const groupAccountId = (wallet.body as { _id: string })._id;
    const groupCategory = await api(
      'post',
      `/groups/${groupId}/expense-categories`,
    )
      .send({ name: 'Group only' })
      .expect(201);
    await api('post', `/groups/${groupId}/expenses`)
      .send({
        accountId: groupAccountId,
        categoryId: (groupCategory.body as { _id: string })._id,
        amount: 75,
        transactionDate: date,
      })
      .expect(201);
    for (const path of paths)
      expect((await api('get', path).expect(200)).body).toEqual(
        baseline.get(path),
      );
    const transfer = await api('post', '/transfers')
      .send({
        sourceAccountId: balanceId,
        destinationAccountId: savingId,
        sourceAmount: 50,
        destinationAmount: 50,
        transactionDate: date,
      })
      .expect(201);
    expect(
      ((await api('get', `/accounts/${balanceId}`)).body as { amount: number })
        .amount,
    ).toBe(800);
    expect(
      ((await api('get', `/accounts/${savingId}`)).body as { amount: number })
        .amount,
    ).toBe(50);
    const saved = transfer.body as { _id: string };
    await api('delete', `/transfers/${saved._id}`).expect(204);
    expect(
      ((await api('get', `/accounts/${balanceId}`)).body as { amount: number })
        .amount,
    ).toBe(850);
    expect(
      ((await api('get', `/accounts/${savingId}`)).body as { amount: number })
        .amount,
    ).toBe(0);
  });
});
