import { getModelToken } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import {
  UserDeletionService,
  UserDeletionWorker,
} from '../src/modules/users/user-deletion.service';
import { User } from '../src/modules/users/schemas/user.schema';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group financial actor privacy and atomicity', () => {
  let ctx: Awaited<ReturnType<typeof startGroupsTestApp>>;
  const idOf = (response: Response) =>
    (response.body as { _id?: string; id?: string })._id ??
    (response.body as { id: string }).id;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) =>
    request(ctx.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(ctx.users[user].token, { type: 'bearer' });
  const actor = (user: number, anonymized = false, firstName = 'Grace') => ({
    userId: ctx.users[user].id,
    firstName: anonymized ? null : firstName,
    lastName: anonymized ? null : 'Test',
    isAnonymized: anonymized,
  });
  async function fixture() {
    const groupId = idOf(
      await api('post', '/groups')
        .send({ name: 'Actor privacy', type: 'family' })
        .expect(201),
    );
    const base = `/groups/${groupId}`;
    const accounts: string[] = [];
    for (const name of ['Source', 'Destination']) {
      accounts.push(
        idOf(
          await api('post', `${base}/accounts`)
            .send({
              name,
              currency: 'USD',
              amount: 1000,
              openedAt: '2024-01-01',
            })
            .expect(201),
        ),
      );
    }
    const categoryId = idOf(
      await api('post', `${base}/expense-categories`)
        .send({ name: 'Shared' })
        .expect(201),
    );
    const bodies = {
      expenses: {
        accountId: accounts[0],
        categoryId,
        amount: 10,
        transactionDate: '2025-02-15',
      },
      incomes: {
        accountId: accounts[0],
        amount: 10,
        transactionDate: '2025-02-15',
      },
      transfers: {
        sourceAccountId: accounts[0],
        destinationAccountId: accounts[1],
        sourceAmount: 10,
        destinationAmount: 10,
        transactionDate: '2025-02-15',
      },
    };
    return { base, groupId, accounts, bodies };
  }
  async function join(base: string, user: number) {
    const invitation = await api('post', `${base}/invitations`).expect(201);
    await api('post', '/group-invitations/accept', user)
      .send({ token: (invitation.body as { token: string }).token })
      .expect(200);
  }
  async function financialState(session?: ClientSession) {
    const collections = await ctx.connection.db!.listCollections().toArray();
    const names = collections
      .map(({ name }) => name)
      .filter((name) =>
        /^(accounts|transactions|.*snapshot.*|groups|expensecategories|expenselimits)$/.test(
          name,
        ),
      )
      .sort();
    return Promise.all(
      names.map(async (name) => ({
        name,
        // JSON preserves every stored domain field, including versions/timestamps.
        documents: JSON.stringify(
          await ctx.connection
            .collection(name)
            .find({}, { session })
            .sort({ _id: 1 })
            .toArray(),
        ),
      })),
    );
  }
  beforeAll(async () => {
    ctx = await startGroupsTestApp();
  }, 60000);
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => ctx?.close());

  it('uses current names then immediately anonymizes pending deletion and the worker tombstone', async () => {
    const f = await fixture();
    await join(f.base, 1);
    const expense = await api('post', `${f.base}/expenses`, 1)
      .send(f.bodies.expenses)
      .expect(201);
    const id = idOf(expense);
    expect(expense.body).toMatchObject({
      createdBy: ctx.users[1].id,
      participantId: ctx.users[1].id,
      createdByActor: actor(1),
      participantActor: actor(1),
    });
    await api('patch', '/users/me', 1)
      .send({ firstName: 'Renamed' })
      .expect(200);
    expect(
      (await api('get', `${f.base}/expenses/${id}`).expect(200)).body,
    ).toMatchObject({
      createdByActor: actor(1, false, 'Renamed'),
      participantActor: actor(1, false, 'Renamed'),
    });
    const before = await financialState();
    await ctx.app.get(UserDeletionService).request(ctx.users[1].id);
    const pending = await ctx.connection.collection('users').findOne({
      _id: new Types.ObjectId(ctx.users[1].id),
    });
    expect(pending).toMatchObject({
      status: 'deletion_pending',
      firstName: 'Renamed',
      lastName: 'Test',
    });
    const assertAnonymous = async () => {
      const response = await api('get', `${f.base}/expenses/${id}`).expect(200);
      expect(response.body).toMatchObject({
        createdBy: ctx.users[1].id,
        participantId: ctx.users[1].id,
        amount: 10,
        createdByActor: actor(1, true),
        participantActor: actor(1, true),
      });
      const body = response.body as Record<string, unknown>;
      expect(body.createdByActor).toEqual(actor(1, true));
      expect(body.participantActor).toEqual(actor(1, true));
      expect(await financialState()).toEqual(before);
      return response.body as unknown;
    };
    const pendingResponse = await assertAnonymous();
    const worker = ctx.app.get(UserDeletionWorker);
    for (let stage = 0; stage < 4; stage += 1)
      await expect(worker.runOnce('actor-privacy')).resolves.toBe(true);
    await expect(worker.runOnce('actor-privacy')).resolves.toBe(false);
    const tombstone = await ctx.connection.collection('users').findOne({
      _id: new Types.ObjectId(ctx.users[1].id),
    });
    expect(tombstone).toMatchObject({ status: 'deleted' });
    expect(tombstone).not.toHaveProperty('firstName');
    expect(tombstone).not.toHaveProperty('lastName');
    expect(await assertAnonymous()).toEqual(pendingResponse);
  });

  it('anonymizes a missing referenced profile without rewriting saved identities', async () => {
    const f = await fixture();
    const response = await api('post', `${f.base}/expenses`)
      .send(f.bodies.expenses)
      .expect(201);
    const missing = new Types.ObjectId();
    await ctx.connection
      .collection('transactions')
      .updateOne(
        { _id: new Types.ObjectId(idOf(response)) },
        { $set: { createdBy: missing, participantId: missing } },
      );
    const fallback = {
      userId: missing.toHexString(),
      firstName: null,
      lastName: null,
      isAnonymized: true,
    };
    const before = await financialState();
    const read = await api(
      'get',
      `${f.base}/expenses/${idOf(response)}`,
    ).expect(200);
    expect(read.body).toMatchObject({
      createdBy: missing.toHexString(),
      participantId: missing.toHexString(),
      createdByActor: fallback,
      participantActor: fallback,
    });
    expect((read.body as Record<string, unknown>).createdByActor).toEqual(
      fallback,
    );
    expect((read.body as Record<string, unknown>).participantActor).toEqual(
      fallback,
    );
    expect(await financialState()).toEqual(before);
  });

  it.each(['expenses', 'incomes', 'transfers'] as const)(
    'fails reads and rolls back real %s create/PATCH writes when actor lookup fails',
    async (kind) => {
      const f = await fixture();
      const created = await api('post', `${f.base}/${kind}`)
        .send(f.bodies[kind])
        .expect(201);
      const before = await financialState();
      const users = ctx.app.get<Model<User>>(getModelToken(User.name));
      const originalFind = users.find.bind(users) as Model<User>['find'];
      const pendingWrites: Awaited<ReturnType<typeof financialState>>[] = [];
      const sessions: ClientSession[] = [];
      const lookup = jest.spyOn(users, 'find').mockImplementation((...args) => {
        const query = originalFind(...args);
        jest.spyOn(query, 'exec').mockImplementation(async () => {
          const session = query.getOptions().session;
          if (session) {
            sessions.push(session);
            pendingWrites.push(await financialState(session));
          }
          throw new Error('private actor storage failure');
        });
        return query;
      });
      for (const path of [
        `${f.base}/${kind}/${idOf(created)}`,
        `${f.base}/${kind}`,
        `${f.base}/transactions`,
      ]) {
        const read = await api('get', path).expect(500);
        expect(read.body).toMatchObject({
          statusCode: 500,
          message: 'Internal server error',
          path: `/api/v1${path}`,
        });
        expect(read.body).not.toHaveProperty('items');
      }
      const create = await api('post', `${f.base}/${kind}`)
        .send(f.bodies[kind])
        .expect(503);
      expect(create.body).toMatchObject({
        statusCode: 503,
        message: 'Financial operation could not be completed',
      });
      expect(await financialState()).toEqual(before);
      const patch = await api('patch', `${f.base}/${kind}/${idOf(created)}`)
        .send(
          kind === 'transfers'
            ? { sourceAmount: 25, destinationAmount: 25 }
            : { amount: 25 },
        )
        .expect(503);
      expect(patch.body).toMatchObject({
        statusCode: 503,
        message: 'Financial operation could not be completed',
      });
      expect(await financialState()).toEqual(before);
      expect(lookup).toHaveBeenCalledTimes(5);
      expect(sessions).toHaveLength(2);
      expect(pendingWrites).toHaveLength(2);
      for (const uncommitted of pendingWrites) {
        for (const name of [
          'transactions',
          'accounts',
          'accountsnapshots',
          'groups',
        ]) {
          expect(uncommitted.find((entry) => entry.name === name)).not.toEqual(
            before.find((entry) => entry.name === name),
          );
        }
      }
      if (kind === 'transfers') {
        for (const uncommitted of pendingWrites) {
          for (const name of ['accounts', 'accountsnapshots']) {
            const documents = JSON.parse(
              uncommitted.find((entry) => entry.name === name)!.documents,
            ) as { _id: string; accountId?: string; amount: number }[];
            const committed = JSON.parse(
              before.find((entry) => entry.name === name)!.documents,
            ) as { _id: string; accountId?: string; amount: number }[];
            for (const accountId of f.accounts) {
              const belongs = (row: { _id: string; accountId?: string }) =>
                (name === 'accounts' ? row._id : row.accountId) === accountId;
              expect(documents.filter(belongs)).not.toEqual(
                committed.filter(belongs),
              );
            }
          }
        }
      }
      lookup.mockClear();
      const deleted = await api(
        'delete',
        `${f.base}/${kind}/${idOf(created)}`,
      ).expect(204);
      expect(deleted.text).toBe('');
      expect(lookup).not.toHaveBeenCalled();
    },
  );
});
