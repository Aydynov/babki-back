# Общие механизмы финансов

Контракт рефакторинга: `openspec/changes/archive/2026-10-17-unify-budget-financial-core/design.md`. Владельцем счёта, операции, категории и лимита служит BudgetContext (`ownerType`, `ownerId`), автор действия передаётся отдельно. Личные записи сохраняют legacy userId; сериализация personalResponse скрывает внутренние поля. Групповые полномочия проверяются через актуальное членство и effective permissions, не JWT claims.

## Сохраняемые различия

| Поведение | Личный бюджет | Групповой бюджет |
| --- | --- | --- |
| Счета | несколько balance/saving, name/currency, defaultAccountId | несколько balance/saving, явные name/currency; без defaultAccountId |
| Остаток | сохранённые snapshots + дельта операции | initialAmount + активный ledger до даты |
| Месячный снимок | существующее начало месяца/сохранённые даты | конец месяца UTC |
| Деньги | точность валюты, прежнее округление | точность валюты через общие money utilities |
| Расход | populated category, внутренние поля скрыты | category id, createdBy/participantId |
| Лимит | currency, populated category, PATCH total | currency, PATCH total/даты, UTC |

Общий механизм не заменяет личные снимки replay операций: прежний перенос может содержать начальные и исторические корректировки. Групповой amount нельзя брать из последнего месячного снимка: он может включать будущие операции. Схемы и данные сохраняются. HTTP снимков остаётся только для чтения.

## Сессии и зависимости

Внешний финансовый вызов владеет транзакцией. Вложенные вызовы из PlansService.close, DebtsService.repay и личных переводов используют ту же ClientSession; они не должны её завершать или запускать вложенный commit. Группа сериализуется перед проверкой разрешений и блокировками счетов/категорий. Личные блокировки счетов и категорий сохраняются.

BudgetsModule предоставляет доступ и координацию, не импортируя AccountsModule/TransactionsModule/GroupFinancesModule. Общие операции остаются в owning-domain services; групповые сервисы служат адаптерами. TransactionsModule использует model/helper категории и не импортирует зависящий от него ExpenseCategoriesModule.

## Доменные входы

- AccountsService: `createForBudget`, `listForBudget`, `getForBudget`, `removeForBudget`. Личные create/find/delete остаются совместимыми входами, group wallet делегирует этим методам; права и внешняя групповая транзакция проверяются адаптером. Общий history query включает обе стороны переводов и удалённые операции. Общие renameForBudget/archiveForBudget и lifecycle lock обслуживают обоих владельцев; очистка defaultAccountId остаётся личной.
- AccountsSnapshotsService: `openingForBudget`, `prepareForBudget`, `applyForBudget`, `balanceForBudget`, `rebuildForBudget`, `deleteForBudget`; личные legacy-методы сохраняются для внутренних потребителей. Ledger rebuild используется группой; личный путь переносит/изменяет сохранённые снимки. `balanceForBudget` читает на дату, а личный DTO amount сохраняет прежний выбор снимков/timeline, включая существующий toDate-контракт.
- TransactionsService: общий owner-scoped get/list/filter/revenue, запись/изменение/логическое удаление и effects; IncomesService/ExpensesService выполняют typed доменные команды. Групповой адаптер только проверяет доступ, авторство/атрибуцию и допустимость назначения. Общие mutation lookup/locks требуют активный счёт для обоих бюджетов; read/filter истории сохраняет архивные счета.
- ExpenseCategoriesService/ExpenseLimitsService: `createForBudget`, `findAllForBudget`, `findOneForBudget`, `updateForBudget`, `removeForBudget`; общий `lockBudgetExpenseCategory` и `findExpenseUsage`. GroupSettingsService не выполняет MongoDB CRUD или собственную денежную агрегацию.

Личные категории исключают архивные записи из списка, групповые сохраняют их в выдаче. Личный PATCH лимита изменяет только total, групповой также даты. Личный расчёт использования сохраняет существующее преобразование endDate через `.toString()` (с потерей миллисекунд); исправление этой границы относится к отдельному изменению поведения. Группа использует прежние включительные UTC-границы. Общая блокировка категории может увеличивать внутренний mutationVersion; это счётчик сериализации, не финансовая величина или новая возможность API.

## Валютный контракт этапа 03

Валюта неизменяема на счёте и наследуется операцией; initialAmount, amount, item.price, лимиты и групповые ledger/snapshots используют общие money utilities. Фиксированная точность 2 исключена из группового денежного пути. Личные DTO сохраняют прежние границы item.price/amount.

ReportsService строит PeriodReport для обоих бюджетов: общие owner-scoped агрегации, currency totals и DTO. GroupReportsService проверяет доступ, категории и UTC-периоды и вызывает общий сервис. Политика остатка различается: группа использует balanceForBudget/ledger, личный бюджет — прежние snapshots. Отчёты групп суммируют saving-счета в saving, balance-счета в balance, включая архивные; transfersIn/transfersOut=0, saves отсутствует. Revenue и лимиты групп используют общие валютные агрегаты; rest лимита учитывает только ту же категорию и валюту.

## Проверка

Characterization: `test/budget-core-compatibility.e2e-spec.ts` и `test/budget-settings-compatibility.e2e-spec.ts`, дополнительно действующие compatibility, boundaries, concurrency, lifecycle, multicurrency, plans/debts и report-history suites. Права и отзыв с прежним JWT проверяются group-financial-management и group-permissions. Финальная проверка — полные unit/e2e на временных replica sets и build.

Этап 03 добавляет групповые валюты к существующим Account/Income/Expense/ExpenseLimit и общий построитель валютных отчётов. Этап 04 подключает несколько счетов, saving и общий rename/archive lifecycle. Переводы, планы и долги остаются последующим этапам.


В этапе 04 новые GroupAccountsQueryDto/RenameGroupAccountDto и маршруты служат адаптерами общих сервисов. GroupWalletService не рассчитывает balances и не хранит отдельную модель резерва. Архивирование, операции и отзыв полномочий сериализуются существующей group write-транзакцией; read-only история остаётся доступна. Смена имени архивного счёта допустима, финансовые create/PATCH/DELETE заморожены. Новые проверки: group-accounts-savings, group-account-lifecycle, group-savings-reports и расширенный seed e2e; личный календарь и snapshot carry сохранены.
