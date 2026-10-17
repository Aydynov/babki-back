# Семейный бюджет: дорожная карта backend

Дата: 2026-10-17. Источник требований: [family-budget-backend-gaps.md](../family-budget-backend-gaps.md), разделы 1–10.

Цель: супруги совместно управляют семейным бюджетом, включая счета, накопления, переводы, планы и долги, сохраняя независимые личные бюджеты. Фронт получает явный денежный контракт и актуальные права доступа.

Режим согласован: сейчас дорожная карта и **один первый полноценный change**. Последующие change создаются по очереди после применения, тестирования и архивирования предыдущего. Документ — постоянный журнал прогресса между чатами; наличие плана не означает реализацию.

## Текущая точка

- Завершены этапы **01 — финансовые права**, **02 — общие механизмы финансов** **03 — валюты и отчёты** и **04 — несколько счетов и накопления**, и **05 — переводы внутри группы**, и **06 — предпросмотр приглашения**, и **07 — исторические авторы и участники**, и **08 — общие планы**, и **09 — общие долги**, все девять циклов закрыты.
- Архив: [add-group-financial-management-permission](../openspec/changes/archive/2026-10-17-add-group-financial-management-permission/proposal.md).
- Архив этапа 02: [unify-budget-financial-core](../openspec/changes/archive/2026-10-17-unify-budget-financial-core/proposal.md). Архив этапа 03: [add-group-currencies-and-report-contract](../openspec/changes/archive/2026-10-17-add-group-currencies-and-report-contract/proposal.md). Архив этапа 04: [add-group-accounts-and-savings](../openspec/changes/archive/2026-10-17-add-group-accounts-and-savings/proposal.md). Архив этапа 05: [add-group-account-transfers](../openspec/changes/archive/2026-10-17-add-group-account-transfers/proposal.md). Архив этапа 06: [add-group-invitation-preview](../openspec/changes/archive/2026-10-17-add-group-invitation-preview/proposal.md). Архив этапа 07: [resolve-group-historical-actors](../openspec/changes/archive/2026-10-17-resolve-group-historical-actors/proposal.md). Архив этапа **08: общие планы** — [add-group-budget-plans](../openspec/changes/archive/2026-10-18-add-group-budget-plans/proposal.md). Реализация, проверка и архив завершены. Архив этапа 09 — [add-group-budget-debts](../openspec/changes/archive/2026-10-18-add-group-budget-debts/proposal.md), реализация, проверки и архив завершены; следующий этап —10, финальная сверка, по отдельной команде.
- Этап 05 реализован, проверен, зафиксирован коммитом до архивирования; цикл закрыт. Этап 06 реализован, проверен, закоммичен до архивирования; архив закреплён коммитом `08bea63`. Этап 07 реализован, проверен и закоммичен до архивирования; архив зафиксирован коммитом `980c7b5`. Этап 08 реализован и проверен, коммит реализации `6358dd4` создан до sync/архивирования; цикл закрыт отдельным коммитом архива. Этап 09 реализован и проверен; коммит `6c4a080` создан до sync/архива, цикл закрыт отдельным коммитом архива. Этап 10 запланирован, его OpenSpec-артефакты не созданы.
- Этапы 01–09 реализованы и проверены локальными unit/e2e; backfill этапов 08/09 проверен только на disposable DB, рабочая база и развёрнутый API не затрагивались.

Этапы 01–02 зафиксированы коммитом `d1176da` — `Unified budget finances and added transaction permissions`.

## Сквозное архитектурное требование

По уточнению пользователя использовать общие финансовые механизмы для человека и группы, а не развивать отдельные копии доменных сущностей и арифметики.

Уже существуют общие Account/Transaction, категории и лимиты с `ownerType/ownerId`, `BudgetContext`, `personalBudget`, `personalResponse`, денежные утилиты и discriminator-модели. Однако личные и групповые сервисы счетов/операций/отчётов расходятся; Plan/Debt пока требуют `userId`. Это исходная точка, а не требование всё переписать.

- Общий владелец бюджета: `user | group`; автор действия — отдельная идентичность. Владение и авторство назначает сервер, не DTO клиента.
- Общие модели и прикладные операции: счёт, снимки, доход/расход, перевод, категория, лимит, отчёт, план, долг. Переиспользовать существующие схемы и Mongoose discriminators.
- Общие механизмы: точность денег, расчёт и пересчёт остатков, привязки, проверки активного счёта, архивирование/удаление, атомарные связанные действия. Одна реализация каждого общего правила.
- Различающиеся политики доступа и допустимого поведения передаются явно через контекст/небольшие доменные методы. Не вводить универсальный CRUD-фреймворк, плагины или фиктивные абстракции ради симметрии.
- Контроллеры могут оставаться личными и групповыми адаптерами. Существующие личные URL, формы ответов и правила сохраняются; публичное объединение маршрутов не требуется.
- Не переносить личные правила в группу неявно: отрицательный групповой баланс допустим, личный defaultAccountId остаётся личным, права группы проверяются по актуальному членству.
- Для каждого change design должен назвать, какой существующий механизм расширяется. Ревью проверяет, что нет новой параллельной финансовой реализации.
- Безопасность транзакций общая, но блокировка группы при отзыве прав/исключении дополняет блокировки счетов; универсализация не должна потерять ни одну гарантию.

## Порядок и зависимости

| №   | Планируемый change                          | Результат                                                         | Требует                       | Пробелы источника                |
| --- | ------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- | -------------------------------- |
| 01  | `add-group-financial-management-permission` | manageTransactions, собственные permissions                       | —                             | §2, §9.1, часть §10              |
| 02  | `unify-budget-financial-core`               | общие механизмы действующих финансов без смены внешнего поведения | 01                            | сквозное требование пользователя |
| 03  | `add-group-currencies-and-report-contract`  | явные валюты, миграция, валютные корзины отчётов                  | 02                            | §1, §3                           |
| 04  | `add-group-accounts-and-savings`            | несколько счетов balance/saving, жизненный цикл, учёт накоплений  | 03                            | §4, дополнение §3                |
| 05  | `add-group-account-transfers`               | атомарные переводы между счетами группы и их отчётность           | 04                            | §5, дополнение §3                |
| 06  | `add-group-invitation-preview`              | безопасный предпросмотр без вступления                            | 01; в очереди после 05        | §8                               |
| 07  | `resolve-group-historical-actors`           | имена/обезличивание исторических субъектов                        | 01; в очереди после 06        | §9.2                             |
| 08  | `add-group-budget-plans`                    | общая модель планов для user/group и исполнение                   | 03–05; в очереди после 07     | §6                               |
| 09  | `add-group-budget-debts`                    | общая модель долгов для user/group и погашение                    | 03–05, 07; в очереди после 08 | §7                               |
| 10  | `verify-family-budget-contract`             | финальная сверка контрактов и семейного сценария                  | 01–09                         | §10 и приёмка §1–9               |

Зависимость и порядок очереди различаются: preview технически можно сделать раньше, но по умолчанию работа последовательна. Для изменения очереди обновить этот документ и причину. Этап 02 добавлен перед расширением финансов, чтобы новые групповые возможности строились на общих механизмах. Оба P0 закрываются этапами 01–03; последующие этапы добавляют полноту сценария.

## Единый цикл каждого этапа

1. Прочитать этот документ и журнал последнего этапа; проверить `openspec list --json`, состояние кода и main specs после прошлого архива.
2. Создать только следующий change. Согласовать перечисленные для него продуктовые решения до окончательной спецификации. Подготовить proposal/design/delta specs/tasks; для чистого рефакторинга или документации без изменения поведения использовать `skip_specs: true`, а не выдумывать требования.
3. Валидировать change; отметить «Создан» только при готовности всех требуемых артефактов. Новые задачи оставить незакрытыми.
4. По запросу на применение реализовать change, обновлять его tasks.md, прикладывать тесты и документацию вместе с поведением. Не выдавать будущие API за доступные.
5. Проверить affected unit/e2e и `npm run build`. Для межмодульных изменений выполнить `npm run test -- --runInBand` и `npm run test:e2e -- --runInBand`. Финансовую конкурентность проверить на MongoDB replica set. Сохранить точные команды, результаты и ограничения.
6. Закрыть проверку только после фактического успеха; недоступная среда, пропущенная проверка или неуспешный тест оставляют этап открытым. Ревью проверяет приёмку и переиспользование механизмов.
7. Архивировать завершённый change с синхронизацией main specs, проверить результат и `openspec validate --specs --strict --no-interactive`. Старые архивы не переписывать. Записать реальный путь архива и дату.
8. Отметить архивирование, обновить «Текущую точку» и только затем переходить к следующему change. Завершённые тесты сами по себе не означают архивирование.

Документация и миграции входят в каждый затрагивающий их этап; этап 10 — финальная интеграционная сверка, а не отсрочка документации до конца.

## 01. Финансовые права и текущий контекст

- [x] Создан полноценный change.
- [x] Применён; tasks.md завершён.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы, путь записан.

Объём: независимое manageTransactions; все четыре effective permissions в ответах группы; чужие доходы/расходы и переназначение; аудит, сброс, отзыв с прежним JWT. Владелец остаётся единственным; административные возможности не делегируются этим правом. Права будущих переводов/планов/долгов подключаются позже.

