import { Types } from 'mongoose';
import request from 'supertest';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal transfer compatibility (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) =>
    request(harness.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(harness.users[0].token, { type: 'bearer' })
      .send(body);
  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('preserves historical carry, snapshot funds, legacy currency filters and mixed serialization', async () => {
    const source = (
      await api('post', '/accounts', {
        name: 'Carry RUB',
        type: 'balance',
        currency: 'RUB',
      }).expect(201)
    ).body as { _id: string };
    const destination = (
      await api('post', '/accounts', {
        name: 'Carry USD',
        type: 'saving',
        currency: 'USD',
      }).expect(201)
    ).body as { _id: string };
    const snapshots = harness.connection.collection('accountsnapshots');
    await snapshots.deleteMany({
      accountId: {
        $in: [source._id, destination._id].map((id) => new Types.ObjectId(id)),
      },
    });
    await snapshots.insertMany([
      {
        accountId: new Types.ObjectId(source._id),
        date: new Date('2026-08-01'),
        amount: 700,
      },
      {
        accountId: new Types.ObjectId(source._id),
        date: new Date('2026-10-01'),
        amount: 900,
      },
      {
        accountId: new Types.ObjectId(destination._id),
        date: new Date('2026-08-01'),
        amount: 30,
      },
      {
        accountId: new Types.ObjectId(destination._id),
        date: new Date('2026-10-01'),
        amount: 50,
      },
    ]);
    const dto = {
      sourceAccountId: source._id,
      destinationAccountId: destination._id,
      sourceAmount: 701,
      destinationAmount: 7,
      transactionDate: '2026-09-10',
    };
    await api('post', '/transfers', dto).expect(400);
    const created = (
      await api('post', '/transfers', {
        ...dto,
        sourceAmount: 600,
        destinationAmount: 6,
      }).expect(201)
    ).body as { _id: string };
    const amount = async (id: string, date: string) =>
      (
        await snapshots.findOne({
          accountId: new Types.ObjectId(id),
          date: date === '2026-09-01' ? new Date(2026, 8, 1) : new Date(date),
        })
      )?.amount as number;
    expect(await amount(source._id, '2026-09-01')).toBe(100);
    expect(await amount(source._id, '2026-10-01')).toBe(300);
    expect(await amount(destination._id, '2026-10-01')).toBe(56);
    expect(
      (await api('get', '/transfers?currency=RUB').expect(200)).body,
    ).toMatchObject({ total: 0 });
    const mixed = (
      await api('get', `/transactions?accountId=${destination._id}`).expect(200)
    ).body as { items: object[] };
    expect(mixed.items[0]).not.toHaveProperty('effectiveRate');
    expect(mixed.items[0]).not.toHaveProperty('createdBy');
    await api('patch', `/transfers/${created._id}`, {
      sourceAmount: 701,
      destinationAmount: 7,
    }).expect(400);
    await api('patch', `/transfers/${created._id}`, {}).expect(200);
    await api('patch', `/transfers/${created._id}`, {
      sourceAmount: null,
      destinationAmount: null,
      description: null,
    }).expect(200);
    await api('patch', `/transfers/${created._id}`, {
      sourceAmount: 650,
      destinationAmount: 6.5,
    }).expect(200);
    expect(await amount(source._id, '2026-10-01')).toBe(250);
    expect(await amount(destination._id, '2026-10-01')).toBe(56.5);
    await api('delete', `/transfers/${created._id}`).expect(204);
    await api('delete', `/transfers/${created._id}`).expect(404);
    expect(await amount(source._id, '2026-09-01')).toBe(700);
    expect(await amount(source._id, '2026-10-01')).toBe(900);
    expect(await amount(destination._id, '2026-10-01')).toBe(50);
  });
});
