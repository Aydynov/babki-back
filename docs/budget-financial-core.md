# Общие механизмы финансов

Контракт рефакторинга: `openspec/changes/archive/2026-10-17-unify-budget-financial-core/design.md`. Владельцем счёта, операции, категории и лимита служит BudgetContext (`ownerType`, `ownerId`), автор действия передаётся отдельно. Личные записи сохраняют legacy userId; сериализация personalResponse скрывает внутренние поля. Групповые полномочия проверяются через актуальное членство и effective permissions, не JWT claims.

## Сохраняемые различия

| Поведение       | Личный бюджет                                             | Групповой бюджет                                                    |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Счета           | несколько balance/saving, name/currency, defaultAccountId | несколько balance/saving, явные name/currency; без defaultAccountId |
| Остаток         | сохранённые snapshots + дельта операции                   | initialAmount + активный ledger до даты                             |
| Месячный снимок | существующее начало месяца/сохранённые даты               | конец месяца UTC                                                    |
| Деньги          | точность валюты, прежнее округление                       | точность валюты через общие money utilities                         |
| Расход          | populated category, внутренние поля скрыты                | category id, createdBy/participantId                                |
| Лимит           | currency, populated category, PATCH total                 | currency, PATCH total/даты, UTC                                     |

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

ReportsService строит PeriodReport для обоих бюджетов: общие owner-scoped агрегации, currency totals и DTO. GroupReportsService проверяет доступ, категории и UTC-периоды и вызывает общий сервис. Политика остатка различается: группа использует balanceForBudget/ledger, личный бюджет — прежние snapshots. Отчёты групп суммируют saving-счета в saving, balance-счета в balance, включая архивные; transfersIn/transfersOut учитывают стороны переводов в их валютах, saves отсутствует. Revenue и лимиты групп используют общие валютные агрегаты; rest лимита учитывает только ту же категорию и валюту.

## Проверка

Characterization: `test/budget-core-compatibility.e2e-spec.ts` и `test/budget-settings-compatibility.e2e-spec.ts`, дополнительно действующие compatibility, boundaries, concurrency, lifecycle, multicurrency, plans/debts и report-history suites. Права и отзыв с прежним JWT проверяются group-financial-management и group-permissions. Финальная проверка — полные unit/e2e на временных replica sets и build.

Этап 03 добавляет групповые валюты к существующим Account/Income/Expense/ExpenseLimit и общий построитель валютных отчётов. Этап 04 подключает несколько счетов, saving и общий rename/archive lifecycle. Этап 05 расширяет общие переводы на группу; планы добавлены этапом 08, долги остаются этапом 09.

## Переводы этапа 05

TransfersService предоставляет общие createForBudget/findAllForBudget/findOneForBudget/updateForBudget/deleteForBudget. Личные методы остаются адаптерами personalBudget/personalResponse, GroupTransfersService проверяет актуальное членство и author/owner/manageTransactions внутри BudgetWriteService.run. Одна Transfer discriminator-модель, обе существующие денежные стороны и общие account locks обслуживают оба бюджета; нового финансового CRUD/ledger нет.

Создание сохраняет запись до effects; PATCH сохраняет новые суммы, DELETE — deletedAt/deletedBy до группового rebuild. Обе стороны и последующие снимки меняются в одной ClientSession. balanceForBudget расширяет существующий owner-scoped aggregate: accountId или source/destination.accountId, source со знаком минус, destination со знаком плюс. Валютная нормализация каждого счёта и конец месяца UTC сохранены. Личный путь по-прежнему применяет дельту к сохранённым снимкам/carry и прежнюю проверку средств; групповой проверяет ledger на дату создания и только положительный extraDebit при PATCH.

TransactionsService использует общий filter builder для обеих сторон и AND-комбинаций account/currency; group mixed history использует тот же transferResponse/effectiveRate, что dedicated CRUD. Личные фильтры/сериализация сохранены. ReportsService.aggregateTransfers работает для user/group: source.amount в transfersOut, destination.amount в transfersIn соответствующих валют. Ни сторона, ни category-filter не превращает перевод в доход/расход; полные остатки включают архивные счета, удалённый перевод исключается.