Приёмка: уполномоченная супруга исправляет чужую операцию; после отзыва право перестаёт действовать с тем же JWT, а собственные операции остаются доступны. Чужой бюджет недоступен, финансовые итоги атомарны.

Журнал планирования: 2026-10-17 — подготовлены proposal, design, две delta-спецификации и tasks; status — 4/4 planning artifacts complete; strict validate — valid, exit code 0.

Журнал применения (2026-10-17):

- Реализованы manageTransactions, общий `GroupsAccessService.memberContext` и permissions во всех пяти путях DTO группы. Переиспользованы effectivePermissions, общие schema fields членств/событий, существующие сбросы/аудит и сериализация финансовых мутаций. Новых доменных сущностей, зависимостей, секретов или миграций нет.
- TDD: `npm run test -- --runInBand group-permissions.spec.ts` сначала 3 failed (отсутствующее право), затем 3 passed. E2E разрешений сначала 4 failed/2 passed (нет поля/DTO), после реализации 6 passed. Финансовые регрессии сначала 4 failed (403 у делегата), после изменения политики прошли, включая чужие операции, атрибуцию, отзыв и изоляцию.
- Unit: `npm run test -- --runInBand` — exit code 0, 50 suites / 287 tests passed. Наборы HTTP требуют разрешения на loopback-сокеты; запуск выполнен вне ограничения сокетов песочницы.
- `npm run build` — exit code 0. `openspec validate add-group-financial-management-permission --strict --no-interactive` — valid, exit code 0.
- ESLint затронутых TS-файлов без `--fix`, с `--no-warn-ignored` для игнорируемых конфигурацией unit-specs — exit code 0; форматирование одного теста исправлено отдельным адресным запуском. `git diff --check` — exit code 0.
- Ревью независимым агентом: существенных замечаний по корректности и безопасности нет. Все delta-сценарии сопоставлены с group-permissions, group-financial-management, group-finances-concurrency/groups и unit-тестами прав/доступа.
- Решение по фикстурам: существующий тест groups создавал личные счета/расход без валюты, и отчёт падал до создания группы; добавлены явные USD/name. Два теста accounts-deletion-concurrency использовали операцию 2026-09-21 при неявном openedAt текущей даты; задано openedAt=date в двух фабриках. Это исправления тестовых данных, личный production-код не менялся. Повторные узкие наборы: groups — 15/15, accounts-deletion-concurrency — 9/9, exit code 0.
- Общая strict-валидация main specs до синхронизации выявила существующие предупреждения о длине требований >500 символов в entity-deletion-lifecycle, group-wallet, totp-two-factor-authentication, user-currency-settings (11 passed / 4 failed). Они не относятся к этому change; тексты этих спецификаций не меняются. После синхронизации будут отдельно проверены обе затронутые спецификации строго и весь каталог обычной валидацией.
- `npm run test:e2e -- --runInBand` после исправления фикстур — exit code 0, 19 suites / 130 tests passed, 83.153 s. Среда — временные локальные MongoDB replica sets и HTTP-серверы, без внешнего API и рабочей базы.
- Синхронизированы group-financial-permissions (два новых и два изменённых требования) и group-transactions (два изменённых требования); Purpose и остальные требования/сценарии сохранены. `openspec validate group-financial-permissions --type spec --strict --no-interactive` и аналогичная команда для group-transactions — valid, exit code 0. `openspec validate --specs --no-interactive` — 15 passed / 0 failed, exit code 0, с ранее существовавшими предупреждениями длины в четырёх других спецификациях.
- Архив: `openspec/changes/archive/2026-10-17-add-group-financial-management-permission/`, 2026-10-17 (Europe/Moscow), все 15/15 задач завершены. `.openspec.yaml` сохранён; `openspec list --json` после перемещения — changes=[], exit code 0. Следующий этап — 02; его change пока не создан. Commit/публикация не выполнялись.

## 02. Общие механизмы действующих финансов

- [x] Создан change.
- [x] Применён.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; результат записан.

Объём: перенести общий BudgetContext из группового слоя в нейтральное место; постепенно свести существующие пути Account, Snapshot, Income/Expense и общие проверки категорий/лимитов к общим доменным механизмам. Сохранять тонкие адаптеры личных и групповых API. Не трогать пока Plan/Debt, поскольку их владение меняется в этапах 08/09. Отчётную арифметику переиспользовать по мере изменения контракта на этапе 03.

Основание: `AccountsService`, `TransactionsService`, `AccountsSnapshotsService` и групповые `GroupWalletService`/`GroupTransactionsService` уже опираются на общие схемы, но содержат разные пути вычислений. Переносить общие правила, явно сохраняя разные политики, а не выбирать один сервис и подменять им другой.

Приёмка: один общий путь расчёта/изменения каждого затронутого финансового механизма; личные и групповые контракты прежние, replay истории и отрицательный групповой баланс сохраняются. Проверить изоляцию, opening date, backdating, deletion/archive и гонки доступа/счетов. Это чистый рефакторинг: `skip_specs: true`, если обнаруженные изменения поведения вынесены в следующие change. Не менять поведение под видом универсализации.

Журнал планирования (2026-10-17): подготовлены [proposal](../openspec/changes/archive/2026-10-17-unify-budget-financial-core/proposal.md), [design](../openspec/changes/archive/2026-10-17-unify-budget-financial-core/design.md) и [tasks](../openspec/changes/archive/2026-10-17-unify-budget-financial-core/tasks.md), 26 задач реализации. `.openspec.yaml` объявляет `skip_specs: true`: рефакторинг не меняет наблюдаемое поведение, поэтому delta-спецификации намеренно не создаются. `openspec status --change unify-budget-financial-core` — 3/3 planning artifacts complete, specs skipped; `openspec validate unify-budget-financial-core --strict --no-interactive` — valid, exit code 0. Apply instructions — ready, 0/26 tasks complete.

Ключевые решения: расширить existing owning-domain services для user/group вместо новых копий сущностей; вынести общий контекст/доступ/транзакционную координацию в нейтральный слой; сохранить personal snapshot-delta и group ledger как явные правила одного общего сервиса снимков. Сохранить все текущие DTO, права из этапа 01, currency/period policies и ClientSession/origin для личных переводов/планов/долгов. Текущий HTTP snapshots предоставляет только GET; новых методов изменения снимков не добавлять.

На момент завершения планирования production-код не менялся; тесты/build не запускались, результаты этапа 01 не переносились на этап 02. Результаты последующего применения записаны ниже.

Журнал применения (2026-10-17):

- Общий BudgetContext/pure owner filter перенесён в common/budget; BudgetAccessService и BudgetWriteService — в BudgetsModule. Удалены прежние групповые forwarding-файлы доступа/runner; новые классы не дублируют старые механизмы. User legacy userId и отдельный actorId сохраняются.
- AccountsService обслуживает оба бюджета; GroupWallet делегирует create/list/get/delete/остатки. Общие history checks учитывают обе стороны переводов и deleted history; личные archive/defaultAccountId сохранились.
- AccountsSnapshotsService обслуживает оба бюджета: личные сохранённые snapshots обновляются дельтой, групповые — ledger/initialAmount и month-end UTC. GroupWallet и GroupTransactions больше не содержат независимый rebuild, snapshot lookup или денежную запись. Старые значения/даты снимков не мигрируются.
- Общие IncomesService/ExpensesService/TransactionsService выполняют создание, чтение, фильтрацию, edit/delete и effects; GroupTransactions — только доступ/права/атрибуция/адаптация DTO. Личные transfer, plan.close и debt.repay сохраняют свои effects, origin и ClientSession; supplied session не завершается вложенным вызовом.
- ExpenseCategoriesService/ExpenseLimitsService обслуживают общие CRUD, locks, usage/history; GroupSettings не выполняет собственные MongoDB-запросы или денежные расчёты. Сохранены разные personal/group DTO, валюты, календарь, archive/list policies. Ранее существовавшее личное усечение миллисекунд endDate через `.toString()` намеренно не исправлялось в рефакторинге.
- Baseline до изменений: `npm run test:e2e -- --runInBand test/budget-core-compatibility.e2e-spec.ts test/group-finances-boundaries.e2e-spec.ts test/personal-report-history.e2e-spec.ts` на сохранённой исходной реализации в `/tmp` с явно заданным несекретным MONGO_DB_NAME — 3 suites / 9 tests passed, exit code 0. Отдельный baseline настроек — 2 tests passed до переноса. Сохранённый личный перенос 77 → 87 → 92 → 77 подтверждён независимо от ledger.
- После интеграции: `npm run test -- --runInBand` — 53 suites / 300 tests passed, exit code 0. `npm run test:e2e -- --runInBand` — 21 suites / 135 tests passed, exit code 0, 107.236 s. Все HTTP/DB-наборы использовали временные локальные MongoDB replica sets; рабочая база и внешний API не использовались. Локальные сокеты запускались с разрешением вне ограничений песочницы.
- Дополнительно: 13 affected e2e suites / 83 tests прошли; узкие unit-наборы счетов, snapshot/session/owner helpers, settings и transactions прошли. Общая проверка covers isolation, текущие финансовые permissions, конкурентные revoke/remove/ownership/edit/delete, lifecycle, multicurrency, reports, seed, plans/debts и user-deletion.
- Независимое ревью настроек и финальное ревью core: spec compliance / code quality pass, существенных замечаний нет. Общие механизмы реально используются обоими бюджетами, без новых моделей, зависимости, циклов DI или возможностей последующих этапов. Внутренние mutationVersion счётчики счетов/категорий могут увеличиваться при общих locks; финансовые величины и DTO-формы сохраняются.
- Документация: [budget-financial-core.md](budget-financial-core.md). Новых секретов, схем, индексов и миграций нет; изменение основного каталога спецификаций в этом этапе не требуется (`skip_specs: true`).
- Финальные `npm run build`, ESLint 45 затронутых/новых TS-файлов с `--no-warn-ignored`, `openspec validate unify-budget-financial-core --strict --no-interactive`, `git diff --check` — exit code 0. Модели/индексы, DTO/контроллеры и возможности будущих этапов не менялись. Изменения группы/auth из предыдущего этапа сохранены.
- Архив: `openspec/changes/archive/2026-10-17-unify-budget-financial-core/`, 2026-10-17 (Europe/Moscow), 26/26 задач завершены. `.openspec.yaml` и `skip_specs: true` сохранены, delta specs отсутствуют, main specs не синхронизировались. `openspec list --json` после архивирования — changes=[], exit code 0. Следующий этап — 03, его change ещё не создан. Commit/публикация не выполнялись.

