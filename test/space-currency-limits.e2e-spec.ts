import request from 'supertest';
import { Types } from 'mongoose';
import { startSpacesTestApp } from './helpers/spaces-test-app';
describe('Space currency limits HTTP', () => {
  let fixture: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let space: string;
  let category: string;
  const call = (method: 'get' | 'post' | 'patch', path: string) =>
    request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1/spaces/${space}${path}`)
      .auth(fixture.users[0].token, { type: 'bearer' });
  const period = { startDate: '2024-01-01', endDate: '2024-01-31' };
  beforeAll(async () => {
    fixture = await startSpacesTestApp();
    const created = await request(
      fixture.app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/spaces')
      .auth(fixture.users[0].token, { type: 'bearer' })
      .send({ name: 'Currency limits' })
      .expect(201);
    const body = created.body as {
      id?: string;
      _id: string;
    };
    space = body.id ?? body._id;
    const createdCategory = await call('post', '/expense-categories')
      .send({ name: 'Food' })
      .expect(201);
    category = (
      createdCategory.body as {
        _id: string;
      }
    )._id;
  }, 60000);
  afterAll(async () => fixture?.close());
  it('requires currency and rejects unsupported codes', async () => {
    await call('post', '/expense-limits')
      .send({ categoryId: category, total: 100, ...period })
      .expect(400);
    await call('post', '/expense-limits')
      .send({ categoryId: category, total: 100, currency: 'ZZZ', ...period })
      .expect(400);
  });
  it('normalizes currency and allows concurrent currency buckets without matching accounts', async () => {
    const rub = await call('post', '/expense-limits')
      .send({ categoryId: category, total: 100, currency: ' rub ', ...period })
      .expect(201);
    expect(rub.body).toMatchObject({ currency: 'RUB', total: 100, rest: 100 });
    const kwd = await call('post', '/expense-limits')
      .send({ categoryId: category, total: 0.1, currency: ' kwd ', ...period })
      .expect(201);
    expect(kwd.body).toMatchObject({ currency: 'KWD', total: 0.1, rest: 0.1 });
    const filtered = await call(
      'get',
      '/expense-limits?currency=%20kwd%20',
    ).expect(200);
    expect(filtered.body).toEqual([
      expect.objectContaining({ currency: 'KWD' }),
    ]);
    await call('get', '/expense-limits?currency=ZZZ').expect(400);
    await call(
      'patch',
      `/expense-limits/${
        (
          kwd.body as {
            _id: string;
          }
        )._id
      }`,
    )
      .send({ currency: 'RUB' })
      .expect(400);
  });
  it('validates currency precision on create and PATCH without modifying limits', async () => {
    await call('post', '/expense-limits')
      .send({ categoryId: category, total: 0.1, currency: 'JPY', ...period })
      .expect(400);
    const jpy = await call('post', '/expense-limits')
      .send({ categoryId: category, total: 1, currency: 'JPY', ...period })
      .expect(201);
    const id = (
      jpy.body as {
        _id: string;
      }
    )._id;
    await call('patch', `/expense-limits/${id}`)
      .send({ total: 0.1 })
      .expect(400);
    expect(
      (await call('get', `/expense-limits/${id}`).expect(200)).body,
    ).toMatchObject({ currency: 'JPY', total: 1, rest: 1 });
    const kwd = await call('post', '/expense-limits')
      .send({
        categoryId: category,
        total: 0.001,
        currency: 'KWD',
        startDate: '2024-02-01',
        endDate: '2024-02-29',
      })
      .expect(201);
    const kwdId = (
      kwd.body as {
        _id: string;
      }
    )._id;
    await call('patch', `/expense-limits/${kwdId}`)
      .send({ total: 0.0001 })
      .expect(400);
    await call('patch', `/expense-limits/${kwdId}`)
      .send({ total: 0.003 })
      .expect(200);
    expect(
      (await call('get', `/expense-limits/${kwdId}`).expect(200)).body,
    ).toMatchObject({ total: 0.003, rest: 0.003 });
  });
  it('scopes usage to owner, category and currency with exact KWD remaining', async () => {
    const spaceId = new Types.ObjectId(space);
    const categoryId = new Types.ObjectId(category);
    await fixture.connection.collection('transactions').insertMany([
      {
        spaceId,
        category: categoryId,
        currency: 'KWD',
        amount: 0.001,
        type: 'expense',
        transactionDate: new Date('2024-01-31T23:59:59.999Z'),
        deletedAt: null,
      },
      {
        spaceId: new Types.ObjectId(),
        category: categoryId,
        currency: 'KWD',
        amount: 1,
        type: 'expense',
        transactionDate: new Date('2024-01-15'),
        deletedAt: null,
      },
      {
        spaceId,
        category: new Types.ObjectId(),
        currency: 'KWD',
        amount: 1,
        type: 'expense',
        transactionDate: new Date('2024-01-15'),
        deletedAt: null,
      },
      {
        spaceId,
        category: categoryId,
        currency: 'KWD',
        amount: 1,
        type: 'expense',
        transactionDate: new Date('2024-02-01'),
        deletedAt: null,
      },
      {
        spaceId,
        category: categoryId,
        currency: 'KWD',
        amount: 1,
        type: 'expense',
        transactionDate: new Date('2024-01-15'),
        deletedAt: new Date('2024-02-01'),
      },
    ]);
    expect(
      (
        await call(
          'get',
          '/expense-limits?currency=KWD&periodDate=2024-01-15',
        ).expect(200)
      ).body,
    ).toEqual([expect.objectContaining({ total: 0.1, rest: 0.099 })]);
    expect(
      (await call('get', '/expense-limits?currency=RUB').expect(200)).body,
    ).toEqual([expect.objectContaining({ total: 100, rest: 100 })]);
  });
  it('rejects overlapping updates only in the same currency and serializes concurrent creation', async () => {
    const march = await call('post', '/expense-limits')
      .send({
        categoryId: category,
        total: 0,
        currency: 'KWD',
        startDate: '2024-03-01',
        endDate: '2024-03-31',
      })
      .expect(201);
    const id = (
      march.body as {
        _id: string;
      }
    )._id;
    await call('patch', `/expense-limits/${id}`)
      .send({ startDate: '2024-02-29' })
      .expect(409);
    expect(
      (await call('get', `/expense-limits/${id}`).expect(200)).body,
    ).toMatchObject({ startDate: '2024-03-01T00:00:00.000Z', total: 0 });
    await call('patch', `/expense-limits/${id}`)
      .send({ total: 10, startDate: '2024-04-01' })
      .expect(400);
    expect(
      (await call('get', `/expense-limits/${id}`).expect(200)).body,
    ).toMatchObject({ startDate: '2024-03-01T00:00:00.000Z', total: 0 });
    const eur = await call('post', '/expense-limits')
      .send({
        categoryId: category,
        total: 1,
        currency: 'EUR',
        startDate: '2024-03-01',
        endDate: '2024-03-31',
      })
      .expect(201);
    await call(
      'patch',
      `/expense-limits/${
        (
          eur.body as {
            _id: string;
          }
        )._id
      }`,
    )
      .send(period)
      .expect(200);
    const concurrent = await Promise.all(
      [0, 1].map(() =>
        call('post', '/expense-limits').send({
          categoryId: category,
          total: 1,
          currency: 'USD',
          ...period,
        }),
      ),
    );
    expect(concurrent.map((result) => result.status).sort()).toEqual([
      201, 409,
    ]);
  });
});
