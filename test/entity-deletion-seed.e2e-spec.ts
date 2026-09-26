import { runIntegrityAudit } from '../src/database/integrity/integrity-audit';
import { MongooseIntegrityReader } from '../src/database/integrity/mongoose-integrity-reader';
import { runSeeders } from '../src/database/seeds';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Entity deletion development seed (real replica set)', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;

  beforeAll(async () => {
    fixture = await startGroupsTestApp();
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
    const groups = fixture.connection.collection('groups');

    const candidate = await users.findOne({ email: 'delete-me@test.com' });
    expect(candidate).toMatchObject({ status: 'active', deletedAt: null });

    const candidateAccounts = await accounts
      .find({ userId: candidate!._id })
      .toArray();
    expect(candidateAccounts).toHaveLength(4);
    expect(
      candidateAccounts.filter((account) => account.archivedAt),
    ).toHaveLength(1);
    expect(
      new Set(candidateAccounts.map((account) => account.currency as string)),
    ).toEqual(new Set(['RUB', 'USD']));
    expect(
      candidateAccounts.filter((account) => account.archivedAt === null),
    ).toHaveLength(3);

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

    const deletedGroup = await groups.findOne({
      name: 'Deletion test: deleted group',
    });
    expect(deletedGroup?.deletedAt).toEqual(expect.any(Date));
    expect(
      await fixture.connection.collection('groupmemberships').countDocuments({
        groupId: deletedGroup!._id,
        status: 'removed',
        endReason: 'group_deleted',
      }),
    ).toBe(2);
    expect(
      await fixture.connection.collection('groupinvitations').countDocuments({
        groupId: deletedGroup!._id,
        status: 'revoked',
        revocationReason: 'group_deleted',
      }),
    ).toBe(1);

    await expect(
      runIntegrityAudit(new MongooseIntegrityReader(fixture.connection)),
    ).resolves.toMatchObject({ ok: true, violationCount: 0 });
  });
});
