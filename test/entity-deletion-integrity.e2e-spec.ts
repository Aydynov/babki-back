import { MongooseIntegrityReader } from '../src/database/integrity/mongoose-integrity-reader';
import { MongooseLifecycleMigrationStore } from '../src/database/integrity/mongoose-lifecycle-migration-store';
import { runIntegrityAudit } from '../src/database/integrity/integrity-audit';
import { runLifecycleMigration } from '../src/database/integrity/lifecycle-migration';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Entity deletion rollout integrity (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);

  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('has no known orphan references after the idempotent migration', async () => {
    const migration = await runLifecycleMigration(
      new MongooseLifecycleMigrationStore(harness.connection),
    );
    const repeated = await runLifecycleMigration(
      new MongooseLifecycleMigrationStore(harness.connection),
    );
    const audit = await runIntegrityAudit(
      new MongooseIntegrityReader(harness.connection),
    );

    expect(migration.ok).toBe(true);
    expect(repeated).toMatchObject({ ok: true, updatedDocuments: 0 });
    expect(audit).toMatchObject({
      ok: true,
      violationCount: 0,
      checkedRelations: 31,
      violations: [],
    });
  });
});
