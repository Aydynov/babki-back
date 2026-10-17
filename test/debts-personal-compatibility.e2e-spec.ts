import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal debts compatibility (temporary replica set)', () => {
  let h: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const id = (r: Response) => (r.body as { _id: string })._id;
  const date = '2026-09-21T00:00:00.000Z';
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) => {
    const call = request(h.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(h.users[0].token, { type: 'bearer' });
    return body ? call.send(body) : call;
  };
  const create = (body: object = {}) =>
    api('post', '/debts', {
      debtor: 'Borrower',
      currency: 'USD',
      principalAmount: 100,
      remainingAmount: 70,
      ...body,
    });
  beforeAll(async () => {
    h = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  }, 30000);

  it('retains manual amounts/status, empty PATCH, nullable metadata and legacy response shape', async () => {
    const r = await create({
      status: 'closed',
      description: null,
      dueDate: null,
    }).expect(201);
    const debtId = id(r);
    expect(r.body).toMatchObject({
      principalAmount: 100,
      remainingAmount: 70,
      status: 'closed',
      description: null,
      dueDate: null,
    });
    for (const key of ['ownerType', 'ownerId', 'createdBy'])
      expect(r.body).not.toHaveProperty(key);
    await api('patch', `/debts/${debtId}`, {}).expect(200);
    const changed = await api('patch', `/debts/${debtId}`, {
      principalAmount: 150,
      status: 'active',
      description: '',
      dueDate: null,
    }).expect(200);
    expect(changed.body).toMatchObject({
      principalAmount: 150,
      remainingAmount: 70,
      status: 'active',
      description: '',
      dueDate: null,
    });
    await api('delete', `/debts/${debtId}`).expect(204);
    await api('get', `/debts/${debtId}`).expect(404);
    await create({
      principalAmount: 0.001,
      remainingAmount: 0.001,
      currency: 'KWD',
    }).expect(400);
  });

  it('retains archived PATCH null, hidden details, readable history and both repayment modes', async () => {
    const debtId = id(await create().expect(201));
    const accountId = id(
      await api('post', '/accounts', {
        name: 'Compatibility',
        type: 'balance',
        currency: 'USD',
        amount: 0,
      }).expect(201),
    );
    const repaid = await api('post', `/debts/${debtId}/repayments`, {
      amount: 10,
      repaymentDate: date,
    }).expect(201);
    expect(repaid.body).toMatchObject({ remainingAmount: 60 });
    expect(repaid.body).not.toHaveProperty('repayment');
    await api('post', `/debts/${debtId}/repayments`, {
      amount: 20,
      repaymentDate: date,
      accountId,
      isIncome: true,
    }).expect(201);
    const income = await h.connection
      .collection('transactions')
      .findOne({ 'origin.id': new Types.ObjectId(debtId) });
    expect(income).toMatchObject({
      source: 'Погашение долга Borrower',
      amount: 20,
      currency: 'USD',
      origin: { type: 'debt' },
    });
    const history = await api('get', `/debts/${debtId}/transactions`).expect(
      200,
    );
    expect(history.body).toMatchObject({ total: 2 });
    for (const row of (history.body as { items: object[] }).items)
      for (const key of [
        'ownerType',
        'ownerId',
        'createdBy',
        'isIncome',
        'incomeId',
        'cancelledAt',
        'cancelledBy',
      ])
        expect(row).not.toHaveProperty(key);
    await api('delete', `/debts/${debtId}`).expect(409);
    await api('post', `/debts/${debtId}/archive`).expect(204);
    await api('get', `/debts/${debtId}`).expect(404);
    expect((await api('patch', `/debts/${debtId}`, {}).expect(200)).text).toBe(
      '',
    );
    await api('get', `/debts/${debtId}/transactions`).expect(200);
    await api('post', `/debts/${debtId}/archive`).expect(404);
    await api('patch', `/incomes/${String(income?._id)}`, {
      amount: 15,
    }).expect(200);
    const stored = await h.connection
      .collection('debts')
      .findOne({ _id: new Types.ObjectId(debtId) });
    expect(stored?.remainingAmount).toBe(40);
    await api('delete', `/transactions/${String(income?._id)}`).expect(204);
  });
  it('rejects currency/precision/closed/overpayment without history and carries cash into later snapshots', async () => {
    const debtId = id(await create().expect(201));
    const accountId = id(
      await api('post', '/accounts', {
        name: 'Snapshot compatibility',
        type: 'balance',
        currency: 'USD',
        amount: 0,
      }).expect(201),
    );
    const foreignCurrency = id(
      await api('post', '/accounts', {
        name: 'EUR compatibility',
        type: 'balance',
        currency: 'EUR',
        amount: 0,
      }).expect(201),
    );
    await h.connection.collection('accountsnapshots').insertOne({
      accountId: new Types.ObjectId(accountId),
      date: new Date('2027-01-31T23:59:59.999Z'),
      amount: 0,
    });
    const repayment = {
      amount: 20,
      repaymentDate: date,
      isIncome: true,
      accountId,
    };
    await api('post', `/debts/${debtId}/repayments`, {
      ...repayment,
      accountId: foreignCurrency,
    }).expect(400);
    await api('post', `/debts/${debtId}/repayments`, {
      ...repayment,
      amount: 0.001,
    }).expect(400);
    await api('post', `/debts/${debtId}/repayments`, {
      ...repayment,
      amount: 71,
    }).expect(400);
    expect(
      await h.connection
        .collection('debttransactions')
        .countDocuments({ debtId: new Types.ObjectId(debtId) }),
    ).toBe(0);
    await api('post', `/debts/${debtId}/repayments`, repayment).expect(201);
    const future = await h.connection.collection('accountsnapshots').findOne({
      accountId: new Types.ObjectId(accountId),
      date: new Date('2027-01-31T23:59:59.999Z'),
    });
    expect(future?.amount).toBe(20);
    await api('patch', `/debts/${debtId}`, {
      status: 'closed',
      remainingAmount: 12,
    }).expect(200);
    await api('post', `/debts/${debtId}/repayments`, repayment).expect(400);
  });
});
