# Tasks

## 1. Несколько счетов на общей модели

- [x] 1.1 Добавить failing HTTP-тесты нескольких balance/saving одинакового типа/валюты/имени, default type=balance, type/currency фильтров, изоляции личного и двух групповых бюджетов; подтвердить failure прежнего singleton/отсутствующего type.
- [x] 1.2 Расширить групповые create/list DTO и общий AccountsService.createForBudget/listForBudget, сняв singleton и сохранив валютные/openedAt проверки. Проверить новые тесты, concurrent create двух независимых счетов/снимков и личные account regressions.
- [x] 1.3 Обновить прежние singleton assertions на новый контракт, сохранив остальные бизнес-проверки; описать DTO, явный accountId, отсутствие defaultAccountId и фильтры в docs/group-finances-api.md. Проверить успешные запросы/400 и соответствие JSON-примеров HTTP-тестам.

## 2. Общий lifecycle и заморозка архива

- [x] 2.1 Добавить failing HTTP-регрессии rename/archive активных и архивных счетов, пустого/невалидного PATCH, immutable financial fields, повторного archive и сохранения read/history/revenue; подтвердить failures отсутствующих маршрутов/правил.
- [x] 2.2 Выделить общие renameForBudget/archiveForBudget/lifecycle lock в AccountsService, подключить групповые PATCH и POST archive через BudgetWriteService с manageAccounts. Проверить новые тесты и прежние личные rename/archive/defaultAccountId/delete сценарии без смены wire-контракта.
- [x] 2.3 Унифицировать active account lookup/locks финансовых мутаций для user/group; оставить read/filter lookup архивных счетов доступным. Проверить create/PATCH/DELETE 404 для архивных balance/saving, включая description/items/participantId, неизменность денег/лимитов и запрет для owner/author/delegate.
- [x] 2.4 Добавить проверки revoke/remove с прежним JWT, foreign account, archive vs create/PATCH/DELETE и delete vs use; подтвердить последовательный результат без частичных записей, 403/404 границы и атомарное удаление пустого архивного счёта/снимков. Запустить новые проверки и существующие group-finances-concurrency/accounts-deletion-concurrency.
- [x] 2.5 Обновить docs/group-finances-api.md и docs/budget-financial-core.md: 200/204/400/403/404/409, rename архивного счёта, frozen operations, read archive, отсутствие unarchive и прежний RESTRICT. Сопоставить каждый описанный ответ с тестами; проверить сохранение отчётов/лимитов при archive.

## 3. Прямые операции накоплений

- [x] 3.1 Добавить failing end-to-end сценарий двух участников со saving KWD: opening 0.001, доход 0.003, расход 0.005 → -0.001; проверить отдельность balance/личных денег, author/participant и права, а также учёт saving расхода в общем валютном лимите ровно один раз.
- [x] 3.2 Подключить saving к существующим финансовым сервисам через общий account type, без отдельного движка или искусственных transfer-пар. Проверить новые тесты, precision JPY/RUB/KWD create/PATCH/items, openedAt и компенсацию edit/delete активного saving; задокументировать прямые внешние доходы/расходы и допустимый отрицательный остаток.

## 4. Реальные накопления в общем отчёте

- [x] 4.1 Добавить failing monthly/yearly проверки нескольких счетов одной и разных валют, balance=120/saving=55 при incomes=10/expenses=5, archive, initialAmount/openedAt и category-filter; подтвердить failure прежнего group saving=0.
- [x] 4.2 Расширить общий ReportsService type totals на group saving, сохранив UTC ledger-политику группы и личный snapshot carry/календарь. Проверить новые тесты, отсутствие двойного счёта saving, валютную сортировку, archived историю и личные report-history/multicurrency regressions.
- [x] 4.3 Расширить существующие dev seeds вторым balance и saving; обновить seed-assertions, docs/group-finances-seed.md, примеры отчёта и архитектурную таблицу. Проверить seed e2e, доступ обоих супругов к резерву и совпадение документированных сумм с API; миграцию/reset существующей базы не добавлять.

## 5. Общая проверка и журнал

- [x] 5.1 Запустить `npm run test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npm run build`; записать точные exit codes и suites/tests. Подтвердить личные lifecycle/defaults/snapshot carry, групповые permissions/concurrency/изоляцию и новые счета на временной локальной MongoDB replica set.
- [x] 5.2 Проверить Prettier и ESLint затронутых файлов без массового --fix, `git diff --check`, `openspec validate add-group-accounts-and-savings --strict --no-interactive`; провести ревью общего lifecycle/отчётов, устранить существенные замечания и сопоставить delta-сценарии с проверками. Результаты и любые существующие unrelated failures записать явно.
- [x] 5.3 Обновить docs/family-budget-roadmap.md: применение, проверки, общие переиспользованные механизмы, отсутствие миграции, ограничения отката и следующее действие. Проверить полноту всех задач, отсутствие активного change этапа 05 и отсутствие отметок об успешных незапущенных проверках.

## Workflow follow-up

- После успешных проверок синхронизировать три delta specs с main specs, сохранив Purpose и все прежние сценарии; архивировать change и записать фактический путь/дату в дорожную карту.
- Проверить архив, отсутствие активного change этапа 04 и результат валидации main specs; не сокращать unrelated требования ради strict-предупреждений длины.
- Затем перейти к отдельному планированию этапа 05 — переводы внутри группы. Пока переводов нет, не обещать их в API/UI и не подменять парой доход/расход.