## 03. Валюты и согласованный денежный контракт

- [x] Создан change.
- [x] Применён; dev fixtures обновлены (миграция не требуется).
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы.

Объём: явные name/currency единственного пока группового счёта; валюта операций, лимитов и денежных сумм; общие money utilities вместо фиксированной точности 2; групповые отчёты `{ period, currencies: [...] }` с теми же смыслами полей, что у личных. Лимиты разделяются по валютам; арифметическая сумма разных валют без конвертации запрещена. Сохранить UTC, initialAmount, openedAt, историческую атрибуцию и общий баланс независимо от фильтра расходов.

Согласовано пользователем 2026-10-17: неизменяемая валюта каждого счёта, операции наследуют её; лимит на категорию и валюту, пересечения запрещены только в той же валюте. Отчёты сразу заменяются новым контрактом без legacy-варианта. Существуют только dev-данные, миграция не нужна.

Dev-данные: обновить seeds/fixtures и описать их пересоздание; не добавлять миграцию и не угадывать валюту старых сумм из профиля. Развёртывание требует чистых/пересозданных dev-данных. При появлении реальных данных потребуется отдельное согласованное отображение валют и migration change.

Приёмка: два участника с разными defaultCurrency видят одинаковую валюту семейных денег; точность проверяется по валюте; отчёты совместимы по денежной структуре. savings/transfers на этом этапе честно отсутствуют/нулевые согласно согласованному контракту, поскольку их функций ещё нет.

Журнал планирования (2026-10-17): подготовлены [proposal](../openspec/changes/archive/2026-10-17-add-group-currencies-and-report-contract/proposal.md), [design](../openspec/changes/archive/2026-10-17-add-group-currencies-and-report-contract/design.md), три delta specs и [tasks](../openspec/changes/archive/2026-10-17-add-group-currencies-and-report-contract/tasks.md). `openspec validate add-group-currencies-and-report-contract --strict --no-interactive` — valid, exit code 0; status — 4/4 planning artifacts complete. Применение, unit/e2e/build и архивирование не выполнялись; следующий шаг — apply этапа 03. Код проекта не менялся.

Журнал применения (2026-10-17):

- Счёт группы требует name/currency; валюта неизменяема, операции наследуют её сервером. Общий TransactionsService проверяет amount при create/PATCH и денежные price групповых items; количество позиций сохраняет прежние правила. Общие money utilities обслуживают JPY/RUB/KWD, ledger/snapshots, revenue и rest лимитов. Личные wire-контракты и минимальные границы личных amount/item.price сохранены.
- ExpenseLimitsService применяет overlap и usage к owner/category/currency. Валюта лимита неизменяема, допустима без счёта нужной валюты. Возвращается прежнее поле rest, aliases used/remaining не добавлялись. Блокировки категории, финансовые транзакции и permissions сохранены.
- ReportsService теперь общий построитель валютных DTO/агрегаций. GroupReportsService оставлен адаптером доступа, UTC-периодов и категорий. Личные календарь/defaults/snapshot carry сохранены; групповой остаток берётся из ledger. Один balance-счёт остаётся ограничением, saving/transfers в отчёте равны 0, старый плоский ответ удалён.
- TDD: новый набор операций сначала 6 failed (отсутствующая monetary identity, фиксированная precision, отсутствующая currency); после промежуточного добавления счёта подтверждены failures операций JPY/KWD и currency ответа. Лимиты сначала 5 failed (currency-less 201 вместо 400 / currency-запрос 400 вместо 201); отчёты — failure старого плоского DTO вместо currencies. После реализации новые проверки проходят.
- Полный unit-прогон сначала выявил 7 failures в mocks расходов/доходов и group account fixture unit-теста transactions. Моки подключены к реальному общему валидатору, fixture получил USD. Повтор `npm run test -- --runInBand` — exit code 0, 53 suites / 300 tests passed, 4.059 s. `npm run build` — exit code 0.
- Первый полный e2e: 23 passed / 1 failed suite, 152 passed / 1 failed test. Причина — ещё одна устаревшая fixture budget-settings-compatibility без name/currency и лимит без currency; updated assertions сохраняют старые UTC/изоляционные проверки, теперь ожидают USD. Узкий повтор `npm run test:e2e -- --runInBand budget-settings-compatibility` — exit code 0, 2 tests passed. Итоговый повтор `npm run test:e2e -- --runInBand` — exit code 0, 24 suites / 153 tests passed, 102.162 s. Среда — временные локальные MongoDB replica sets и loopback HTTP с разрешением вне ограничений сокетов песочницы; рабочая база не использовалась.
- Независимые ревью core/limits и reports: critical/important замечаний нет. Документация: group-finances-api.md (breaking DTO/report, precision, optional/empty/null cases и dev reset), budget-financial-core.md и group-finances-seed.md. Seeds и HTTP fixtures задают валюту явно; миграция не нужна по подтверждённому решению пользователя. Seed рабочей базы не запускался; deploy/live API не проверялся.
- Prettier — все 33 затронутых/новых TS-файла проходят. ESLint новых/затронутых файлов, кроме user-deletion.e2e-spec.ts — exit code 0; в user-deletion ранее существовали 5 unsafe-any ошибок вне изменённого участка (изменён только объект создания group account). Они не подавлены и не считаются прошедшей проверкой. `git diff --check` и strict change validation — exit code 0.

Покрытие delta-сценариев:

| Контракт                                                                                                                      | Проверки                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Обязательные name/currency, immutable currency, precision 0/2/3, разные defaultCurrency, singleton                            | group-currency-transactions; group-finances/concurrency/isolation                          |
| Операции amount/price create/PATCH, точная компенсация, read-only currency, фильтры/revenue 0/одна сумма/null                 | group-currency-transactions; group-financial-management                                    |
| Валютные лимиты, precision/immutable/filter, usage owner/category/currency, UTC границы, update/concurrent overlap            | group-currency-limits; budget-settings-compatibility; group-finances-concurrency           |
| Валютный report DTO, empty, initialAmount/openedAt, UTC история, category filter, archive/departed/deleted, isolation/sorting | group-currency-reports; group-finances-boundaries/isolation; group-finances                |
| Личные DTO, валюты и snapshots, permissions/lifecycle/auth                                                                    | budget-core-compatibility; personal-report-history; multicurrency; прежние unit/e2e-наборы |

Все 18/18 задач применения завершены. Синхронизированы group-wallet (1 modified + 1 added), group-transactions (3 modified + 2 added), group-budget-settings (2 modified + 3 added); Purpose и прежние сценарии сохранены. `openspec validate --specs --no-interactive` — exit code 0, 15 passed / 0 failed; остаются предупреждения длины требований >500 символов, в том числе расширенного Group limits. Тексты не сокращались ради strict-проверки.

Архив: `openspec/changes/archive/2026-10-17-add-group-currencies-and-report-contract/`, 2026-10-17 (Europe/Moscow), `.openspec.yaml` сохранён. Main specs сопоставлены с delta, все изменения синхронизированы. `openspec list --json` после перемещения — changes=[], exit code 0; `git diff --check` — exit code 0. Следующее действие — планирование этапа 04, его change ещё не создан. После завершения этапа 03 создан коммит `11564f1` — `Added group currencies and unified reports`, без co-authored. Публикация не выполнялась.

## 04. Несколько счетов и накопления

- [x] Создан change.
- [x] Применён.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы.

Объём: использовать общие Account, balance/saving discriminators и жизненный цикл; снять одиночность группового balance; именованные счета, список/детали, rename, archive и безопасное удаление неиспользованного. История архивных счетов доступна, новые движения запрещены. Расширить общий построитель отчётов этапа 03 на реальный saving и архивные счета, проверив общий остаток по всем счетам. Явно обновить существующую group-wallet spec, запрещающую saving и второй счёт.

