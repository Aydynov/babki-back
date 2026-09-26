import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { UserDeletionWorker } from '../src/modules/users/user-deletion.service';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('User deletion (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let sequence = 0;
  const password = 'test-only-correct-horse-battery';
  const oid = (value: string) => new Types.ObjectId(value);
  const collection = (name: string) => harness.connection.collection(name);
  const server = () =>
    harness.app.getHttpServer() as Parameters<typeof request>[0];
  const idOf = (response: Response) =>
    (response.body as { _id?: string; id?: string })._id ??
    (response.body as { id: string }).id;

  async function register() {
    sequence += 1;
    const email = `delete-${sequence}@example.test`;
    const response = await request(server())
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Delete',
        lastName: 'Me',
        email,
        password,
        currency: 'USD',
      })
      .expect(201);
    const body = response.body as {
      user: { _id: string };
      accessToken: string;
    };
    return { id: body.user._id, token: body.accessToken, email };
  }

  const asUser = (token: string) => ({
    get: (path: string) =>
      request(server()).get(`/api/v1${path}`).auth(token, { type: 'bearer' }),
    post: (path: string, body: object = {}) =>
      request(server())
        .post(`/api/v1${path}`)
        .auth(token, { type: 'bearer' })
        .send(body),
  });

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);

  beforeEach(async () => {
    await collection('userdeletionjobs').deleteMany({
      stage: { $ne: 'completed' },
    });
    await collection('users').deleteMany({
      email: { $regex: /^(fault|lease)-/ },
    });
  });

  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('rejects deletion while the user owns an active group', async () => {
    const user = await register();
    await asUser(user.token)
      .post('/groups', { name: 'Owned', type: 'family' })
      .expect(201);

    await asUser(user.token)
      .post('/auth/account-deletion', { password })
      .expect(409);

    expect(
      await collection('users').findOne({ _id: oid(user.id) }),
    ).toMatchObject({ status: 'active' });
    expect(
      await collection('userdeletionjobs').countDocuments({
        userId: oid(user.id),
      }),
    ).toBe(0);
  });

  it('revokes access immediately and produces a PII-free tombstone without deleting group history', async () => {
    const user = await register();
    const personal = asUser(user.token);
    const account = idOf(
      await personal
        .post('/accounts', {
          name: 'Personal balance',
          type: 'balance',
          currency: 'USD',
          amount: 100,
        })
        .expect(201),
    );
    const category = idOf(
      await personal
        .post('/expense-categories', { name: 'Personal' })
        .expect(201),
    );
    await personal
      .post('/expenses', {
        accountId: account,
        categoryId: category,
        amount: 10,
        transactionDate: '2026-09-21',
      })
      .expect(201);

    const owner = asUser(harness.users[0].token);
    const groupId = idOf(
      await owner
        .post('/groups', { name: 'History', type: 'family' })
        .expect(201),
    );
    const invitation = await owner
      .post(`/groups/${groupId}/invitations`)
      .expect(201);
    await personal
      .post('/group-invitations/accept', {
        token: (invitation.body as { token: string }).token,
      })
      .expect(200);
    const groupAccount = idOf(
      await owner
        .post(`/groups/${groupId}/accounts`, { amount: 100 })
        .expect(201),
    );
    const groupCategory = idOf(
      await owner
        .post(`/groups/${groupId}/expense-categories`, { name: 'Shared' })
        .expect(201),
    );
    const groupExpense = idOf(
      await owner
        .post(`/groups/${groupId}/expenses`, {
          accountId: groupAccount,
          categoryId: groupCategory,
          participantId: user.id,
          amount: 5,
          transactionDate: new Date().toISOString(),
        })
        .expect(201),
    );
    await collection('authchallenges').insertOne({
      userId: oid(user.id),
      tokenDigest: `challenge-${sequence}`,
      authVersion: 0,
      failedAttempts: 0,
      expiresAt: new Date(Date.now() + 60000),
      consumedAt: null,
    });
    await collection('usertwofactors').insertOne({
      userId: oid(user.id),
      status: 'enabled',
      secretEnvelope: {
        formatVersion: 1,
        keyId: 'test',
        iv: 'iv',
        ciphertext: 'ciphertext',
        authTag: 'tag',
      },
    });
    await collection('securityauditevents').insertOne({
      userId: oid(user.id),
      type: 'two_factor.blocked',
      context: { ip: '127.0.0.1', userAgent: 'test-agent' },
      createdAt: new Date(),
    });

    const worker = harness.app.get(UserDeletionWorker);
    await expect(worker.diagnose(user.id)).resolves.toMatchObject({
      memberships: 1,
      personalFinance: {
        transactions: 1,
        accounts: 1,
        categories: 1,
      },
      authData: { challenges: 1, twoFactor: 1, auditEvents: 1 },
    });
    expect(
      await collection('transactions').countDocuments({
        ownerType: 'user',
        ownerId: oid(user.id),
      }),
    ).toBe(1);

    await personal.post('/auth/account-deletion', { password }).expect(202);
    await personal.get('/users/me').expect(401);
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password })
      .expect(401);

    for (let stage = 0; stage < 4; stage += 1) {
      await expect(worker.runOnce('e2e-worker')).resolves.toBe(true);
    }
    await expect(worker.runOnce('e2e-worker')).resolves.toBe(false);

    expect(
      await collection('transactions').countDocuments({
        ownerType: 'user',
        ownerId: oid(user.id),
      }),
    ).toBe(0);
    expect(
      await collection('accounts').findOne({ _id: oid(account) }),
    ).toBeNull();
    expect(
      await collection('transactions').findOne({ _id: oid(groupExpense) }),
    ).toMatchObject({ participantId: oid(user.id), ownerType: 'group' });
    expect(
      await collection('groupmemberships').findOne({
        groupId: oid(groupId),
        userId: oid(user.id),
      }),
    ).toMatchObject({ status: 'removed', endReason: 'user_deleted' });
    expect(
      await collection('userdeletionjobs').findOne({ userId: oid(user.id) }),
    ).toMatchObject({ stage: 'completed', completedAt: expect.any(Date) });
    const tombstone = await collection('users').findOne({ _id: oid(user.id) });
    expect(tombstone).toMatchObject({
      status: 'deleted',
      deletedAt: expect.any(Date),
    });
    for (const field of [
      'firstName',
      'lastName',
      'email',
      'passwordHash',
      'description',
    ]) {
      expect(tombstone).not.toHaveProperty(field);
    }
    expect(
      await collection('authchallenges').countDocuments({
        userId: oid(user.id),
      }),
    ).toBe(0);
    expect(
      await collection('usertwofactors').countDocuments({
        userId: oid(user.id),
      }),
    ).toBe(0);
    expect(
      await collection('securityauditevents').findOne({ userId: oid(user.id) }),
    ).toMatchObject({ context: {} });
  });

  it.each([
    ['memberships', 'groupmemberships', 'updateMany'],
    ['personal_finance', 'transactions', 'deleteMany'],
    ['auth_data', 'authchallenges', 'deleteMany'],
    ['tombstone', 'users', 'updateOne'],
  ] as const)(
    'retries the %s stage after a fault without advancing early',
    async (stage, collectionName, method) => {
      const userId = new Types.ObjectId();
      await collection('users').insertOne({
        _id: userId,
        status: 'deletion_pending',
        authVersion: 1,
        email: `fault-${stage}-${userId.toString()}@example.test`,
      });
      await collection('userdeletionjobs').insertOne({
        userId,
        stage,
        leaseOwner: null,
        leaseExpiresAt: null,
        attempts: 0,
        requestedAt: new Date(),
        completedAt: null,
      });
      const target = collection(collectionName);
      const fault = jest
        .spyOn(target, method)
        .mockRejectedValueOnce(new Error('sensitive injected failure'));
      const worker = harness.app.get(UserDeletionWorker);

      await expect(worker.runOnce(`fault-${stage}`)).rejects.toThrow(
        `User deletion stage ${stage} failed.`,
      );
      fault.mockRestore();
      expect(
        await collection('userdeletionjobs').findOne({ userId }),
      ).toMatchObject({
        stage,
        leaseOwner: null,
        lastError: `Stage ${stage} failed.`,
      });
      await expect(worker.runOnce(`retry-${stage}`)).resolves.toBe(true);
    },
  );

  it('allows only one worker to lease the same job', async () => {
    const userId = new Types.ObjectId();
    await collection('users').insertOne({
      _id: userId,
      status: 'deletion_pending',
      authVersion: 1,
      email: `lease-${userId.toString()}@example.test`,
    });
    await collection('userdeletionjobs').insertOne({
      userId,
      stage: 'memberships',
      leaseOwner: null,
      leaseExpiresAt: null,
      attempts: 0,
      requestedAt: new Date(),
      completedAt: null,
    });
    const worker = harness.app.get(UserDeletionWorker);
    const memberships = collection('groupmemberships');
    const originalUpdateMany = memberships.updateMany.bind(memberships);
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = jest
      .spyOn(memberships, 'updateMany')
      .mockImplementationOnce(async (...args) => {
        started();
        await releasePromise;
        return originalUpdateMany(...args);
      });
    const first = worker.runOnce('worker-a');
    await startedPromise;
    const second = worker.runOnce('worker-b');
    const secondResult = await second;
    release();
    const results = [await first, secondResult];
    hold.mockRestore();

    expect(results.sort()).toEqual([false, true]);
    expect(
      (await collection('userdeletionjobs').findOne({ userId }))?.attempts,
    ).toBe(1);
  });
});
