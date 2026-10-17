# Tasks

## 1. Валютная идентичность счёта и остатки

- [x] 1.1 Добавить failing HTTP-регрессии создания счёта с обязательными name/currency, trim/uppercase, неподдерживаемым кодом, JPY/RUB/KWD precision и разными defaultCurrency участников; проверить, что до реализации новые сценарии падают по отсутствующему контракту.
- [x] 1.2 Расширить Group create-account DTO и общий AccountsService.createForBudget; сохранить singleton/permissions/openedAt/atomicity. Проверить новые тесты и старые create/delete/concurrent wallet сценарии.
- [x] 1.3 Заменить fixed2 в групповых ledger/snapshots на общие money utilities по валюте счёта; проверить KWD opening 0.001, доход 0.002, backdated пересчёт, баланс до открытия и сохранность личного snapshot carry тестами budget-core-compatibility.
- [x] 1.4 Обновить фабрики групповых счетов и существующие dev seeds явными name/currency; описать новый запрос и пересоздание только dev-данных в docs/group-finances-api.md. Проверить seed-тесты, отсутствие currency-less fixtures и расхождений примеров с DTO.

## 2. Общие денежные операции и суммы

- [x] 2.1 Добавить failing create/PATCH/e2e для KWD 0.001, JPY/RUB excess precision, item.price, запрета клиентской currency и неизменности данных после 400; проверить ожидаемые исходные failures.
- [x] 2.2 В общих incomes/expenses/transactions путях сохранять currency счёта и валидировать amount/price на create/PATCH в той же ClientSession; снять групповые fixed2/0.01 ограничения минимальным переиспользованием DTO и схемы items, сохранив личный item DTO. Проверить новые тесты, точную компенсацию edit/delete и permissions/изоляцию.
- [x] 2.3 Добавить currency в групповые history/revenue query и подключить общие валютные агрегаты вместо отдельного scalar fixed2. Проверить сортировку корзин, 0/одна сумма/null, пагинацию, participantId/category/date/account filters и неподдерживаемый код; межвалютный null проверить на уровне общего агрегатора без открытия второго группового счёта через API.
- [x] 2.4 Обновить docs/group-finances-api.md: currency read-only в операциях, precision, items, фильтры, revenue и optional date поля; проверить примеры успешных запросов/400 и пустого revenue против HTTP-тестов.

## 3. Валютные лимиты

- [x] 3.1 Добавить failing e2e для обязательной currency, JPY/KWD total, разных валют одной категории, currency-filter, immutable currency и использования только совпадающей валюты; проверить исходные failures.
- [x] 3.2 Расширить общие ExpenseLimitsService create/update/query/usage/overlap и групповые DTO; сохранить category lock, период UTC и права. Проверить новые тесты, update-overlap 409 и гонку двух одинаковых валютных лимитов, допускающую ровно одну запись.
- [x] 3.3 Обновить тестовые/dev лимиты и раздел API с currency/used/remaining и пересечениями; проверить seed/settings compatibility, лимит без счёта нужной валюты и документированные запросы.

## 4. Общий построитель валютных отчётов

- [x] 4.1 Добавить failing HTTP-тесты нового monthly/yearly контракта: пустая группа, счёт без движений, три minor units, UTC-границы года/месяца, initialAmount/openedAt, история прежних периодов и category filter с полным балансом; подтвердить failures старого плоского ответа.
- [x] 4.2 Расширить существующий ReportsService общим BudgetContext-путём для агрегаций/DTO; оставить group адаптеру доступ/UTC/categories, ledger-остатки брать через общий snapshot сервис; настроить экспорт/импорт ReportsModule. Проверить новые group report тесты и personal report-history/multicurrency без смены личных defaults/snapshots.
- [x] 4.3 Удалить заменённые копии групповой отчётной арифметики/неиспользуемые плоские типы, подтвердить общий путь обоих бюджетов чтением diff и тестами двух групп + личного бюджета, бывших участников, архивных категорий и чужого category ID.
- [x] 4.4 Обновить docs/group-finances-api.md и docs/budget-financial-core.md: точный PeriodReport, нулевые saving/transfers, отсутствие saves, UTC/defaults/empty/category rules и breaking-переход фронта. Сопоставить JSON-примеры с e2e; обновить старые плоские assertions, сохранив их бизнес-проверки.

## 5. Интеграционная проверка и фиксация результата

- [x] 5.1 Запустить `npm run test -- --runInBand`, `npm run test:e2e -- --runInBand` и `npm run build`; записать exit codes и фактические suites/tests в дорожную карту. Проверить общую изоляцию, гонки, lifecycle и личные multicurrency/report-history сценарии на временной MongoDB replica set.
- [x] 5.2 Проверить форматирование и ESLint затронутых TS без массового --fix, `git diff --check`, `openspec validate add-group-currencies-and-report-contract --strict --no-interactive`; сопоставить каждый delta-сценарий с проверкой и устранить существенные замечания ревью. Результаты и ограничения записать в дорожную карту.
- [x] 5.3 Зафиксировать применение в docs/family-budget-roadmap.md: общие механизмы, breaking-контракт, обновлённые fixtures, отсутствие миграции по решению пользователя и следующее действие. Проверить, что этап 04 ещё не создан, а незавершённые проверки не отмечены успешными.

## Workflow follow-up

- После завершения tracked tasks синхронизировать три delta specs с main specs, сохранив все прежние сценарии; архивировать change штатным workflow и записать фактический путь/дату в дорожную карту.
- Проверить архив, каталог main specs и отсутствие активного change этапа 03. Учитывать прежние unrelated strict-предупреждения длины main requirements, не сокращать их ради проверки.
- Только затем перейти к планированию этапа 04 — несколько счетов и saving.