Согласовано пользователем 2026-10-17: прямые доходы/расходы saving разрешены, отрицательный учётный остаток допустим; архив блокирует создание, PATCH и DELETE операций с сохранением чтения истории; group defaultAccountId пока не нужен, accountId выбирается явно. Пока этап 05 не применён, UI не должен обещать пополнение резерва переводом.

Приёмка: общий резерв доступен обоим супругам, не теряет историю при archive, остатки и накопления не дублируются в отчётах; иностранные ссылки запрещены. Сценарий пополнения резервов окончательно закрывается этапом 05.

Журнал подготовки (2026-10-17): этап 03 закоммичен как `11564f1`. Изучены Account discriminators, общие create/list/get/remove, личные rename/archive, BudgetWriteService, активность счёта в TransactionsService и валютный построитель ReportsService. Переиспользование этих путей сохраняется требованием. Ответы пользователя получены и отражены в контракте. Созданы [proposal](../openspec/changes/archive/2026-10-17-add-group-accounts-and-savings/proposal.md), [design](../openspec/changes/archive/2026-10-17-add-group-accounts-and-savings/design.md), три delta specs (group-wallet, group-transactions, group-budget-settings) и [tasks](../openspec/changes/archive/2026-10-17-add-group-accounts-and-savings/tasks.md), 16 задач. `openspec validate add-group-accounts-and-savings --strict --no-interactive` — valid, exit code 0; status — 4/4 planning artifacts complete. Применение, unit/e2e/build и архивирование этапа 04 не выполнялись; код после коммита этапа 03 не менялся. Следующий шаг — apply этапа 04; этап 05 ещё не создан.

Журнал применения (2026-10-17):

- Общий AccountsService создаёт balance/saving без singleton, обслуживает owner-scoped renameForBudget/archiveForBudget и lifecycle lock. GroupWalletService/контроллер только адаптируют права, DTO и транзакцию; удалён неиспользуемый адаптер расчёта balance. Личный rename/archive/defaultAccountId и выбор snapshot сохраняют прежний контракт.
- Новые групповые PATCH name и POST archive проверяют manageAccounts через существующую сериализацию. Архив замораживает финансовые create/PATCH/DELETE через общие account lookup/locks с archivedAt:null. Read/filter истории и revenue не исключают архивные счета. Ненулевой opening и любая история по-прежнему дают RESTRICT; пустой архивный счёт удаляется атомарно со снимками.
- Saving использует общие IncomesService/ExpensesService, допускает прямые операции и отрицательный остаток. Валютные precision/openedAt и права участников сохранены. ReportsService распределяет остатки по type для обоих бюджетов; balance не дублирует saving, архивные счета входят в суммы, initialAmount/archive не создают финансовых операций. Новых моделей, индексов, зависимостей, миграции или reset данных нет.
- TDD: group-accounts-savings сначала 6 failed (type/singleton); lifecycle сначала 2 failed (404 отсутствующих PATCH/archive); report raw-fixture выявила saving=0 вместо RUB55/KWD0.001; seed ожидал пять активных счетов вместо трёх. После реализации все новые сценарии прошли. В seed e2e anchor заменён с будущего 2030 на фиксированный март 2024: current amount до будущего openedAt корректно был 0, производственный расчёт не менялся.
- Узкие наборы: accounts/currency/group finances/concurrency/accounts-deletion — `npm run test:e2e -- --runInBand group-accounts-savings group-currency-transactions group-finances.e2e group-finances-concurrency accounts-deletion-concurrency`, exit code 0, 5 suites / 52 tests; lifecycle — `npm run test:e2e -- --runInBand test/group-account-lifecycle.e2e-spec.ts`, exit code 0, 16 tests; reports/currency-reports/personal-history/multicurrency/seed — 5 suites / 14 tests, exit code 0.
- `npm run test -- --runInBand` — exit code 0, 53 suites / 300 tests passed, 4.06 s. `npm run build` — exit code 0. Prettier и ESLint всех 14 затронутых/новых TS-файлов — exit code 0. `git diff --check` и `openspec validate add-group-accounts-and-savings --strict --no-interactive` — exit code 0. Независимое ревью корректности/безопасности/соответствия specs: существенных замечаний нет.
- Документация: group-finances-api.md, budget-financial-core.md, group-finances-seed.md. Seeds дополнены Family bank USD20000 и Family reserve USD50000; исходные операции и прежний кошелёк не заменены. Оба супруга читают резерв и одинаковый отчёт: USD balance292749.5/saving50000/incomes180000/expenses27250.5. Seed рабочей базы и deploy/live API не запускались.

Покрытие delta-сценариев:

| Контракт                                                                                                                           | Проверки                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Несколько одинаковых/разновалютных счетов, default type, immutable fields, фильтры, foreign isolation, отсутствие defaultAccountId | group-accounts-savings; group-account-lifecycle; group-currency-transactions                                               |
| Rename/archive, history/revenue/limits/report, used/empty archive DELETE, permissions/stale JWT                                    | group-account-lifecycle; прежние group-finances/isolation/financial-management                                             |
| Archive vs create/PATCH/DELETE (income/expense), revoke/remove vs rename/archive, обе последовательности и точные snapshots/ledger | group-account-lifecycle explicit barriers; group-finances-concurrency; accounts-deletion-concurrency                       |
| Saving direct income/expense, negative, author/participant, limits и JPY/RUB/KWD precision/openedAt/edit/delete                    | group-accounts-savings; group-currency-transactions                                                                        |
| Общие report totals без double-count, archived/history/currency/category-filter, сохранённые личные defaults/snapshots             | group-savings-reports; group-currency-reports; personal-report-history; multicurrency; budget-core-compatibility; seed e2e |

Итоговый полный `npm run test:e2e -- --runInBand` — exit code 0, 27 suites / 177 tests passed, 115.759 s. Среда: временные локальные MongoDB replica sets и loopback HTTP с разрешением вне ограничений сокетов песочницы; рабочая база не использовалась. Все 16/16 задач применения завершены; ограничения отката описаны в API/design. Синхронизированы group-wallet, group-transactions и group-budget-settings: 2 modified и 6 added requirements, прежние сценарии и Purpose сохранены. `openspec validate --specs --no-interactive` — exit code 0, 15 passed / 0 failed, с предупреждениями о длине требований; unrelated тексты не сокращались ради strict.

Архив: `openspec/changes/archive/2026-10-17-add-group-accounts-and-savings/`, 2026-10-17 (Europe/Moscow), `.openspec.yaml` сохранён, содержимое main specs сопоставлено с delta. `openspec list --json` после перемещения — changes=[], exit code 0; `git diff --check` — exit code 0. Следующее действие — планирование этапа 05; его change не создан. После завершения этапа 04 создан коммит `fac8ec5` — `Added group accounts and savings`, без co-authored. Публикация не выполнялась.

## 05. Переводы внутри группы

- [x] Создан change.
- [x] Применён.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы.

Объём: расширить существующие Transfer и его source/destination effects на BudgetContext; общий сервис перевода для личного/группового бюджета. Создание/чтение/изменение/отмена, history/filter, права manageTransactions, два счёта одного бюджета, обе валюты и суммы при обмене. Отчёты учитывают движения balance/saving и transfersIn/Out по общей согласованной формуле без фиктивных дохода/расхода.

Согласовано пользователем 2026-10-17: любой действующий участник создаёт перевод; суммы/описание изменяет и отменяет действующий автор, владелец или manageTransactions. Счета, валюты и дата неизменяемы; архив любой стороны блокирует изменения. При создании/увеличении списания требуется достаточность исходного остатка на дату перевода. Обычные групповые расходы сохраняют допустимый отрицательный остаток. Повторный POST создаёт новый факт, повторный DELETE даёт 404 без второй компенсации; ключ идемпотентности не добавляется.

Приёмка: оба остатка и effects меняются атомарно, ошибка откатывает всё, повторная отмена не компенсирует дважды; гонки edit/delete и archive проверены. Внутригрупповой перевод не увеличивает доход/расход семьи.

Личный ↔ групповой бюджет **не входит** в этот change. Это отдельное продуктовое решение и будущий change при явном включении: доступ к обоим бюджетам, видимость взносов и защита от двойного учёта.

Журнал подготовки (2026-10-17): этап 04 закоммичен как `fac8ec5`. Изучены Transfer/source-destination effects, TransfersService create/update/delete/list, общие account locks, групповой ledger и ReportsService.aggregateTransfers. Требуется расширить существующий Transfer/TransfersService на BudgetContext, учитывать обе стороны в ledger/history/filter и подключить уже существующую отчётную агрегацию без второго движка. Ответы пользователя получены и отражены в контракте. Созданы [proposal](../openspec/changes/archive/2026-10-17-add-group-account-transfers/proposal.md), [design](../openspec/changes/archive/2026-10-17-add-group-account-transfers/design.md), четыре delta specs (account-transfers, group-transactions, group-wallet, group-budget-settings) и [tasks](../openspec/changes/archive/2026-10-17-add-group-account-transfers/tasks.md), 18 задач. `openspec validate add-group-account-transfers --strict --no-interactive` — valid, exit code 0; status — 4/4 planning artifacts complete. Применение, unit/e2e/build и архивирование этапа 05 не выполнялись; код после коммита этапа 04 не менялся. Следующий шаг — apply этапа 05; этап 06 ещё не создан.

