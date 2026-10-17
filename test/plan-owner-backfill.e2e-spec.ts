import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Connection, createConnection, Types } from 'mongoose';
import { backfillPlanOwners } from '../src/database/integrity/plan-owner-backfill';
import { startTestReplicaSet } from './helpers/mongo-replica';

describe('Plan owner backfill on disposable replica set', () => {
  let replica: Awaited<ReturnType<typeof startTestReplicaSet>>;
  let connection: Connection;
  const user = new Types.ObjectId();
  const category = new Types.ObjectId();
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
    await connection.collection('expensecategories').insertOne({
      _id: category,
      ownerType: 'user',
      ownerId: user,
      userId: user,
    });
  });
  const plan = () => ({
    _id: new Types.ObjectId(),
    userId: user,
    categoryId: category,
    amount: 12.34,
    currency: 'USD',
    status: 'active',
    targetDate: new Date('2025-01-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-02-01'),
    archivedAt: null,
  });
  it('defaults to no writes, preserves all history and applies once, including tombstone owners', async () => {
    const row = plan();
    const expense = new Types.ObjectId();
    Object.assign(row, { status: 'closed', expenseId: expense });
    await connection.collection('transactions').insertOne({
      _id: expense,
      type: 'expense',
      ownerType: 'user',
      ownerId: user,
      userId: user,
      category,
      deletedAt: new Date(),
      origin: { type: 'plan', id: row._id },
    });
    await connection.collection('plans').insertOne(row);
    expect(await backfillPlanOwners(connection)).toMatchObject({
      candidates: 1,
      updated: 0,
      issues: [],
    });
    expect(
      await connection.collection('plans').findOne({ _id: row._id }),
    ).toEqual(row);
    expect(await backfillPlanOwners(connection, { apply: true })).toMatchObject(
      { updated: 1, issues: [] },
    );
    expect(
      await connection.collection('plans').findOne({ _id: row._id }),
    ).toEqual({ ...row, ownerType: 'user', ownerId: user, createdBy: user });
    expect(await backfillPlanOwners(connection, { apply: true })).toMatchObject(
      { candidates: 0, updated: 0, issues: [] },
    );
  });
  it('fills compatible partial fields and reports conflicts/missing references without guessing or changing groups', async () => {
    const partial = { ...plan(), ownerId: user };
    const conflict = { ...plan(), createdBy: new Types.ObjectId() };
    const missingUser = { ...plan(), userId: new Types.ObjectId() };
    const missingCategory = { ...plan(), categoryId: new Types.ObjectId() };
    const foreignCategory = { ...plan(), categoryId: new Types.ObjectId() };
    await connection.collection('expensecategories').insertOne({
      _id: foreignCategory.categoryId,
      ownerType: 'group',
      ownerId: new Types.ObjectId(),
    });
    const group = {
      ...plan(),
      ownerType: 'group',
      ownerId: new Types.ObjectId(),
      createdBy: user,
    };
    const rows = [
      partial,
      conflict,
      missingUser,
      missingCategory,
      foreignCategory,
      group,
    ];
    await connection.collection('plans').insertMany(rows);
    const report = await backfillPlanOwners(connection, { apply: true });
    expect(report.updated).toBe(1);
    expect(report.issues).toHaveLength(4);
    for (const row of rows.slice(1))
      expect(
        await connection.collection('plans').findOne({ _id: row._id }),
      ).toEqual(row);
  });
  it('preserves a concurrent assignment to a previously absent owner field', async () => {
    const row = plan(),
      foreignOwner = new Types.ObjectId();
    const plans = connection.collection<{
      _id: Types.ObjectId;
      [key: string]: unknown;
    }>('plans');
    await plans.insertOne(row);
    const intercepted = jest
      .spyOn(plans, 'updateOne')
      .mockImplementationOnce(async (filter, update, options) => {
        await connection
          .db!.collection('plans')
          .updateOne({ _id: row._id }, { $set: { ownerId: foreignOwner } });
        return connection
          .db!.collection('plans')
          .updateOne(filter, update, options);
      });
    try {
      expect(
        await backfillPlanOwners(connection, { apply: true }),
      ).toMatchObject({
        updated: 0,
        issues: [{ planId: row._id.toString(), reason: 'concurrent_change' }],
      });
      expect(await plans.findOne({ _id: row._id })).toEqual({
        ...row,
        ownerId: foreignOwner,
      });
    } finally {
      intercepted.mockRestore();
    }
  });
  it('runs the maintenance entrypoint default dry-run, explicit apply and idempotent repeat', async () => {
    const row = plan();
    await connection.collection('plans').insertOne(row);
    const path = `.temp/plan-owner-cli-${process.pid}-${randomBytes(4).toString('hex')}.json`;
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
          'src/database/backfill-plan-owners.ts',
          ...args,
        ],
        { env: { ...process.env, NODE_ENV: 'test', SECRETS_FILE_PATH: path } },
      );
      return JSON.parse(stdout) as { mode: string; updated: number };
    };
    try {
      expect(await run()).toMatchObject({ mode: 'dry-run', updated: 0 });
      expect(
        await connection.collection('plans').findOne({ _id: row._id }),
      ).toEqual(row);
      expect(await run('--apply')).toMatchObject({ mode: 'apply', updated: 1 });
      expect(await run('--apply')).toMatchObject({ mode: 'apply', updated: 0 });
    } finally {
      await rm(path, { force: true });
    }
  }, 30000);
  it.each(['userId', 'ownerId', 'createdBy', 'categoryId', 'expenseId'])(
    'refuses raw string %s without normalizing it into an apparently valid migration',
    async (field) => {
      const expenseId = new Types.ObjectId();
      const row: { _id: Types.ObjectId; [key: string]: unknown } = {
        ...plan(),
        status: 'closed',
        expenseId,
      };
      const expectedId =
        field === 'categoryId'
          ? category
          : field === 'expenseId'
            ? expenseId
            : user;
      row[field] = expectedId.toHexString();
      await connection.collection('transactions').insertOne({
        _id: expenseId,
        type: 'expense',
        ownerType: 'user',
        ownerId: user,
        userId: user,
        category,
        origin: { type: 'plan', id: row._id },
      });
      await connection.collection('plans').insertOne(row);
      expect(
        await backfillPlanOwners(connection, { apply: true }),
      ).toMatchObject({ updated: 0, issues: [expect.any(Object)] });
      expect(
        await connection.collection('plans').findOne({ _id: row._id }),
      ).toEqual(row);
    },
  );
  it('accepts a same-budget expense category edit without changing the closed Plan category', async () => {
    const expenseId = new Types.ObjectId(),
      editedCategory = new Types.ObjectId();
    const row = { ...plan(), status: 'closed', expenseId };
    await connection.collection('expensecategories').insertOne({
      _id: editedCategory,
      ownerType: 'user',
      ownerId: user,
      userId: user,
    });
    await connection.collection('transactions').insertOne({
      _id: expenseId,
      type: 'expense',
      ownerType: 'user',
      ownerId: user,
      userId: user,
      category: editedCategory,
      origin: { type: 'plan', id: row._id },
    });
    await connection.collection('plans').insertOne(row);
    expect(await backfillPlanOwners(connection, { apply: true })).toMatchObject(
      { updated: 1, issues: [] },
    );
    expect(
      await connection.collection('plans').findOne({ _id: row._id }),
    ).toMatchObject({ categoryId: category });
  });
  it.each([
    'missing',
    'foreign',
    'origin',
    'foreignCategory',
    'missingCategory',
  ])('rejects %s expense links without rewriting the origin', async (kind) => {
    const row = {
      ...plan(),
      status: 'closed',
      expenseId: new Types.ObjectId(),
    };
    await connection.collection('plans').insertOne(row);
    const actualCategory = kind.endsWith('Category')
      ? new Types.ObjectId()
      : category;
    if (kind === 'foreignCategory')
      await connection.collection('expensecategories').insertOne({
        _id: actualCategory,
        ownerType: 'group',
        ownerId: new Types.ObjectId(),
      });
    if (kind !== 'missing')
      await connection.collection('transactions').insertOne({
        _id: row.expenseId,
        type: 'expense',
        ownerType: kind === 'foreign' ? 'group' : 'user',
        ownerId: user,
        userId: user,
        category: actualCategory,
        origin: {
          type: 'plan',
          id: kind === 'origin' ? new Types.ObjectId() : row._id,
        },
      });
    const before = await connection.collection('transactions').find().toArray();
    expect(await backfillPlanOwners(connection, { apply: true })).toMatchObject(
      { updated: 0, issues: [expect.any(Object)] },
    );
    expect(
      await connection.collection('plans').findOne({ _id: row._id }),
    ).toEqual(row);
    expect(
      await connection.collection('transactions').find().toArray(),
    ).toEqual(before);
  });
});
