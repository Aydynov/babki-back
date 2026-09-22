# Entity deletion rollout

The lifecycle migration is intentionally audit-first. Run it against a backup-restorable database with the same application build that defines the new schemas and indexes. MongoDB must be a replica set before enabling transactional deletion paths.

## Rollout order

1. Keep new user-deletion requests disabled.
2. Deploy the backward-compatible schema fields and indexes. Wait for index creation to finish and check database load before continuing.
3. Run the read-only baseline audit:

   ```bash
   npm run integrity:audit
   ```

   Save its JSON output as the pre-migration record. Exit code `0` means no known orphan references, `1` means violations were found, and `2` means the audit itself failed.

4. If the audit completed, run the idempotent lifecycle migration:

   ```bash
   npm run lifecycle:migrate
   ```

   The migration only supplies missing compatible defaults and plan expense origins that are uniquely determined by `Plan.expenseId`. It never changes financial amounts or guesses the debt that produced a legacy income. Re-running it is safe: already migrated documents are not modified again.

5. Resolve every item in the migration `ambiguous` array manually or with a separately reviewed data repair. Preserve the original reports and the repair decision. Do not infer balances, snapshots, debt origins, or missing parents from descriptions alone.
6. Run `npm run integrity:audit` again and store the post-migration JSON result.
7. Enable the new runtime deletion behavior only after the post-migration audit exits `0`, the migration reports `ok: true`, and the account/category/group concurrency suites pass against a replica set.
8. Enable acceptance of user-deletion jobs last. For every candidate, run cleanup diagnostics without mutations:

   ```bash
   USER_ID=<object-id> npm run user-deletion:dry-run
   ```

   Review the collection counts, keep `USER_DELETION_ENABLED=false`, and start the worker in monitoring mode with `npm run user-deletion:work` (it is safe when the queue is empty).

9. Enable `USER_DELETION_ENABLED=true` for a limited cohort. Keep the worker running repeatedly or under the process scheduler. Monitor jobs whose `attempts` or `lastError` increase and verify that completed jobs end in `stage: completed`.

## Stop criteria

Stop the rollout and keep new deletion paths disabled when any of these conditions occurs:

- either audit exits nonzero;
- the migration reports any ambiguous record;
- an index build fails or creates unacceptable database load;
- a replica-set concurrency test fails;
- the worker dry-run reports data outside the documented personal-data cleanup scope;
- the pre- and post-migration reports cannot be retained for review.

For rollback, first set `USER_DELETION_ENABLED=false` so no new jobs are accepted. Do not stop workers until already accepted jobs reach `completed`; deactivation is immediate and leaving a job unfinished would strand a user in `deletion_pending`. Code rollback does not restore physically deleted empty entities or erased personal data. Archived and soft-deleted records remain compatible with the previous application, but completed user deletion is irreversible.