В design отдельно зафиксированы обратимость отмены по текущему личному правилу (возможен отрицательный destination после расходования зачисления), строгая проверка обеих дат открытия, запись новых/удалённых сумм перед ledger rebuild и сохранение личного snapshot carry. Существующая личная особенность currency-filter переводов не исправляется незаметно в групповом change.

Журнал применения (2026-10-17): общий TransfersService расширен budget-scoped CRUD без новой модели и второго денежного движка. Групповой адаптер использует BudgetWriteService, актуальное членство и manageTransactions; shared ledger учитывает обе стороны, shared ReportsService — transfersIn/Out. История использует общий filter builder и transferResponse. Личный snapshot carry и особенности фильтров сохранены. Seeds дополнены реальным USD1000 переводом через групповой адаптер. Миграции/reset не нужны и не запускались; рабочая база и live API не проверялись. При откате на этап 04 групповые переводы перестанут учитываться прежним ledger/отчётами, поэтому требуется отдельный план сохранения данных.

Проверки до реализации: личная characterization прошла на прежнем сервисе; group HTTP отсутствующие routes — 404, ledger не учитывал source/destination, transfersIn/Out были 0, seed содержал 8 вместо 9 записей. После реализации узкие проверки проходят: transfer unit 16, личные compatibility/multicurrency 4, group HTTP 10, ledger/report/rollback 9, concurrency 46. Проверены обе последовательности гонок, отказ второго effect и откат всей записи/обоих счетов/цепочек снимков, права и отзыв со старым JWT, RESTRICT и запрет обхода generic DELETE. Независимое ревью: существенных замечаний нет. Сценарии четырёх delta specs сопоставлены с этими наборами, group-finances-seed и существующими report/history/lifecycle suites.

Уточнённый пользователем порядок: **сначала коммит кода без co-authored, только затем sync и архивирование**. На текущей записи коммит и архив ещё не созданы; этап 06 не создан.

Общая проверка: `npm run test -- --runInBand` — exit code 0, 54 suites / 315 tests passed (4.566 s); `npm run test:e2e -- --runInBand` — exit code 0, 31 suites / 243 tests passed (141.023 s); `npm run build` — exit code 0. HTTP/e2e используют временные локальные MongoDB replica sets и loopback-серверы; разрешение сокетов предоставлено отдельно. Prettier check и ESLint без --fix для 19 затронутых TS-файлов (с --no-warn-ignored для unit-specs) — exit code 0; `git diff --check` — exit code 0. `openspec validate add-group-account-transfers --strict --no-interactive` — valid, exit code 0. 18/18 задач выполнены. Код готов к коммиту; change остаётся активным до его создания.

Завершение (2026-10-17): сначала создан коммит реализации `b971aef` — `Added group account transfers`, без co-authored; после него синхронизированы account-transfers, group-transactions, group-wallet и group-budget-settings, затем change перемещён в `openspec/changes/archive/2026-10-17-add-group-account-transfers/`. При финальной сверке в delta исправлено документальное имя поля type → transactionType согласно реальному DTO и HTTP-тестам. Все прежние сценарии сохранены; Purpose сохранены (account-transfers уточнён при применении до коммита). `openspec validate --specs --no-interactive` — exit code 0, 15 passed / 0 failed; остаются существующие предупреждения длинных требований >500 символов. `openspec validate add-group-account-transfers --strict --no-interactive` перед переносом — valid, exit code 0. После переноса `openspec list --json` — changes=[], exit code 0; `git diff --check` — exit code 0. Архивирование, sync и эта запись выполнены после коммита реализации. По следующей команде пользователя они зафиксированы отдельным коммитом `fd76838` — `Archived group account transfers change`, без co-authored. Перед коммитом: `git diff --check` — exit code 0; main specs validation — 15 passed / 0 failed; active changes=[]. Публикация не выполнялась.

## 06. Предпросмотр приглашения

- [x] Создан change.
- [x] Применён.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы.

Объём: предложенный POST `/group-invitations/preview`, токен только в теле. Переиспользовать существующие проверку секрета/состояния/срока и распределённое ограничение попыток. Возвращать только название, тип, expiresAt; не создавать членство и не потреблять ссылку. Общая ошибка для невалидного, истёкшего, использованного/отозванного токена и удалённой группы. Токен не попадает в логи/ошибки.

Согласовано пользователем 2026-10-17: JWT, как у accept, минимальный ответ `{ name, type, expiresAt }`. Членство для preview не требуется; участник/владелец может просмотреть pending приглашение, но accept участника сохраняет 409. Общий существующий лимит preview+accept — 10 запросов за фиксированную минуту на пользователя; отдельный счётчик не вводится. Успешный preview не гарантирует последующий accept.

Приёмка: два preview не меняют состояние ссылки, accept после них работает; revoke/expire/delete между preview и accept обрабатываются корректно; раскрытия участников/финансов нет.

Журнал подготовки (2026-10-17): архив этапа 05 закоммичен как `fd76838`. Изучены GroupInvitationsController/Service, digest/pending/expiry, GroupsTransactionService, shared MongoDB rate guard, DTO, request logging/error filter, действующие groups HTTP/concurrency и main group-invitations spec. Созданы [proposal](../openspec/changes/archive/2026-10-17-add-group-invitation-preview/proposal.md), [design](../openspec/changes/archive/2026-10-17-add-group-invitation-preview/design.md), [delta spec](../openspec/changes/archive/2026-10-17-add-group-invitation-preview/specs/group-invitations/spec.md) и [tasks](../openspec/changes/archive/2026-10-17-add-group-invitation-preview/tasks.md), 10 задач. План переиспользует существующие модели, token DTO, resolver, транзакционный wrapper и счётчик; доменных writes от preview нет. Учтено исключение query из application logs/error.path приглашений, включая 401 до controller. Public preview и имя приглашающего исключены. Self-review: нет открытых вопросов/placeholder, контракт согласован с задачами и source; прежние acceptance scenarios сохраняются.

`openspec validate add-group-invitation-preview --strict --no-interactive` — valid, exit code 0; status — 4/4 planning artifacts complete. `git diff --check` — exit code 0. Реализация, unit/e2e/build и архивирование этапа 06 не выполнялись; production-код и main specs после коммита архива этапа 05 не менялись. Следующее действие — apply по отдельной команде; этап 07 ещё не создан.

Журнал применения (2026-10-17): добавлен JWT POST preview с `{ name, type, expiresAt }`, HTTP 200/no-store. Общий private pendingInvitation проверяет digest/pending/expiry; accept сохраняет повторную проверку после serializeMutation и атомарное вступление. Preview читает ссылку/Group в одной ClientSession без group lock/write. Переиспользованы существующие DTO, модели, транзакционный wrapper и распределённый guard с общей квотой preview+accept. Миграций, reset, новых env/секретов/индексов нет; live API и рабочая база не проверялись. Откат убирает preview, сохраняя ссылки и членства.

До изменений: groups HTTP/concurrency — 2 suites / 35 tests, guard unit — 4 tests, exit code 0. Новые HTTP-тесты подтвердили RED отсутствующего маршрута (21 failed / 1 passed); отдельный concurrency RED — ожидаемый 200, фактический 404. Query-secret unit-регрессии подтвердили RED отражения секрета в path/logs (6 failed). После реализации узкий запуск preview + существующие groups/concurrency — 3 suites / 57 tests, exit code 0; новый concurrency — 7 tests (оба порядка explicit barriers и четыре инвалидирования), exit code 0. Domain snapshots включают заполненные финансы и не меняются при preview; исключён только counter.

Независимое ревью нашло отражение секрета в имени неизвестного query/body поля через сообщения ValidationPipe. Добавлены RED unit (2 failures) и HTTP (1 failure), затем обезличены только validation-array 400 сообщения invitation routes как `Invalid invitation request`; строковый `Invalid invitation` и прочие маршруты сохранены. GREEN: preview HTTP — 24 tests, общие filter/log/path unit — 21 tests. Повторное ревью: существенных замечаний нет. Защита охватывает body/query, ключи/значения, 401/400/429/503 и успешные логи; docs описывает точные сообщения.

Порядок по последней команде пользователя: реализация/проверки/ревью → первый коммит → sync и архив → второй коммит. На этой записи полная финальная проверка ещё выполняется, коммиты этапа 06 и архив не созданы; этап 07 не создан.

Итоговая проверка после исправления ревью: `npm run test -- --runInBand` — exit code 0, 55 suites / 333 tests passed (4.216 s); `npm run test:e2e -- --runInBand` — exit code 0, 33 suites / 274 tests passed (145.961 s); `npm run build` — exit code 0. Предыдущий полный e2e до финальной регрессии — 273 passed; окончательный запуск повторён после изменения общего filter. Scoped `npx prettier --check` и `npx eslint --no-warn-ignored` для 10 изменённых TS-файлов — exit code 0; `git diff --check` — exit code 0. `openspec validate add-group-invitation-preview --strict --no-interactive` — valid, exit code 0. Все delta-сценарии сопоставлены с двумя preview e2e-наборами, прежними groups/concurrency, guard и filter/log/path unit. 10/10 задач завершены. Все проверки локальные; сокеты разрешены для полного unit/e2e. Код готов к первому коммиту; change пока активен.

