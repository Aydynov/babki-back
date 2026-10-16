# Tasks

## 1. Зафиксировать совместимость до переноса

- [x] 1.1 Расширить group-finances-compatibility и профильные unit/e2e недостающими характеристиками текущих DTO: user/group create/read/list/update/delete income/expense, source, populated category, атрибуция, пагинация, ошибки, empty PATCH и immutable-поля. Запустить эти проверки на исходной реализации и сохранить успешный baseline; тесты проверяют результаты API, а не будущие имена методов.
- [x] 1.2 Добавить детерминированные проверки двух источников остатка: сохранённый личный snapshot с известным переносом, не совпадающим с ledger; групповой initialAmount/ledger/openedAt. Проверить create/edit/delete, 0.1/0.2/0.3, backdating, одинаковый месяц разных лет, future operations и timeline; подтвердить исходное зелёное состояние до рефакторинга.
- [x] 1.3 Создать `docs/budget-financial-core.md` с матрицей сохраняемых различий из design и известными потребителями ClientSession/origin; сверить описание с baseline-тестами и отметить отсутствие новой валютной модели/маршрутов.

## 2. Общий контекст, доступ и граница транзакции

- [x] 2.1 Перенести BudgetContext/pure owner helpers в нейтральный common/budget и BudgetAccessService в BudgetsModule; сохранить personalBudget/userId-совместимость. Unit и isolation e2e подтверждают полную пару ownerType/ownerId, серверного actorId и отсутствие fallback в другой бюджет; build подтверждает DI без циклов.
- [x] 2.2 Обобщить существующий GroupFinanceWriteService до BudgetWriteService и подключить групповой адаптер к нему, сохранив group.mutationVersion, timeout и 503. Проверить group-permissions, group-financial-management и group-finances-concurrency: отзыв/выход/исключение/ownership races остаются последовательными.
- [x] 2.3 Подключить личные финансовые входы к совместимой границе транзакций; вложенные create с переданной ClientSession не запускают/не закрывают чужую транзакцию. Проверить rollback и existing plan-debt-lifecycle, multicurrency transfer и unit с передачей session/origin; прежние personal HTTP-ошибки сохраняются.
- [x] 2.4 Обновить docs/budget-financial-core.md схемой зависимостей и владением сессией; ревью подтверждает, что BudgetsModule не импортирует AccountsModule/TransactionsModule/GroupFinancesModule, а проверка приложения запускает все providers.

## 3. Общий механизм снимков и влияния операций

- [x] 3.1 Добавить в AccountsSnapshotsService owner-scoped внутренние методы чтения/создания и общую typed модель влияния income/expense (create/edit/delete). Unit-тесты с независимыми ожидаемыми числами и e2e baseline подтверждают знак, дельту, precision и изоляцию; Snapshot остаётся связанным со счётом, схема/индексы не меняются.
- [x] 3.2 Подключить личные операции и personal transfer к общему механизму, сохранив инкрементальные обновления, старые snapshot dates, перенос сумм, валютное `$round` и два transfer effects. Проверить snapshot baseline, multicurrency, personal-report-history и accounts-deletion-concurrency без пересоздания данных.
- [x] 3.3 Перенести group balance/rebuild/snapshotId в тот же AccountsSnapshotsService с явной ledger-веткой, удалить дублирующую арифметику и snapshot-запросы из GroupWalletService/GroupTransactionsService. Проверить group-finances-boundaries/concurrency и baseline: current amount, month-end UTC, отрицательные остатки, исторический пересчёт и rollback совпадают.
- [x] 3.4 Обновить docs/budget-financial-core.md: оба источника истории, почему group end-of-month нельзя использовать как current amount и почему personal snapshots нельзя заменить replay. Ревью и characterization-тесты подтверждают отсутствие миграции/изменения дат и сумм.

## 4. Общие доменные операции счетов

- [x] 4.1 Ввести в AccountsService общие budget-aware create/read/list и подключить личные/групповые входы; GroupWalletService остаётся адаптером. Проверить personal multiple balance/saving/name/currency/defaultAccountId и group singleton balance/openedAt/initialAmount/409; формы ответа, сортировка и timeline прежние.
- [x] 4.2 Объединить history check и удаление неиспользованного счёта/технических snapshots; сохранить личные rename/archive/clearDefaultAccount в тех же транзакциях без группового archive API. Проверить доход/расход и обе стороны активного/удалённого personal transfer, initialAmount, concurrent deletion/archive; ошибка не оставляет частично удалённых записей.
- [x] 4.3 Дополнить архитектурную документацию общими account-входами и личными/групповыми ограничениями; affected e2e и build подтверждают, что новые group saving, rename, archive и валютные поля не появились.

