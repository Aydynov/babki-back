# Tasks

## 1. Общий Plan и совместимость личного бюджета

- [x] 1.1 До refactor зафиксировать characterization личных plans create/list/detail/PATCH/delete/archive/close, ошибок валюты, min 0.01, empty/null PATCH и snapshot carry. Запустить текущие plans unit, plan-debt-lifecycle и multicurrency; добавить group routes RED и подтвердить исходный 404.
- [x] 1.2 Расширить существующие Plan и PlansService бюджетными полями/общими методами, supplied ClientSession и личными adapters/personalResponse. Проверить owner-isolation unit и прежние characterization без новых полей в личном DTO; schema min не блокирует group KWD 0.001, личный минимум сохранён. Не создавать GroupPlan или второй механизм close.
- [x] 1.3 Добавить безопасный owner/author backfill личных Plan и maintenance entry point default dry-run/explicit --apply. На временной replica set проверить dry-run без writes, сохранение дат/сумм/статусов/expenseId/origin, применение/повтор0, частичные поля/конфликты/пропавшие user/category/expense, tombstone и неизменность групповых записей. Рабочую базу не мигрировать; документировать запуск/порядок/откат в docs.
- [x] 1.4 Добавить owner-scoped индексы Plan и контролируемое создание до трафика; сохранить личные индексы. Проверить schema-indexes и повторный startup без удаления индексов, согласовать docs/budget-financial-core.md с фактическими shared methods и миграционной границей.

## 2. Групповой CRUD, права и автор

- [x] 2.1 Подключить тонкий GroupPlansService/маршруты через BudgetAccess/BudgetWrite и общий PlansService. Проверить create/read любым членом и mutation author/owner/manageTransactions, settings-only403, чужой бюджет404/JWT401, отзыв со старым JWT. До реализации проверить RED соответствующего нового поведения.
- [x] 2.2 Добавить строгие group DTO create/PATCH/list, money precision JPY/RUB/KWD, description/targetDate/category, includeArchived boolean. Проверить null/unknown/empty/неизменяемые поля400, foreign404/archived category409, сохранение старой архивной категории без нового назначения, стабильную пагинацию/архивные детали и отсутствие денежных effects активного плана.
- [x] 2.3 Переиспользовать actor resolver этапа 07 для Plan без фиктивного type/participantId. Проверить current/departed/pending/deleted/missing createdByActor, единый batch на страницу, mutation session/rollback при lookup failure, отсутствие персональных полей и actor input injection. Прежние expense/income/transfer actor unit/e2e должны пройти.
- [x] 2.4 Описать group plans routes/DTO/statuses/права/архив в docs/group-finances-api.md и docs/groups-api.md; сверить примеры с HTTP-тестами и совместимостью личных маршрутов. Явно указать, что план не резервирует деньги и не является расходом.

## 3. Однократное исполнение и финансовый факт

- [x] 3.1 Реализовать общий closeForBudget и group close в той же BudgetWrite ClientSession через ExpensesService.createForBudget. Проверить разные planned/actual суммы, defaults, executor author/participant, выбранного действующего participant, валюту/precision/openedAt, origin/expenseId, отрицательный групповой остаток и отсутствие личных effects. Повторный close400 без второго расхода.
- [x] 3.2 Проверить обычный expense PATCH/DELETE после close: права расхода независимы от автора плана, origin/expenseId/closed/planned amount сохраняются, отчёт/revenue/лимит учитывают активный фактический расход ровно один раз. Архив счёта замораживает расход, архив плана его не меняет; reopen/частичное исполнение/expenseId input отсутствуют.
- [x] 3.3 Добавить explicit-barrier реальные гонки close/close, close с PATCH/archive/delete плана, archive/delete account/category и revoke/remove/ownership/group deletion в обоих порядках. Failure injection после расхода, Plan update и actor lookup должен откатывать plan/expense/accounts/snapshots/versions; проверить личную close concurrency совместимость.
- [x] 3.4 Дополнить docs/group-finances-api.md правилами close, плановой/фактической суммы, 201/400/404/409/503, repeat semantics и судьбой связи при удалённом расходе. Сопоставить каждый денежный пример с group report/limit и rollback assertions.

## 4. Lifecycle, удаление и fixtures

- [x] 4.1 Распространить общий category RESTRICT на планы обоих бюджетов через существующие locks. Проверить active/closed/archived Plan, concurrent create/PATCH/close vs category delete/archive и отсутствие dangling refs. Проверить plan DELETE204/repeat404/closed-or-archived409/archive204/repeat404 и read-only group archive detail; обновить docs/entity-deletion-api.md.
- [x] 4.2 Согласовать user-deletion diagnose/worker с owner Plan, сохранив групповые планы автора и личную очистку; group deletion сохраняет данные и закрывает доступ. Расширить существующий integrity audit Plan owner/creator и согласованностью category/expense/origin бюджета. Проверить реальный worker, pending/tombstone actor, личный и два group budgets, soft-deleted expense не считается orphan; обновить rollout docs.
- [x] 4.3 Расширить существующие dev seeds детерминированными active и closed family Plan через общий сервис, с реальным origin-расходом. Пересчитать ровно его effects в seed expectations, ledger/reports/limit/count и docs/group-finances-seed.md; проверить одинаковое чтение супругами, личные fixtures и отсутствие effects active Plan. Seed/reset рабочей базы не запускать.
- [x] 4.4 Обновить docs/budget-financial-core.md и inventory общей моделью Plan, supplied sessions, происхождением расхода и сохраняемыми различиями personal/group. Проверить соответствие документа реальному call path; docs/entity-deletion-rollout.md должен описывать проверенный dry-run/apply/повтор/backup/откат без угадывания владельцев.

## 5. Полная проверка и журнал

- [x] 5.1 Запустить affected tests, `npm run test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npm run build`, scoped ESLint/Prettier без массового --fix, `git diff --check`, `openspec validate add-group-budget-plans --strict --no-interactive`. Независимо проверить совместимость/migration/права/финансовую атомарность; исправить существенные замечания, сопоставить все delta-сценарии и записать точные suites/tests/exit codes.
- [x] 5.2 Заполнить docs/family-budget-roadmap.md общими механизмами, миграционным evidence на disposable DB, результатами проверки/ревью и ограничением live API. Проверить 18/18 задач и отсутствие change этапа 09; не отмечать непроведённые проверки успешными.

## Workflow follow-up

- После реализации/проверок/ревью создать первый коммит без co-authored. Затем sync group-budget-plans и budget-ownership с сохранением authored Purpose и прежних сценариев, архивировать change и создать второй коммит архива.
- Проверить main specs обычной валидацией и changes=[], записать commit/дату/путь в roadmap. Не сокращать unrelated требования ради strict-предупреждений.
- Далее отдельно спланировать этап 09 — общие долги; не переносить его решения в этот change.