Завершение (2026-10-17): первый коммит `b8489e5` — `Added group invitation preview`, без co-authored, создан **до** sync/архива. После него group-invitations синхронизирована: одно MODIFIED и три ADDED требования, прежние Purpose и сценарии сохранены; все delta-блоки сверены с main. `openspec validate --specs --no-interactive` — exit code 0, 15 passed / 0 failed, прежние предупреждения длинных требований остаются; строгая валидация change — valid. Change перемещён в `openspec/changes/archive/2026-10-17-add-group-invitation-preview/`. `openspec list --json` после переноса — changes=[], exit code 0; `git diff --check` — exit code 0. Sync, архив и журнал включены во второй коммит `08bea63` — `Archived group invitation preview change`, без co-authored. Публикация не выполнялась. Этап 07 не создан; следующий шаг — его отдельное планирование.

## 07. Исторические авторы и участники

- [x] Создан change.
- [x] Применён.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы.

Объём: общий безопасный resolver кратких субъектов в доступной групповой истории. Сохранить createdBy/participantId; добавить согласованные сведения для отображения, включая вышедших и обезличенного удалённого пользователя. Переиспользовать в операциях, а затем в планах/долгах, без отдельного общего каталога всех пользователей.

Согласовано пользователем 2026-10-17: текущие firstName/lastName и краткие createdByActor/participantActor прямо в DTO операций; исходные createdBy/participantId сохраняются. Для deletion_pending/deleted и отсутствующего профиля — прежний userId, null-имена и isAnonymized=true. Никаких снимков прежних имён, email или поиска пользователей без связи с возвращаемой доступной историей.

Приёмка: после выхода автора имя разрешается согласно политике, после удаления пользователя остаётся обезличенная атрибуция, исторический фильтр работает; бывший участник сам доступа не получает.

Журнал подготовки (2026-10-17): этап 06 закрыт двумя коммитами `b8489e5` и `08bea63`. Изучены групповые adapters/list/get/create/PATCH и shared transaction/transfer DTO, active-only members directory, User schema/profile update, реальный deletion request/worker/tombstone и существующие deletion tests. Созданы [proposal](../openspec/changes/archive/2026-10-17-resolve-group-historical-actors/proposal.md), [design](../openspec/changes/archive/2026-10-17-resolve-group-historical-actors/design.md), [delta spec](../openspec/changes/archive/2026-10-17-resolve-group-historical-actors/specs/group-transactions/spec.md) и [tasks](../openspec/changes/archive/2026-10-17-resolve-group-historical-actors/tasks.md), 12 задач. Общий resolver выбирает только active профили для уникальных ссылок выбранной страницы; create/PATCH используют ту же ClientSession для rollback при lookup failure. Личный API и финансовые aggregates не обогащаются, members остаётся active-only. Выявленная ошибка docs/spec о discriminator перевода уточняется в текущем change как type, без переименования production-поля или изменения архивов.

`openspec validate resolve-group-historical-actors --strict --no-interactive` — valid, exit code 0; status — 4/4 planning artifacts complete. `git diff --check` — exit code 0. Self-review: контракт и tasks согласованы, открытых вопросов и placeholder нет. Реализация, unit/e2e/build, миграции и архивирование этапа 07 не выполнялись; main specs/production после этапа 06 не менялись. Дальнейший цикл: apply по отдельной команде → тесты/ревью → первый коммит без co-authored → sync/архив → второй коммит. Этап 08 не создан.

Журнал применения (2026-10-17): один GroupFinancialActorsService дополняет group expense/income/transfer create/PATCH/list/detail и mixed history после owner-scoped доступа. Query только active User с безопасной проекцией, dedup/$in по странице, без N+1 и кеша; fallback для pending/deleted/missing сохраняет userId и null-имена. Create/PATCH передают прежнюю ClientSession; ошибка lookup откатывает денежную запись и effects. DELETE/revenue/reports и личное ядро не обогащаются. Исторические ссылки/полномочия/пагинация/денежные DTO сохранены, docs уточняет фактический type discriminator перевода. Миграций/reset/новых индексов/env/секретов нет; рабочая база и live API не проверялись.

Исходная проверка до подключения: `npm run test:e2e -- --runInBand test/budget-core-compatibility.e2e-spec.ts test/group-finances.e2e-spec.ts test/group-transfers.e2e-spec.ts` — exit code 0, 3 suites / 18 tests passed (12.948 s). Новый actor HTTP RED — 5 failed из-за отсутствующих actor-полей; privacy RED подтвердил то же. После реализации group-financial-actors + прежние group-finances/group-transfers — 3 suites / 20 tests, exit code 0 (14.526 s); privacy — 1 suite / 5 tests, exit code 0; resolver unit — 8 tests, exit code 0. Исправлена только тестовая личная фикстура: добавлен обязательный type=balance.

Privacy-набор использует реальные UserDeletionService.request и четыре стадии worker: имена скрыты уже в pending, tombstone не меняет actor/групповые деньги. Отсутствующий профиль, свежие имена, совпадающий author/participant проверены. Failure injection actual User.find exec наблюдает незакоммиченные изменения под той же ClientSession, затем точное восстановление groups/accounts/snapshots/transactions после create/PATCH всех трёх типов, включая оба счёта/снимка перевода. Read даёт 500, mutation — 503, DELETE204 не делает identity lookup. Независимое read-only ревью: существенных замечаний нет.

На текущей записи полная финальная проверка ещё выполняется. Следующий порядок: первый коммит реализации без co-authored → sync/архив → второй коммит архива. Этап 08 не создан.

Итоговая проверка: `npm run test -- --runInBand` — exit code 0, 56 suites / 341 tests passed (4.181 s); `npm run test:e2e -- --runInBand` — exit code 0, 35 suites / 284 tests passed (156.644 s); `npm run build` — exit code 0. Scoped `npx prettier --check` и `npx eslint --no-warn-ignored` для 8 изменённых TS-файлов — exit code 0; `git diff --check` — exit code 0. `openspec validate resolve-group-historical-actors --strict --no-interactive` — valid, exit code 0. Все проверки локальные, e2e — временные MongoDB replica sets и HTTP; полные unit/e2e получили разрешение loopback-сокетов. Все delta-сценарии сопоставлены с actor HTTP/privacy, unit resolver и действующими permissions/concurrency/deletion/compatibility наборами. 12/12 задач завершены. Код готов к первому коммиту; change пока активен.

Завершение (2026-10-17): первый коммит `4d894c9` — `Added group historical actor summaries`, без co-authored, создан до sync и архива. Затем group-transactions синхронизирована (одно MODIFIED и четыре ADDED требования), Purpose и прежние сценарии сохранены, все delta-блоки сверены с main. `openspec validate --specs --no-interactive` — exit code 0, 15 passed / 0 failed; существующие предупреждения длинных требований сохранены. Строгая валидация change перед переносом — valid, exit code 0. Change перемещён в `openspec/changes/archive/2026-10-17-resolve-group-historical-actors/`; после переноса `openspec list --json` — changes=[], exit code 0; `git diff --check` — exit code 0. Sync, архив и этот журнал включены во второй коммит `980c7b5` — `Archived group historical actors change`, без co-authored. Публикация не выполнялась. Этап 08 не создан; следующий шаг — его отдельное планирование.

## 08. Общие планы

- [x] Создан change.
- [x] Применён; совместимость/миграция проверены.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы.

Объём: расширить существующие Plan, PlansService и связку Transaction.origin на ownerType/ownerId/createdBy; личный API оставить адаптером общего сервиса. Групповые список/детали/create/update/archive/delete/execute, валюта, срок и категория своей группы. Исполнение вызывает общий механизм расходов с той же ClientSession, без внутренних HTTP-запросов к личному API.

Согласовано пользователем 2026-10-17: однократное полное исполнение новым расходом, фактическая сумма может отличаться от плановой, валюта счёта совпадает с планом. Create/read любым действующим участником; изменение/исполнение/архив/удаление — автор, владелец или manageTransactions. Автор расхода — исполнитель, participantId optional из действующих членов, по умолчанию исполнитель. Обычный PATCH/DELETE расхода сохраняет closed, planned amount и expenseId/origin; частичного исполнения, готового расхода и cancel/reopen нет. Личные планы мигрируются без смены смысла.

Приёмка: второй уполномоченный участник исполняет чужой план с семейного счёта; расход возникает один раз, личный бюджет не меняется; повторное/конкурентное исполнение и ошибка любой записи не нарушают связи и баланс. Сам план не является фактическим расходом.

Подготовка (2026-10-17): этап 07 закрыт двумя коммитами `4d894c9` / `980c7b5`. Исследованы Plan/PlansService/DTO/controller/module, shared ExpensesService и origin, category RESTRICT, UserDeletionWorker, integrity audit/migration и seeds. Личное close создаёт новый расход один раз, допускает фактическую сумму вместо плановой; закрытый план нельзя удалить, можно архивировать. Логическое удаление расхода сохраняет закрытый план/expenseId/origin. Plan пока требует userId и не имеет BudgetContext/createdBy; общий service следует расширить, личные ответы сохранить через адаптер. Групповой KWD 0.001 потребует снять общий schema min 0.01 при сохранении личного DTO min. Category RESTRICT сейчас проверяет планы только для user — необходимо распространить на group. При миграции личных планов нужны безопасные owner/author backfill из userId, повторяемость и отсутствие изменений денег/закрытых связей; worker не должен удалять групповые планы автора.

