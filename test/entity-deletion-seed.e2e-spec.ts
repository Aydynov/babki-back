import { Types } from 'mongoose';
import { runIntegrityAudit } from '../src/database/integrity/integrity-audit';
import { MongooseIntegrityReader } from '../src/database/integrity/mongoose-integrity-reader';
import { runSeeders } from '../src/database/seeds';
import { startSpacesTestApp } from './helpers/spaces-test-app';

describe('Entity deletion development seed (real replica set)', () => {
  let fixture: Awaited<ReturnType<typeof startSpacesTestApp>>;

  beforeAll(async () => {
    fixture = await startSpacesTestApp();
    await runSeeders(fixture.app);
  }, 120000);

  afterAll(async () => {
    await fixture?.close();
  });

  it('creates discoverable lifecycle scenarios without orphan references', async () => {
    const users = fixture.connection.collection('users');
    const accounts = fixture.connection.collection('accounts');
    const categories = fixture.connection.collection('expensecategories');
    const transactions = fixture.connection.collection('transactions');
    const plans = fixture.connection.collection('plans');
    const debts = fixture.connection.collection('debts');
    const spaces = fixture.connection.collection('spaces');

    const candidate = await users.findOne({ email: 'delete-me@test.com' });
    expect(candidate).toMatchObject({ status: 'active', deletedAt: null });

    expect(
      await fixture.connection
        .collection('spacememberships')
        .countDocuments({ userId: candidate!._id }),
    ).toBe(0);
    expect(
      await users.countDocuments({ defaultCurrency: { $exists: true } }),
    ).toBe(0);
    expect(
      await users.countDocuments({ defaultAccountId: { $exists: true } }),
    ).toBe(0);
    const solo = await spaces.findOne({ name: 'Личный бюджет' });
    expect(
      await fixture.connection
        .collection('spacememberships')
        .countDocuments({ spaceId: solo!._id, status: 'active' }),
    ).toBe(1);
    const soloAccounts = await accounts.find({ spaceId: solo!._id }).toArray();
    expect(soloAccounts).toHaveLength(4);
    expect(soloAccounts.filter((account) => account.archivedAt)).toHaveLength(
      1,
    );
    expect(
      new Set(soloAccounts.map((account) => account.currency as string)),
    ).toEqual(new Set(['RUB', 'USD']));
    expect(
      await categories.countDocuments({ name: 'Deletion test: unused' }),
    ).toBe(1);
    expect(
      await categories.countDocuments({
        name: 'Deletion test: archived',
        isArchived: true,
      }),
    ).toBe(1);
    expect(
      await transactions.countDocuments({
        description: 'Deletion test: soft-deleted income',
        deletedAt: { $type: 'date' },
      }),
    ).toBe(1);
    expect(await plans.countDocuments({ archivedAt: { $type: 'date' } })).toBe(
      1,
    );
    expect(await debts.countDocuments({ archivedAt: { $type: 'date' } })).toBe(
      1,
    );
    expect(
      await debts.countDocuments({ debtor: 'Deletion test: unused debt' }),
    ).toBe(1);

    const deletedSpace = await spaces.findOne({
      name: 'Deletion test: deleted space',
    });
    expect(deletedSpace?.deletedAt).toEqual(expect.any(Date));
    expect(
      await fixture.connection.collection('spacememberships').countDocuments({
        spaceId: deletedSpace!._id,
        status: 'removed',
        endReason: 'space_deleted',
      }),
    ).toBe(2);
    expect(
      await fixture.connection.collection('spaceinvitations').countDocuments({
        spaceId: deletedSpace!._id,
        status: 'revoked',
        revocationReason: 'space_deleted',
      }),
    ).toBe(1);

    for (const name of [
      'accounts',
      'transactions',
      'expensecategories',
      'expenselimits',
      'plans',
      'debts',
      'debttransactions',
    ]) {
      expect(
        await fixture.connection.collection(name).countDocuments({
          $or: [
            { ownerType: { $exists: true } },
            { ownerId: { $exists: true } },
            { userId: { $exists: true } },
          ],
        }),
      ).toBe(0);
    }
    expect(await spaces.countDocuments({ type: { $exists: true } })).toBe(0);
    await expect(
      runIntegrityAudit(new MongooseIntegrityReader(fixture.connection)),
    ).resolves.toMatchObject({ ok: true, violationCount: 0 });
  });
  it('detects cross-space account and mismatched snapshot links without changing financial facts', async () => {
    const transactions = fixture.connection.collection('transactions');
    const transaction = await transactions.findOne({
      type: 'income',
      deletedAt: null,
    });
    const account = await fixture.connection
      .collection('accounts')
      .findOne({ spaceId: { $ne: transaction!.spaceId as Types.ObjectId } });
    const originalAccount = transaction!.accountId as Types.ObjectId;
    await transactions.updateOne(
      { _id: transaction!._id },
      { $set: { accountId: account!._id } },
    );
    const corrupted = await transactions.findOne({ _id: transaction!._id });
    try {
      const result = await runIntegrityAudit(
        new MongooseIntegrityReader(fixture.connection),
      );
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: 'transaction.account',
            sourceId: String(transaction!._id),
          }),
          expect.objectContaining({
            relation: 'transaction.snapshot',
            sourceId: String(transaction!._id),
          }),
        ]),
      );
      expect(await transactions.findOne({ _id: transaction!._id })).toEqual(
        corrupted,
      );
    } finally {
      await transactions.updateOne(
        { _id: transaction!._id },
        { $set: { accountId: originalAccount } },
      );
    }
  });
});