## 5. Общие доходы, расходы и история

- [x] 5.1 Объединить в TransactionsService owner-scoped get/list/filter и выборки активной финансовой истории; сохранить конкретные фильтры и response-адаптеры. Unit/e2e подтверждают сортировку/пагинацию, personal account/snapshot transfer-фильтры, group participantId и исторических участников, различия personal currency revenue и group scalar revenue.
- [x] 5.2 Перевести создание личных/групповых доходов на один доменный метод IncomesService и расходы — на один метод ExpensesService, с общими проверками ссылок/записью моделей/снимками. Проверить income source, expense merchant/items/category, createdBy/participantId, origin и same-session plan/debt integrations; текущие discriminator registrations сохранены.
- [x] 5.3 Объединить edit/soft-delete и расчёт old/new влияния, оставив явные политики user/group. Group-financial-management/group-permissions и characterization проверяют owner/author/attributed/manageTransactions, переназначение, immutable-поля, бывших авторов, авторство/deletedBy, повторное удаление и компенсацию ровно один раз.
- [x] 5.4 Удалить из GroupTransactionsService самостоятельную работу записи с моделями и пересчёта денег; оставить преобразование HTTP-команд и групповую политику. Обновить архитектурный документ, запустить compatibility/isolation/concurrency и проверить конечный call path обоих бюджетов к общей реализации.

## 6. Общие категории и лимиты

- [x] 6.1 Обобщить category lookup/lock helper на BudgetContext и подключить текущие личные вызовы (включая планы) и групповые операции. Проверить archive/new assignment, historic assignment, cross-budget 404 и category-deletion-concurrency; группы продолжают сериализоваться до блокировки категорий.
- [x] 6.2 Расширить ExpenseCategoriesService общими budget-aware create/read/update/delete и подключить GroupSettingsService. Проверить уникальность в бюджете, запрет удаления со ссылками active/deleted expenses, limits и существующие personal plans; доступ manageCategories и прежние DTO/ошибки сохранены.
- [x] 6.3 Объединить общую выборку расходов/использования лимита и budget-aware доменные операции ExpenseLimitsService, подключить GroupSettingsService. Проверить personal currency/populated category/total-only PATCH и прежние date-fns периоды против group scalar/two-decimal/UTC/date PATCH; overlap, archive category, departed participants и revenue ошибки не меняют смысл.
- [x] 6.4 Удалить дублирующие запросы/запись категорий и лимитов из GroupSettingsService, дополнить docs/budget-financial-core.md правилами периода/валюты. Affected unit/e2e подтверждают одинаковые прежние ответы и отсутствие новой group currency либо дополнительных прав у manageTransactions.

## 7. Завершить интеграцию и проверить весь контур

- [x] 7.1 Проверить и убрать временные forwarding-экспорты/неиспользуемые providers и дубли, сохранив необходимые совместимые personal service-входы для plans/debts/transfers/reports/seed/user-deletion. Архитектурное ревью подтверждает общие доменные пути обоих бюджетов, отсутствие циклов, новых зависимостей, schema/index migration и параллельного финансового движка.
- [x] 7.2 Выполнить `npm run test -- --runInBand`, `npm run test:e2e -- --runInBand` на временных replica sets и `npm run build`; все команды завершаются exit code 0. Зафиксировать counts, skip/failure и ограничения среды в этапе 02 дорожной карты; прежние результаты этапа 01 не считать проверкой этого change.
- [x] 7.3 Выполнить ESLint затронутых TS-файлов без широкого автоматического исправления, `git diff --check` и `openspec validate unify-budget-financial-core --strict --no-interactive`; подтвердить успех. Проверить diff: main specs, DTO/контроллеры, финансовые данные и фичи будущих этапов не изменены.
- [x] 7.4 Провести независимое ревью реализации против design/characterization, исправить существенные замечания и повторить затронутые проверки; обновить docs/budget-financial-core.md и docs/family-budget-roadmap.md по фактическому результату. Все задачи закрыть только после выполнения, архивирование оставить следующим действием.

## Workflow follow-up

- Архивировать завершённый и проверенный change. `skip_specs: true` означает отсутствие delta и синхронизации main specs; не создавать требования об устройстве внутренних классов.
- Проверить 0 активных задач текущего change, фактический архив и неизменность основных спецификаций; записать дату/путь в этап 02 дорожной карты.
- Перейти к этапу 03 `add-group-currencies-and-report-contract`: перед его proposal согласовать валютную модель, лимиты, совместимость ответов отчётов и назначение валюты существующим групповым данным.