До создания change пользователю предложены решения: полное исполнение новым расходом с фактической суммой и совпадающей валютой; create/read любым участником, mutation автором/owner/manageTransactions, expense author=исполнитель и optional participantId; связанный расход исправляется/удаляется по обычным правам, план остаётся closed без отдельного reopen. Ответы получены и отражены в контракте ниже; production-изменения, миграции и тестовые запуски этапа 08 не выполнялись.

Журнал планирования (2026-10-17): созданы [proposal](../openspec/changes/archive/2026-10-18-add-group-budget-plans/proposal.md), [design](../openspec/changes/archive/2026-10-18-add-group-budget-plans/design.md), две delta specs (group-budget-plans, budget-ownership) и [tasks](../openspec/changes/archive/2026-10-18-add-group-budget-plans/tasks.md), 18 задач. План расширяет существующие Plan/PlansService/ExpensesService/BudgetWrite/actor resolver, включает безопасный backfill с dry-run/explicit apply, category RESTRICT/worker/audit/индексы/seeds. Новые group routes используют close, как личные; group archive detail доступен, includeArchived включает архив в список. Сам план не резервирует и не тратит деньги, расход close учитывается один раз. Сохранены личные DTO/minimum/снимки; group KWD 0.001 проверяется отдельно. Миграция рабочей базы автоматически не запускается.

`openspec validate add-group-budget-plans --strict --no-interactive` — valid, exit code 0; status — 4/4 planning artifacts complete. `git diff --check` — exit code 0. Self-review: scope/решения/DTO/задачи согласованы, deferrable product-вопросов и placeholder нет; все прежние budget-ownership сценарии сохранены. Реализация, unit/e2e/build и миграция этапа 08 не выполнялись. Следующий шаг — apply по отдельной команде; после проверок/ревью первый коммит без co-authored → sync/архив → второй коммит. Этап 09 не создан.

Журнал реализации (2026-10-18): один Plan/PlansService с ownerType/ownerId/createdBy обслуживает личные и групповые маршруты; GroupPlansService — адаптер текущих прав и BudgetWrite. Close использует общий ExpensesService и supplied ClientSession, сохраняя planned amount/expenseId/origin и личный snapshot carry. Group KWD 0.001, строгие DTO, стабильная пагинация/includeArchived и архивные детали проверены HTTP. Общий actor resolver не требует фиктивного type у плана. Category RESTRICT, owner-scoped worker/diagnose и integrity audit сохраняют историю группы; seeds содержат active и closed family Plan с настоящим расходом 1200 при плане 1000.

Совместимость до refactor: plans unit 17/17, plan-debt-lifecycle/multicurrency 10/10 и новый personal characterization 5/5. После refactor: plans unit 25/25 и personal/lifecycle/multicurrency 15/15. Group route RED до подключения: POST plans ожидал 201, получил 404. Конкурентные проверки с explicit barriers — 37/37: close/close, PATCH/archive/delete, счета/категории, отзыв прав/выход/смена владельца/удаление группы в обоих порядках; create/PATCH категории против archive/delete; rollback после expense, Plan update и actor lookup. Узкие group API/seed — 13/13, включая report/revenue/limit после close/PATCH/DELETE расхода и повторное создание индексов до трафика.

Миграция: отдельный maintenance:plan-owners по умолчанию dry-run, только --apply пишет. На disposable replica set проверены сам helper и CLI dry-run/apply/повтор0, неизменность дат/финансовых связей, tombstone, частичные/конфликтные owner-поля, отсутствующие/чужие ссылки и отсутствие изменений групповых Plan. Raw hex-строки вместо BSON ObjectId диагностируются; владельцы не угадываются. При конкурентном назначении отсутствующего owner CAS не должен его переписывать. Рабочая база не мигрировалась, destructive seed/reset не запускался, live API и внешняя публикация не проверялись.

Независимое ревью обнаружило и исправило ложный запрет разных категорий Plan/исправленного expense, принятие строковых BSON-ID и пропуск closed без expenseId; обе категории отдельно проверяются на бюджет, origin/expenseId взаимны. Root дополнительно обнаружил гонку отсутствующих полей CAS; добавлен регрессионный тест сохранения конкурентно назначенного владельца. Все замечания устранены; повторное независимое ревью, включая CAS, не нашло блокирующих проблем. Этап 09 не создан.

Финальная проверка (2026-10-18), все exit code 0:

- `npm run test -- --runInBand` — 57 suites, 352/352 tests passed.
- `npm run test:e2e -- --runInBand` — 40 suites, 358/358 tests passed, без skipped; disposable replica sets, 194.054 s.
- `npm run test:e2e -- --runInBand test/plan-owner-backfill.e2e-spec.ts test/group-plans-lifecycle.e2e-spec.ts test/entity-deletion-integrity.e2e-spec.ts` — 3 suites, 22/22 tests после последнего CAS fix; сам backfill содержит 15 тестов.
- `npm run build` — успешно после последнего изменения helper.
- Scoped `npx eslint --no-warn-ignored` — 27 изменённых/new TS файлов, 0 ошибок/предупреждений; `npx prettier --check` — 41 изменённый/new TS/Markdown/JSON файл, passed.
- `git diff --check`; `openspec validate add-group-budget-plans --strict --no-interactive` — passed. Все delta-сценарии сопоставлены с personal compatibility, group HTTP/concurrency/lifecycle/backfill и seed assertions.

18/18 задач выполнены. Документация: group-finances-api/groups-api, shared core/inventory, entity-deletion-api/rollout, seed expectations и этот журнал. Выполнен порядок: первый коммит реализации `6358dd4` (`Added shared budget plans`) → sync group-budget-plans/budget-ownership → архив → отдельный коммит архива. Рабочая БД и развёрнутый API не проверялись/не изменялись.

Архивирование (2026-10-18): [2026-10-18-add-group-budget-plans](../openspec/changes/archive/2026-10-18-add-group-budget-plans/proposal.md). Создан main spec group-budget-plans с authored Purpose и 9 требованиями; в budget-ownership обновлены 2 требования, прежний Purpose/сценарии и остальные требования сохранены. После sync проверено полное совпадение delta-блоков с main, без delta headers/TBD. `openspec validate --specs --no-interactive` — 16/16 passed, exit 0; прежние предупреждения о длине unrelated требований сохранены. Strict validation change перед переносом — valid, exit 0; `openspec list --json` после переноса — changes=[]. Все 18 задач завершены; этап 09 не создан. Следующее действие — отдельно спланировать общие долги.

## 09. Общие долги

- [x] Создан change.
- [x] Применён; совместимость/миграция проверены.
- [x] Тестирование и build успешны; результаты записаны.
- [x] Архивирован; main specs синхронизированы.

Объём: расширить существующие Debt, DebtsService, историю погашений и Transaction.origin на владельца бюджета; один механизм для user/group. Контрагент, валюта, principal/remaining, список/детали/update/close/archive, частичные погашения, отмена и связанные финансовые движения. Автор отдельно от бюджета, исторические субъекты через этап 07.

Решения ниже согласованы до создания change. Сохранить смысл личных долгов, расширить lifecycle-защиту и мигрировать владельца безопасно, без угадывания связи старых погашений и доходов.

Приёмка: оба супруга видят один долг и историю; погашение атомарно меняет remaining и семейные деньги; повтор/конкурентное погашение и отмена не удваивают движение, личные данные независимы, выход автора не уничтожает историю.

Подготовка (2026-10-18): этап 08 закрыт коммитами `6358dd4` / `2113c37`. Исследованы Debt/DebtsService/DTO/controller, DebtTransaction и read-only history, origin, lifecycle и seeds. Личный долг означает «нам должны»: repay уменьшает remaining, optional isIncome создаёт доход; некассовый вариант существует. Create не двигает деньги; переплата запрещена. PATCH допускает principal/remaining/status независимо от истории, отмены repayment нет, история пока не хранит прямую ссылку на созданный доход. Отдельное изменение/удаление дохода не синхронизирует remaining — это нужно явно разрешить или запретить для нового группового контракта, сохранив личную совместимость.

Согласовано пользователем (2026-10-18): только «нам должны»; финансовые и некассовые погашения; создание долга само не двигает деньги, переплата запрещена. Исправление финансового погашения — отмена с атомарным восстановлением remaining и компенсацией денег, затем новая запись; отдельные PATCH/DELETE связанного группового дохода запрещены, личный контракт сохраняется.

Дополнительно подтверждено: initial remaining=principal; principal меняется только до первой истории, включая отменённую; remaining/status не принимаются вручную. Нулевой остаток закрывает долг, отмена открывает его снова. Списание без денег — noncash repayment. Управление долгом, погашение, отмена, архив и удаление доступны действующему автору **долга**, owner или manageTransactions. Автор погашения фиксируется отдельно, но сам по себе прав не даёт.