Проверки: personal-transfer-compatibility (характеризация до рефакторинга), group-transfers (HTTP), group-transfer-ledger-reports (даты/снимки/отчёты/rollback), group-transfers-concurrency (обе последовательности конкурентных мутаций/прав/архива, RESTRICT). Ошибка второго эффекта create/PATCH/DELETE откатывает запись, оба счёта и цепочки снимков. Реальная база не сбрасывается.

В этапе 04 новые GroupAccountsQueryDto/RenameGroupAccountDto и маршруты служат адаптерами общих сервисов. GroupWalletService не рассчитывает balances и не хранит отдельную модель резерва. Архивирование, операции и отзыв полномочий сериализуются существующей group write-транзакцией; read-only история остаётся доступна. Смена имени архивного счёта допустима, финансовые create/PATCH/DELETE заморожены. Новые проверки: group-accounts-savings, group-account-lifecycle, group-savings-reports и расширенный seed e2e; личный календарь и snapshot carry сохранены.

## Исторические субъекты этапа 07

GroupFinancialActorsService один для GroupTransactionsService и GroupTransfersService: получает уже доступные owner-scoped строки, собирает уникальные createdBy/participantId и выбирает только active User с проекцией _id/firstName/lastName. Один $in на страницу, ноль запросов для пустой выдачи; query-параметр participantId сам по себе не разрешает профиль. Возвращаются новые DTO с createdByActor и expense-only participantActor, raw ссылки не подменяются. Личный финансовый CRUD, авторизация, денежные aggregate и каталог членов не меняются.

Read-декорация происходит после проверок доступа и пагинации; create/PATCH — внутри существующей BudgetWriteService транзакции с той же ClientSession. Ошибка identity lookup в мутации откатывает запись и денежные effects/снимки, включая обе стороны перевода. DELETE сохраняет прежний путь без lookup. Ошибка хранилища не маскируется под отсутствующий профиль.

Текущие имена активного профиля разрешаются и после выхода/исключения из группы. При deletion_pending/deleted или отсутствующем профиле возвращается стабильный userId, null-имена и isAnonymized=true; прежние имена не копируются и не кешируются. Worker удаления сохраняет tombstone и групповые ссылки, а resolver скрывает имена уже с начала pending, пока worker ещё не очистил их. Миграции/индексы не нужны. Этот же resolver предназначен для групповых адаптеров планов/долгов следующих этапов, без дублирования модели пользователя или механизма финансов.

## Общий Plan этапа 08

Одна Plan schema хранит immutable ownerType/ownerId/createdBy; userId остаётся только у личных записей. PlansService предоставляет createForBudget/listForBudget/getForBudget/updateForBudget/removeForBudget/archiveForBudget/closeForBudget. Мутации принимают supplied ClientSession; личные wrappers создают свою транзакцию и используют personalResponse. GroupPlansService проверяет актуальные права через BudgetAccess/GroupsAccess и вызывает общий сервис внутри BudgetWriteService.run. Контроллеры групп не обращаются к личным HTTP-маршрутам.

Общий executeClose создаёт расход через ExpensesService.createForBudget с origin=plan, затем CAS переводит active в closed, сохраняя planned amount и expenseId. Проверка совпадения валюты происходит после создания expense в той же транзакции; несовпадение откатывает все effects. Никакого nested commit или нового ledger. Группа сохраняет отрицательный остаток обычного расхода, личный путь — прежний snapshot carry. Автор расхода — исполнитель, автор плана неизменяем; права расхода независимы.

Групповой detail читает архив, личный detail по-прежнему исключает его; групповой PATCH строгий/непустой, личные nullable/empty/archive quirks сохранены characterization. Личный минимум DTO 0.01 сохранён, общий schema min=0 позволяет групповой положительный minor unit KWD 0.001; shared money validation обеспечивает точность и положительность группы. Group list добавляет _id DESC для стабильной пагинации. Actor resolver принимает Plan без type, participant относится только к expense.

Общий category RESTRICT включает планы обоих бюджетов, в том числе архивные. Worker очищает только ownerType=user/ownerId после backfill; групповые createdBy-ссылки не являются владением. Integrity audit проверяет Plan owner/creator, бюджет category/expense и обратный origin; soft-deleted expense остаётся допустимой историей. PlansModule дожидается createIndexes до HTTP; сохранены личные индексы, добавлены owner-scoped индексы с _id, повторный запуск не удаляет индексы. Backfill выполняется отдельной maintenance-командой, не при старте и не через destructive seeds; порядок описан в entity-deletion-rollout.md.
