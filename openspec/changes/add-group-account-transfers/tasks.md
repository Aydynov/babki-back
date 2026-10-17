# Tasks

## 1. Общий перевод и групповой денежный контракт

- [x] 1.1 До переноса добавить characterization личных transfer create/PATCH/DELETE и source funds с историческим snapshot carry; проверить их на прежнем сервисе. Добавить failing group transfer HTTP-тесты отсутствующих маршрутов, same/cross-currency и обоих открытий; подтвердить исходные failures.
- [x] 1.2 Расширить существующий TransfersService budget-scoped create/list/get/update/delete, сохранив личные обёртки/DTO/snapshot effects; подключить групповые DTO/маршруты через тонкий адаптер BudgetWriteService. Проверить новые HTTP-тесты и личные transfer regressions, без новых моделей или второго CRUD-движка.
- [x] 1.3 Проверить group create/PATCH validation: JPY/RUB/KWD minor units, положительность после нормализации, конечные числа, обе суммы и same-currency равенство, пустой/null/unknown PATCH, неизменяемые счета/валюты/дата, оба openedAt. Сначала подтвердить failing проверки нового поведения, затем обеспечить 400 без изменения записи/денег.
- [x] 1.4 Реализовать group source funds на transactionDate и extraDebit при увеличении суммы в общей сессии; проверить точный граничный остаток, backdated дату с достаточным текущим и недостаточным историческим остатком, concurrent overdraft, уменьшение/description-only и отмену после расходования destination. Личные проверки/снимки должны пройти прежние characterization tests.
- [x] 1.5 Описать routes/DTO/statuses/effectiveRate/funds/отмену/повторы в docs/group-finances-api.md; сверить JSON-примеры с HTTP-тестами. Уточнить Purpose main account-transfers для переводов одного бюджета при применении, сохранив остальные specs до финального sync.

## 2. Обе стороны в ledger и snapshots

- [x] 2.1 Добавить failing проверки group ledger/snapshots обеих сторон: create, смена двух сумм, delete, backdated и последующие периоды; подтвердить отсутствие transfer effects в прежнем aggregate. Расширить существующий balanceForBudget/rebuild по source/destination, сохранив normal income/expense и личный carry; проверить ожидаемые остатки и month-end снимки.
- [x] 2.2 Сохранить update/delete записи до группового rebuild в одной ClientSession; проверить rollback записи и обоих счетов при ошибке сохранения/второго эффекта. Проверить реальный Transfer как историческую зависимость удаления каждого счёта, включая удалённый перевод, и отсутствие обхода через общий маршрут удаления transactions.
- [x] 2.3 Обновить docs/budget-financial-core.md порядком записи/rebuild и сохранённой личной delta-политикой; проверить соответствие документа фактическому shared call path и пройденным balance/session regression tests.

## 3. Права, история и конкурентные изменения

- [x] 3.1 Добавить проверки create любым членом, server author без participantId, author/owner/manageTransactions PATCH/DELETE, departed author, permissions настроек без чужих прав и revoke с прежним JWT. Подключить существующий memberContext/effective permissions и group serialization; проверить 401/403/404 и сохранённые createdBy/deletedBy.
- [x] 3.2 Добавить transfer в групповую общую историю, общий filter builder и response mapper: обе стороны accountId/currency, AND-комбинации, период/type, стабильная пагинация и effectiveRate без двойной записи. Проверить personal + две группы, foreign/archived ссылки, исторического автора и сохранение прежних личных filters/serialization; расходы/revenue/лимиты не должны включать transfers.
- [x] 3.3 Добавить explicit-barrier concurrency проверки edit/delete, delete/delete, source/destination archive vs create/PATCH/DELETE и revoke/remove/ownership/group deletion vs mutation; проверить обе последовательности, отсутствие двойной компенсации/частичных snapshots и 404 повторного DELETE. Повторный успешный POST при достаточных средствах создаёт второй _id; при недостатке средств второй получает 400.
- [x] 3.4 Дополнить docs/group-finances-api.md фильтрами любой стороны, общим/dedicated DTO, авторством, archive freeze и retry semantics; сопоставить все описанные cases с тестами, явно сохранить межбюджетный запрет.

## 4. Общая отчётность и fixtures

- [x] 4.1 Добавить failing monthly/yearly проверки RUB balance1000→saving100 (balance900/saving100/transfersIn=100/transfersOut=100/incomes=expenses=0), межвалютного RUB90000→USD1000 и переводов balance↔balance/saving↔saving. Подключить существующий ReportsService.aggregateTransfers для группы; проверить сортировку валют и отсутствие дублирования.
- [x] 4.2 Проверить category-filter, archive, delete и backdated edit отчёта с полными остатками/движениями, неизменностью expense revenue/лимита и сохранением personal report-history/multicurrency. Обновить примеры отчётов и архитектурное описание согласно числовым проверкам.
- [x] 4.3 Расширить существующие dev seeds детерминированным внутригрупповым переводом, обновить ожидаемые остатки/отчёты и docs/group-finances-seed.md. Проверить seed e2e и одинаковый результат двух супругов; исходные расходы/доходы не заменять искусственными парами, миграцию/reset не добавлять.

## 5. Общая проверка и журнал

- [x] 5.1 Запустить `npm run test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npm run build`; записать exit codes и suites/tests, среду временных MongoDB replica sets и ограничения live API. Подтвердить personal transfer/history/lifecycle/defaults и групповые permissions/isolation/concurrency.
- [x] 5.2 Выполнить Prettier/ESLint затронутых файлов без массового --fix, `git diff --check`, `openspec validate add-group-account-transfers --strict --no-interactive`; провести ревью денежных effects/funds/прав/отчётов, исправить существенные замечания и сопоставить delta-сценарии с проверками.
- [x] 5.3 Заполнить docs/family-budget-roadmap.md результатами применения, переиспользованием общего сервиса, отсутствием миграции, рисками отката и проверками. Проверить все задачи и отсутствие активного change этапа 06; незапущенные проверки не отмечать успешными.

## Workflow follow-up

- После завершения tracked tasks сначала создать коммит реализации без co-authored (уточнение пользователя 2026-10-17). Только после этого синхронизировать четыре delta specs с main specs, сохранив все прежние сценарии и authored Purpose (кроме явно уточнённого при применении account-transfers); архивировать change, записать дату/путь и проверить отсутствие активного change этапа 05.
- Проверить main specs обычной валидацией, не сокращая unrelated требования ради strict-предупреждений длины.
- Затем перейти к отдельному планированию этапа 06 — предпросмотр приглашения. Переводы между разными бюджетами в этот этап не включать.