Журнал планирования (2026-10-18): создан [proposal](../openspec/changes/archive/2026-10-18-add-group-budget-debts/proposal.md), [design](../openspec/changes/archive/2026-10-18-add-group-budget-debts/design.md), четыре delta specs (group-budget-debts, budget-ownership, group-transactions, entity-deletion-lifecycle) и [tasks](../openspec/changes/archive/2026-10-18-add-group-budget-debts/tasks.md), 20 задач. Новая capability содержит 11 требований; модифицированные блоки сохраняют все прежние сценарии. Тонкий group adapter использует общие Debt/DebtTransaction, IncomesService/TransactionsService и supplied session. Group history — /repayments, финансовые записи имеют точный incomeId; отмена сохраняет историю и soft-delete income/origin. Обычный group income PATCH/DELETE защищён409 после прав/активного счёта; архив счёта сохраняет404. При создании долга денег нет, active/closed определяет remaining, partial cancel/«мы должны»/ручные remaining/status не входят в scope.

Backfill только достоверных BSON owner/creator Debt и истории, parent-first, dry-run/explicit apply/повтор0, CAS отсутствующих полей; legacy personal incomeId/isIncome не угадываются и остатки не пересчитываются. Запланированы реальный worker/integrity audit, indexes до трафика, shared actors включая cancelledByActor и детерминированные fixtures с точной денежной приёмкой. Рабочая база не мигрируется автоматически. Личный wire format и manual remaining/status сохраняются; в общем session/CAS пути запланировано устранение lost-update конкурентных погашений с отдельной регрессией.

Проверка планирования: `openspec validate add-group-budget-debts --strict --no-interactive` — valid, exit0; status4/4 artifacts complete, 0/20 задач реализации. Scoped Prettier и `git diff --check` — exit0. Unit/e2e/build и реализация этапа09 не запускались. Self-review сопоставил договорённости/контракт/design/tasks и проверил сохранность прежних scenarios; main specs/Purpose не изменялись. Следующий шаг — apply по отдельной команде. Порядок сохранён: реализация/проверки/независимое ревью → первый коммит без co-authored → sync четырёх delta → архив → второй коммит. Этап10 не создан.

Журнал реализации (2026-10-18): общий Debt/DebtTransaction с бюджетом/автором, personal adapters и supplied session обслуживает оба вида бюджета. Group adapter не содержит CRUD/денежной арифметики. Repay перечитывает remaining внутри transaction retry/CAS; исправлена потеря одновременных личных погашений. Financial group history сохраняет точный incomeId/origin; cancel использует общий soft-delete/компенсацию исходной даты, остаётся в истории и открывает долг. Обычный income PATCH/DELETE защищён после прав и account lookup, архив сохраняет404. Group remaining/status запрещены также при прямом вызове общего сервиса. Schema metadata погашения не просачивается в личный wire format.

Проверки до refactor: debts unit1/1, lifecycle/multicurrency10/10, новый personal characterization2/2. После расширения characterization3/3 с rollback/currency/precision/manual-state и snapshot carry. Group route RED: ожидаемый201 получил404 до подключения. Shared core unit14/14; concurrency53/53 с explicit barriers, personal60+60/100, обеими последовательностями изменений прав/lifecycle и восемью фазами rollback. Расширенные group HTTP+seed2 suites14/14 включают strict isIncome, frozen principal, cancelled history pagination, actor batch, revoked executor, spent/backdated/future income compensation, expense revenue/limit invariance и оба семейных просмотра fixtures.

Migration/lifecycle: реальный helper/CLI default dry-run/apply/повтор0, owner CAS, parent race и восстановление временного marker проверены только на disposable replica sets; Plan migration regression сохранена. Mongo no-op не даёт write fence: выявлено RED и исправлено временной записью/восстановлением в той же транзакции. Worker сохраняет Debt/history/income двух групп автора, удаляя personal owner записи; pending/tombstone actor обезличен. Audit проверяет точные взаимные ссылки/состояния и групповой remaining/status; его денежная проверка переведена на общие currency/precision/normalizeMoney вместо отдельного epsilon. Шесть регрессий включают coherent invalid precision и неподдерживаемую валюту; валидные float sums/JPY/KWD принимаются. Повторный index startup сохраняет legacy индексы и допускает missing personal incomeId, duplicate ObjectId incomeId запрещён.

Документация group-finances-api/groups-api/core/inventory/entity-deletion-api/rollout/seed обновлена. Два семейных долга/четыре history создаются общими сервисами; cash1200 остаётся доходом, cash500 отменён, noncash300/1000 не двигают деньги. Итоги Family271749.5/balance291749.5/incomes181200/expenses28450.5/saving51000/limit rest40349.5; raw active-group transactions12, active11. Личные fixtures сохранены. Рабочая БД/seed/reset/live API и внешняя публикация не выполнялись.

Независимое ревью основного пути, owner migration fence/CAS и последнего currency audit не нашло блокирующих замечаний. Внутренний guard remaining/status усилен отдельными RED→GREEN тестами. Все 20 задач завершены. Финальные проверки после последнего изменения аудита (2026-10-18), все exit0:

- `npm run test -- --runInBand` — 58 suites,372/372 tests passed.
- `npm run test:e2e -- --runInBand` — 45 suites,438/438 tests passed,213.186 s; disposable replica sets, без skipped.
- `npm run build` — успешно.
- Scoped `npx eslint --no-warn-ignored` —31 изменённый/new TS файл,0 ошибок/предупреждений; `npx prettier --check` —47 TS/Markdown/JSON файлов,passed.
- `git diff --check`; `openspec validate add-group-budget-debts --strict --no-interactive` —passed;20/20 tracked tasks.

Первый полный unit выявил устаревшее ожидание фильтра history без owner-пары: проверка обновлена на обязательные userId/ownerType/ownerId и повторный полный набор прошёл. Все delta-сценарии сопоставлены с personal compatibility, group HTTP/concurrency/lifecycle/migration/audit и seed assertions. Реальные денежные проверки ограничены локальными disposable DB; рабочая база/live API не проверялись и не изменялись. Выполнен порядок: первый коммит `6c4a080` (`Added shared budget debts and repayments`) → sync четырёх delta → архив → отдельный коммит архива без co-authored. Этап10 не создан.

Архивирование (2026-10-18): [2026-10-18-add-group-budget-debts](../openspec/changes/archive/2026-10-18-add-group-budget-debts/proposal.md). Создан main group-budget-debts с authored Purpose и11 требованиями; обновлены budget-ownership2/group-transactions1/entity-deletion-lifecycle3 требования. Сохранены прежние Purpose и сценарии, остальные блоки не изменены. Все delta-блоки сверены с main, delta headers/TBD отсутствуют. `openspec validate --specs --no-interactive` —17/17 passed,exit0; существующие предупреждения о длинных требованиях не устранялись сокращением несвязанных specs. Strict change перед переносом —valid,exit0; после переноса `openspec list --json` —changes=[]. Все20 задач завершены; этап10 не создан. Следующий шаг — отдельно спланировать финальную сверку исходных frontend gaps.

## 10. Финальная сверка семейного контракта

- [ ] Создан change.
- [ ] Применён; документация/fixtures актуальны.
- [ ] Все интеграционные проверки и build успешны; результаты записаны.
- [ ] Архивирован; полнота дорожной карты подтверждена.

Объём: финальный audit покрытия исходных §1–10, документация групп и финансов, точные DTO (optional/nullable, id/_id, owner/author, pagination, ошибки), сценарии миграции/развёртывания, детерминированные fixtures и сквозной тест семьи. Не переименовывать идентификаторы ради косметики. В первую очередь расширять существующие e2e и docs, не создавать дублирующую систему контрактов.

Приёмка: два пользователя с разными личными валютами, личные бюджеты и две группы; приглашение → собственные права → семейные счета → доход/расход → резерв/перевод → план → долг → отчёты → отзыв прав → выход → обезличенная история. Подтвердить валютные корзины, отсутствие двойного учёта, UTC, миграцию старых данных и отсутствие утечек между бюджетами. Все общие финансовые механизмы действительно используются обоими видами владельца.

Если поведение не меняется, `skip_specs: true`: обновляются docs/tests, main specs уже синхронизированы предшествующими change. Обнаруженный новый дефект вынести в явно описанный change, а не расширять незаметно финальный audit. Публикация во внешний Postman workspace или другая внешняя публикация в этот план не включена.

Журнал: не начат.

## Шаблон записи результата этапа

Заполнять в разделе соответствующего этапа. «Не запускалось» и «не применимо» записывать явно, не считать успешной проверкой.

```text
Дата:
Change и ссылка на артефакты:
Принятые решения / изменения объёма:
Применение: завершено / не завершено; ссылка на commit при наличии:
Проверки: точная команда → exit code, tests passed/failed/skipped:
Среда: unit / локальная MongoDB replica set / live API; ограничения:
Миграция: что сделано, dry-run/повторный запуск/откат или не применимо:
Общие механизмы: что переиспользовано, какие дубли удалены:
Документация и потребительский контракт:
Ревью / оставшиеся блокеры:
Архив: дата и фактический путь; main specs синхронизированы:
Следующий этап и следующее действие:
```

## Границы плана

Переключатель бюджета, ключи кэша, возврат после регистрации, хранение приглашения до входа и закрытие форм при переключении — задачи фронта. Создание «группа + кошелёк» атомарно не требуется. Межбюджетные переводы и новые административные роли не добавляются без отдельного решения. План описывает локально исследованную систему; состояние развёрнутого API не проверялось.
