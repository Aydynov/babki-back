import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Connection, createConnection, Types } from 'mongoose';
import { backfillDebtOwners } from '../src/database/integrity/debt-owner-backfill';
import { startTestReplicaSet } from './helpers/mongo-replica';

describe('Debt owner backfill on disposable replica set', () => {
  let replica: Awaited<ReturnType<typeof startTestReplicaSet>>;
  let connection: Connection;
  const user = new Types.ObjectId();
  beforeAll(async () => {
    replica = await startTestReplicaSet();
    connection = await createConnection(replica.uri).asPromise();
  }, 60000);
  afterAll(async () => {
    await connection?.close();
    await replica?.close();
  });
  beforeEach(async () => {
    await connection.dropDatabase();
    await connection
      .collection('users')
      .insertOne({ _id: user, status: 'deleted' });
  });
  const debt = () => ({
    _id: new Types.ObjectId(),
    userId: user,
    principalAmount: 100,
    remainingAmount: 37,
    status: 'closed',
    currency: 'USD',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-02-01'),
  });
  it('defaults to dry-run, fills parents first and preserves manual legacy finances without inventing income links', async () => {
    const parent = debt();
    const history = {
      _id: new Types.ObjectId(),
      debtId: parent._id,
      userId: user,
      amount: 7,
      transactionDate: new Date('2024-02-01'),
    };
    await connection.collection('debts').insertOne(parent);
    await connection.collection('debttransactions').insertOne(history);
    expect(await backfillDebtOwners(connection)).toMatchObject({
      candidates: 2,
      updated: 0,
      issues: [],
    });
    expect(
      await connection.collection('debts').findOne({ _id: parent._id }),
    ).toEqual(parent);
    expect(await backfillDebtOwners(connection, { apply: true })).toMatchObject(
      { updated: 2, issues: [] },
    );
    expect(
      await connection
        .collection('debttransactions')
        .findOne({ _id: history._id }),
    ).toEqual({
      ...history,
      ownerType: 'user',
      ownerId: user,
      createdBy: user,
    });
    expect(
      await connection.collection('debts').findOne({ _id: parent._id }),
    ).toEqual({ ...parent, ownerType: 'user', ownerId: user, createdBy: user });
    expect(await backfillDebtOwners(connection, { apply: true })).toMatchObject(
      { candidates: 0, updated: 0 },
    );
  });
  it('rejects string, conflicting and orphan ownership while preserving group documents', async () => {
    const rows = [
      { ...debt(), userId: user.toHexString() },
      { ...debt(), ownerId: user.toHexString() },
      { ...debt(), createdBy: new Types.ObjectId() },
      { ...debt(), userId: new Types.ObjectId() },
      {
        ...debt(),
        ownerType: 'group',
        ownerId: new Types.ObjectId(),
        createdBy: user,
      },
    ];
    await connection.collection('debts').insertMany(rows);
    await connection.collection('debttransactions').insertOne({
      _id: new Types.ObjectId(),
      userId: user,
      debtId: new Types.ObjectId(),
    });
    const report = await backfillDebtOwners(connection, { apply: true });
    expect(report.updated).toBe(0);
    expect(report.issues).toHaveLength(5);
    expect(await connection.collection('debts').find().toArray()).toEqual(rows);
  });
  it('runs the maintenance entrypoint default dry-run, explicit apply and idempotent repeat', async () => {
    const row = debt();
    await connection.collection('debts').insertOne(row);
    const path = `.temp/debt-owner-cli-${process.pid}-${randomBytes(4).toString('hex')}.json`;
    await mkdir('.temp', { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        MONGO_URI: replica.uri,
        JWT_SECRET: randomBytes(48).toString('base64url'),
        TOTP_ENCRYPTION_ACTIVE_KEY_ID: 'test',
        TOTP_ENCRYPTION_KEYS: { test: randomBytes(32).toString('base64') },
        RECOVERY_HMAC_ACTIVE_KEY_ID: 'test',
        RECOVERY_HMAC_KEYS: { test: randomBytes(32).toString('base64') },
        AUTH_THROTTLE_HMAC_KEY: randomBytes(32).toString('base64'),
      }),
      { mode: 0o600 },
    );
    const run = async (...args: string[]) => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          'node_modules/ts-node/dist/bin.js',
          '--transpile-only',
          '--project',
          'tsconfig.seed.json',
          '-r',
          'tsconfig-paths/register',
          'src/database/backfill-debt-owners.ts',
          ...args,
        ],
        { env: { ...process.env, NODE_ENV: 'test', SECRETS_FILE_PATH: path } },
      );
      return JSON.parse(stdout) as { mode: string; updated: number };
    };
    try {
      expect(await run()).toMatchObject({ mode: 'dry-run', updated: 0 });
      expect(
        await connection.collection('debts').findOne({ _id: row._id }),
      ).toEqual(row);
      expect(await run('--apply')).toMatchObject({ mode: 'apply', updated: 1 });
      expect(await run('--apply')).toMatchObject({ mode: 'apply', updated: 0 });
    } finally {
      await rm(path, { force: true });
    }
  }, 30000);
  it('rejects foreign/string parents and fills compatible partial owners', async () => {
    const parent = {
      ...debt(),
      ownerType: 'user',
      ownerId: user,
      createdBy: user,
    };
    const foreign = {
      ...debt(),
      ownerType: 'group',
      ownerId: new Types.ObjectId(),
      createdBy: user,
    };
    await connection.collection('debts').insertMany([parent, foreign]);
    const rows = [
      {
        _id: new Types.ObjectId(),
        userId: user,
        debtId: parent._id,
        ownerId: user,
      },
      {
        _id: new Types.ObjectId(),
        userId: user,
        debtId: parent._id.toHexString(),
      },
      { _id: new Types.ObjectId(), userId: user, debtId: foreign._id },
      {
        _id: new Types.ObjectId(),
        userId: user.toHexString(),
        debtId: parent._id,
      },
    ];
    await connection.collection('debttransactions').insertMany(rows);
    const report = await backfillDebtOwners(connection, { apply: true });
    expect(report.updated).toBe(1);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'missing_or_cross_budget_parent' }),
      ]),
    );
    for (const row of rows.slice(1))
      expect(
        await connection
          .collection('debttransactions')
          .findOne({ _id: row._id }),
      ).toEqual(row);
  });
  it('preserves concurrent assignment to a previously missing owner', async () => {
    const row = debt();
    const foreign = new Types.ObjectId();
    const collection = connection.collection<{
      _id: Types.ObjectId;
      [key: string]: unknown;
    }>('debts');
    await collection.insertOne(row);
    const intercepted = jest
      .spyOn(collection, 'updateOne')
      .mockImplementationOnce(async (filter, update, options) => {
        await connection
          .db!.collection('debts')
          .updateOne({ _id: row._id }, { $set: { ownerId: foreign } });
        return connection
          .db!.collection('debts')
          .updateOne(filter, update, options);
      });
    try {
      expect(
        await backfillDebtOwners(connection, { apply: true }),
      ).toMatchObject({
        updated: 0,
        issues: [expect.objectContaining({ reason: 'concurrent_change' })],
      });
      expect(await collection.findOne({ _id: row._id })).toEqual({
        ...row,
        ownerId: foreign,
      });
    } finally {
      intercepted.mockRestore();
    }
  });
  it('does not assign history when its parent changes concurrently', async () => {
    const parent = {
      ...debt(),
      ownerType: 'user',
      ownerId: user,
      createdBy: user,
    };
    const history = {
      _id: new Types.ObjectId(),
      debtId: parent._id,
      userId: user,
      amount: 1,
    };
    const parents = connection.collection<{
      _id: Types.ObjectId;
      [key: string]: unknown;
    }>('debts');
    await parents.insertOne(parent);
    await connection.collection('debttransactions').insertOne(history);
    const intercepted = jest
      .spyOn(parents, 'updateOne')
      .mockImplementationOnce(async (filter, update, options) => {
        await connection
          .db!.collection('debts')
          .updateOne(
            { _id: parent._id },
            { $set: { ownerType: 'group', ownerId: new Types.ObjectId() } },
          );
        return connection
          .db!.collection('debts')
          .updateOne(filter, update, options);
      });
    try {
      const result = await backfillDebtOwners(connection, { apply: true });
      expect(result.updated).toBe(0);
      expect(result.issues).toEqual([
        expect.objectContaining({ reason: 'concurrent_parent_change' }),
      ]);
      expect(
        await connection
          .collection('debttransactions')
          .findOne({ _id: history._id }),
      ).toEqual(history);
    } finally {
      intercepted.mockRestore();
    }
  });
});
