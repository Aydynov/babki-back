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

## Владельцы планов (этап 08)

Перед включением owner-scoped Plan queries остановить записи планов, сделать backup и выполнить отдельную ограниченную команду с прежней runtime конфигурацией и SECRETS_FILE_PATH:

```sh
npm run maintenance:plan-owners
# или явно:
npm run maintenance:plan-owners -- --dry-run
# только после проверки отчёта:
npm run maintenance:plan-owners -- --apply
npm run maintenance:plan-owners -- --dry-run
```

По умолчанию writes отсутствуют. Отчёт содержит mode/scanned/candidates/updated/issues (planId/reason), но не URI/секреты; issues дают exit 1. После первого apply повтор должен иметь candidates=0/updated=0. Конфликты существующих owner/creator, отсутствующий user/category/expense, другой бюджет и несогласованный origin исправляются после ручного исследования, без назначения по догадке. Уже заданные owner/creator не переписываются; групповые записи не являются кандидатами. Tombstone с сохранённым userId допустим. Строковые hex-ID вместо BSON ObjectId диагностируются без нормализации и без перезаписи; новый API использует BSON-фильтры. Категории плана и расхода могут различаться после обычного исправления расхода, но обе должны принадлежать тому же бюджету. Closed без expenseId диагностируется аудитом. Старые финансовые сущности должны уже иметь собственные owner-пары из прежнего этапа; этот entry point не запускает всю lifecycle migration и не восстанавливает origin самостоятельно.

Raw backfill назначает только отсутствующие ownerType=user/ownerId=userId/createdBy=userId с CAS исходной записи; сохраняет amount/currency/даты, включая createdAt/updatedAt, статус, архив, expenseId и origin. Closed expense проверяется в том же бюджете и с обратным plan origin, включая soft-deleted историю. Достоверность всех ссылок дополнительно проверяется integrity audit. Финансовые суммы/снимки не мигрируются. На рабочей базе команда в этой задаче не выполнялась.

После отсутствия issues включить новый backend: PlansModule ожидает createIndexes до открытия HTTP, без syncIndexes/drop; сохранить личные индексы. Проверить старые личные планы и создание/исполнение группового плана. Изолированные e2e проверяют dry-run без writes, применение, повтор0, частичные/конфликтные поля, tombstone, пропавшие ссылки и неизменность финансовых документов/дат; это свидетельство тестовой базы, не результат production rollout.

Для отката сохранить данные и отключить групповые plan writes. Прежний backend не понимает owner группового Plan в category RESTRICT и worker: откат версии требует отдельной проверки этих путей и личного API. Автоматического удаления owner-полей, purge групповой истории или восстановления удалённых персональных данных нет. Backup нужен для согласованного восстановления после ошибок оператора, а не для повторного исполнения уже закрытых планов.
