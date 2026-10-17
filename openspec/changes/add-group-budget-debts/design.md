# Design

## Context

См. proposal.md — Why. Все продуктовые решения подтверждены 2026-10-18: только receivable, финансовые/некассовые погашения, отмена и новая запись вместо изменения дохода; initial remaining=principal, principal заморожен после первой истории, права по автору долга/owner/manageTransactions.

Debt/DebtsService сейчас userId-scoped; личный create/PATCH принимает remaining/status, repay опционально создаёт Income через isIncome, возвращает Debt. DebtTransaction хранит userId/debtId/amount/transactionDate/description, но не incomeId/тип погашения/отмену. Личные GET history находятся под /debts/:debtId/transactions и читают родителя по userId, включая архив. Сервис проверяет remaining перед началом транзакции и затем записывает вычисленное значение — этот участок нельзя переносить в общий путь без проверки актуального состояния внутри сессии.

Имеются общие IncomesService.createForBudget, TransactionsService.deleteForBudget, BudgetWrite group serialization, account locks, money utilities, personalResponse и actor resolver. IncomesService пока отбрасывает origin для group; это нужно изменить аналогично ExpensesService этапа 08. Worker удаляет Debt/DebtTransaction по userId; audit знает parent debt/user, но не новый budget/income/cancellation invariant. Backfill Plan даёт проверенный raw CAS-паттерн с проверкой отсутствия заполняемых полей.

## Goals / Non-Goals

**Goals:** один Debt/DebtTransaction и один денежный путь для user/group; явная и проверяемая связь группового repayment с доходом; атомарное погашение/отмена без потери финансовой истории. Личный wire format и допустимые ручные корректировки сохраняются.

**Non-Goals:** «мы должны», выдача займа расходом, проценты/рассрочки, взаимозачёт между бюджетами, отдельная модель контрагента, partial-cancel/edit repayment, прямое изменение группового remaining/status, idempotency keys, восстановление архива, угадывание legacy incomeId. Этап 10 не включён.

## Decisions

### 1. Общий агрегат долга и разные совместимые политики

Расширить существующие Debt и DebtTransaction immutable ownerType/ownerId/createdBy; userId остаётся только личным. Group history поля не имеют общих schema defaults: isIncome/incomeId/cancelledAt/By записываются только групповым путём, cancelledAt=null задаётся им явно; incomeId после создания неизменяем. Debt.currency immutable, история наследует валюту родителя без клиентского currency input. Не вводить direction с единственным значением или GroupDebt/GroupRepayment.

DebtsService предоставляет createForBudget/listForBudget/getForBudget/updateForBudget/removeForBudget/archiveForBudget/repayForBudget/cancelRepaymentForBudget, принимает BudgetContext, actor и supplied ClientSession для мутаций. Он координирует Debt и запись истории как один агрегат. DebtTransactionsService остаётся общим read service с listForBudget/getForBudget, проверяя и бюджет родителя, и владельца записи. Личные методы — adapters personalBudget/personalResponse; личные DTO/маршруты/ответы не заменяются групповыми. Модули экспортируют сервисы/модели; групповой адаптер находится в GroupFinancesModule и не выполняет MongoDB CRUD/денежную арифметику.

Group create вычисляет remaining=principal/status=active; group principal PATCH до любой истории обновляет обе суммы. Даже отменённая история запрещает principal PATCH с 409. Metadata PATCH допустим у closed, но не archived. Group remaining/status не принимаются и не меняются из UI кроме repay/cancel. Личные create/PATCH сохраняют manual remaining/status, nullable/empty/archive особенности и минимум DTO 0.01; group schema/service допускают положительный minor unit KWD 0.001, используя общие precision/normalizeMoney. Личные исторические remaining не пересчитываются по новой групповой формуле.

Общий repay читает актуальный Debt внутри supplied session, проверяет active/unarchived, amount/remaining и делает условную запись. Личный wrapper владеет одной транзакцией, group wrapper использует BudgetWrite. Повтор транзакции обязан перечитывать remaining, а не повторно применять значение, вычисленное до сессии. Исправляется потеря одновременных личных погашений в рамках общего механизма; обычные личные запросы/ошибки/снимки сохраняются characterization. Не сохранять known lost-update ради совместимости.

Интерфейсы для handoff: `createForBudget(budget, actorId, command, session)`, `updateForBudget(budget, debtId, command, session)`, `removeForBudget(budget, debtId, session)`, `archiveForBudget(budget, debtId, session)`; `repayForBudget(budget, actorId, debtId, command, session)` и `cancelRepaymentForBudget(budget, actorId, debtId, repaymentId, session)` возвращают `{ debt, repayment }`. `listForBudget(budget, query)` возвращает pagination, `getForBudget(budget, debtId, session?)` — Debt с прежней личной archive-политикой и читаемым group archive. DebtTransactionsService `listForBudget(budget, debtId, query)`/`getForBudget(budget, debtId, repaymentId, session?)` проверяет parent ownership независимо от архива.

Команды — структурные типы в owning debts domain: create допускает optional remainingAmount/status только для личного адаптера, group всегда вычисляет их сервером; update расширяет личный тип dueDate до `string | null` с разными nullable-политиками; repay совместим с существующим RepayDebtDto, но group требует явный isIncome. Не заставлять group DTO наследовать личный required remainingAmount. Распределение файлов: общие сервисы/схемы — существующие `src/modules/debts/` и `debt-transactions/`; group адаптер/controller/DTO — `src/modules/group-finances/group-debts.*` и `dto/group-debts.dto.ts`; backfill — `src/database/integrity/debt-owner-backfill.ts`, CLI — `src/database/backfill-debt-owners.ts`. Новые тестовые файлы перечислены в tasks.md.

### 2. Точный групповой HTTP-контракт

Пути относительно /api/v1/groups/:groupId, глобальный JWT/strict ValidationPipe:

| Метод  | Путь                                      | Результат                                      |
| ------ | ----------------------------------------- | ---------------------------------------------- |
| POST   | /debts                                    | 201 Debt                                       |
| GET    | /debts                                    | 200 items/total/page/limit                     |
| GET    | /debts/:id                                | 200 Debt, включая архив                        |
| PATCH  | /debts/:id                                | 200 Debt                                       |
| DELETE | /debts/:id                                | 204, только без истории/доходов и архива       |
| POST   | /debts/:id/archive                        | 204; повтор 404                                |
| POST   | /debts/:id/repayments                     | 201 { debt, repayment }                        |
| GET    | /debts/:id/repayments                     | 200 items/total/page/limit, включая отменённые |
| GET    | /debts/:id/repayments/:repaymentId        | 200, включая отменённую/архивный parent        |
| POST   | /debts/:id/repayments/:repaymentId/cancel | 200 { debt, repayment }; повтор 409            |

Для group history использовать единый noun repayments, без дополнительного transactions-алиаса. Существующие личные /debts/:id/transactions и POST repayments остаются прежними, личный repay возвращает только Debt. Отдельный group close endpoint не нужен: полное финансовое или некассовое погашение закрывает долг. Manual status/reopen не принимаются; отмена автоматически открывает closed.

Create: debtor trim 1–150, principalAmount положительная/конечная/precision валюты, currency trim/uppercase, optional description trim до 150, optional dueDate strict ISO (прошлый/будущий срок допустим). PATCH только debtor/description/dueDate/principalAmount, непустой; dueDate=null очищает срок, null остальных полей — 400; description='' допустимо для очистки. Незнакомые/owner/actor/status/remaining/currency/direction поля — 400. Никаких UserId в debtor: это существующая свободная строка контрагента, не профиль участника.

Repay: amount положительная, repaymentDate strict ISO, **isIncome обязателен и только boolean** (не truthiness; строки true/false, числа и null отклоняются несмотря на implicit conversion), optional description до 1000, accountId обязателен при true и запрещён при false. У группового API нет default account. Если описание не задано, group history/income получают «Погашение долга <debtor>»; последующее переименование контрагента не переписывает денежную историю. Частичное списание без денег — isIncome=false. Любая дата допустима для noncash; финансовая не раньше openedAt. DueDate/createdAt не ограничивают repaymentDate. Отмена имеет пустое body/query, неизвестные поля — 400.

Debt list: status active|closed, currency, includeArchived явно true|false, page/limit; default архив скрыт, true включает всё. Sort createdAt DESC/_id DESC. History sort transactionDate DESC/createdAt DESC/_id DESC, pagination, все записи без фильтра cancelled. Детали архива читаются; PATCH/repay/cancel — 404, DELETE архивного — 409. Closed repay — 400, history delete/edit отсутствуют. Currency/precision и переплата — 400, несовместимое состояние/связи — 409, инфраструктурная ошибка group mutation — 503.

Group Debt DTO: существующие поля + ownerType/ownerId/createdBy/createdByActor, без userId/participant/type. Repayment DTO: _id, ownerType/ownerId, debtId, createdBy/createdByActor, amount, transactionDate, description, isIncome, cancelledAt (null либо дата), timestamps; финансовая запись имеет incomeId, отменённая — cancelledBy/cancelledByActor. Отдельного дублирующего status у repayment нет. Деньги истории выражены в immutable Debt.currency; incomeId не принимается от клиента.

### 3. Права и исторические субъекты

Group adapter проверяет read через BudgetAccess, мутации через BudgetWrite.run и текущий memberContext. Create/read доступны любому активному члену; остальные действия требуют createdBy **долга**, owner либо manageTransactions. Автор repayment/income не получает исключения: после отзыва делегирования он не может отменить чужой долг. Settings-only не дают этих прав. Foreign debt/repayment и former/deleted group — 404, член без права — 403. Перед отменой сначала проверить доступ/права на долг, затем запись того же долга и бюджета.

Переиспользовать GroupFinancialActorsService для Debt и history без fake type. Расширить вход/результат optional cancelledBy/cancelledByActor с той же политикой active-only User projection; единый deduplicated batch на страницу и на составной mutation response, не отдельный User lookup в Debt service. История имени автора не копируется. Mutation actors готовятся до commit в той же сессии; lookup failure откатывает операцию. Никаких participantActor у Debt/history.

### 4. Погашение и точная связь с доходом

В одной внешней сессии: сериализовать group/проверить права; прочитать актуальный debt; проверить positive/precision/remaining; при isIncome=true получить активный account того же budget/currency/date, создать доход через IncomesService.createForBudget с origin={type:'debt',id:debtId}; создать DebtTransaction с точным incomeId; условно уменьшить remaining и закрыть при нуле. При isIncome=false доход/счёт не создаются и accountId отсутствует. Actor history/income — исполнитель, Debt.createdBy не меняется.

Сохранить общий TransactionOrigin без нового типа/repaymentId: origin.id по-прежнему указывает на Debt, прямой incomeId в новой групповой истории однозначно определяет конкретное погашение. История финансового погашения не должна коммититься без incomeId; для связи добавить unique partial index по incomeId типа ObjectId, не затрагивающий legacy missing поля. Обратный audit ищет единственную историю по incomeId и тому же debt/budget. Не искать доход только по origin.id: один долг имеет много доходов.

У личной истории owner/createdBy скрыты personalResponse; isIncome/incomeId/cancelledAt group metadata не добавляются в legacy DTO. Общий executor сохраняет необходимые group-поля по бюджетной политике, личный origin и income.source/response/snapshot carry остаются прежними. В IncomesService убрать group-отбрасывание **переданного** server origin, не разрешать origin в клиентском DTO.

Инвариант группы: remaining = normalizeMoney(principal − сумма неотменённых DebtTransaction.amount), status=closed тогда и только тогда, когда remaining=0. Financial/noncash суммы одинаково гасят долг; только financial меняет cash. Дата истории и дохода совпадает, положительная сумма не превышает remaining. Повторный POST без idempotency key создаёт другую запись при достаточном remaining; не дедуплицировать по сумме/дате.

### 5. Отмена и защита обычного income API

Cancel читает Debt (unarchived, active или closed) и точную uncancelled историю. Для financial валидирует incomeId, тот же budget, active Income, origin.debtId, amount/currency/transactionDate, а затем активный account; исчезнувшая/удалённая/несогласованная денежная запись — 409, архивный account — 404. Несоответствие не исправляется догадкой. Для noncash incomeId отсутствует, account не нужен.

Использовать существующий TransactionsService.deleteForBudget для soft-delete и компенсации original transactionDate, а не создавать отрицательный доход/искусственный перевод или новую ledger-арифметику. Group cancellation допускает отрицательный cash после уже потраченного дохода, как обычное удаление группового дохода. Условно пометить историю cancelledAt=now/cancelledBy=actor, восстановить remaining и status=active; сохранить incomeId, amount, origin и createdAt финансовой операции; updatedAt меняется обычным soft-delete. Повтор отмены — 409 без второй компенсации. Невозможный remaining>principal — 409 integrity conflict, не clamp.

Групповой адаптер обычных income mutations после текущих прав, owner lookup и проверки активного account отвергает любой PATCH/DELETE server origin.type=debt с 409. Именно debt cancellation вызывает общий внутренний финансовый delete. Не добавлять клиентский bypass flag или альтернативный DELETE route. Проверить все обычные HTTP пути: group incomes, personal incomes/generic transactions (чужой бюджет 404). У неуполномоченного group income автора/плана нет права на debt cancellation; обычные правила прав income и активный счёт проверяются до защитного 409, архив сохраняет404. Личные origin-доходы остаются редактируемыми/удаляемыми по прежнему контракту, их remaining автоматически не переписывается.

Debt archive замораживает в том числе noncash cancel; нет restore. Архив счёта замораживает только финансовые изменения этого счёта; noncash repay/cancel остаётся возможным при unarchived debt. Любая история (даже полностью отменённая) или исторический origin-income защищает Debt DELETE, soft-deleted доход защищает account DELETE. Group deletion закрывает все маршруты с сохранением данных.

### 6. Backfill, cleanup, integrity и индексы

Новые Debt/DebtTransaction сразу получают бюджет/автора. Отдельный maintenance:debt-owners с existing config/secrets, default dry-run и explicit --apply; без seed/полной lifecycle migration/реальной БД. Raw update добавляет только отсутствующие owner/creator и CAS-проверяет исходные значения **и отсутствие всех заполняемых полей**. Только BSON ObjectId, существующий user (включая tombstone); история должна иметь существующего личного parent Debt с тем же user/budget. Parent-first apply; dry-run проверяет ожидаемые parent-поля без writes. После конфликта/concurrent parent change dependent запись не заполняется.

Не менять principal/remaining/status, даты/createdAt/updatedAt/archivedAt, amounts/currency, income origin или личную ручную историю; не применять новый group invariant к personal. Не угадывать isIncome/incomeId legacy истории по сумме/дате/description или количеству доходов; поля остаются отсутствующими. Частично установленные owner/createdBy проверяются, не перезаписываются; группы пропускаются; orphan/cross-budget/string-ID/conflict сообщаются с IDs без секретов. Apply/повтор0 и CLI проверяются на disposable replica set. Использовать уже проверенный подход Plan backfill и небольшие общие raw-owner/CAS helpers, если это уменьшает дублирование; не строить новый migration framework и не менять семантику Plan maintenance.

Worker/diagnose используют personal owner filters для обоих типов после backfill, сохраняя записи группового автора. Audit расширяется Debt/DebtTransaction owner/creator/parent и group incomeId/origin/amount/currency/date, cancelledBy и group remaining/status invariant. Проверять financial history ⇔ income взаимно, noncash отсутствие incomeId, un-cancelled финансовый income active, cancelled financial income soft-deleted; такой soft-delete не orphan. Legacy personal incomeId не требуется; отсутствие достоверной старой связи не объявлять новой групповой ошибкой. Существующий relation reader переиспользовать; агрегат remaining/status добавить узкой проверкой долга, без второго финансового движка.

Сохранить legacy индексы Debt/DT, добавить owner-scoped debt list (включая status/currency/archive/_id), history budget/debt/date/_id и unique partial incomeId. Дождаться additive createIndexes для обеих моделей до HTTP тем же module lifecycle паттерном, без drop/syncIndexes. Test повторного startup сохраняет индексы. Новых env/секретов нет.

### 7. Fixtures, доказательства и порядок работ

До refactor характеризовать личные CRUD/PATCH/null/empty/manual remaining/status/archive/history, min0.01, оба repay режима, origin/source/response/currency errors и snapshot carry; сохранить старые nullable/archive quirks. Добавить group routes/authority/financial cancel RED до реализации. Для concurrent personal repay добавить отдельную регрессию lost-update и проверить новый общий session/CAS путь, не менять обычный личный смысл.

Реальные barrier-тесты: repay/repay, cancel/cancel, repay/cancel, principal PATCH/первая история, metadata/archive/delete vs repay/cancel; account archive/delete, revoke/remove/ownership/group delete в обоих порядках. Инъекции failure после income create/soft-delete, history create/cancel, debt update и actor enrichment откатывают весь raw state, account snapshots и mutation versions. Проверить backdated/future dates, RUB/JPY/KWD, две группы+личный budget, settings-only/revoked repayment author, архивную историю и spent-income cancellation.

Расширить семейные seeds сервисами: Debt 4000 с financial repayment 1200, noncash 300 и отменённым financial 500 → remaining2500, активный income1200; второй Debt1000 закрыт noncash1000. Два Debt, четыре истории, два новых raw income (один soft-deleted), прирост active ledger только1200. От этапа08 ожидаются primary Family271749.5, aggregate balance291749.5, incomes181200, expenses28450.5, saving51000, limit rest40349.5; across active groups raw transactions12/active11. Проверить одинаковое чтение супругами, origin/incomeId/cancellation actors и прежние личные fixtures; не запускать destructive seed на рабочей БД.

Документировать DTO/routes/статусы/права/наследуемую валюту/несколько погашений/отмену и personal differences; актуализировать group finances/groups API, core/inventory, entity deletion/rollout/seed и roadmap. Полные unit/e2e/build, scoped lint/format, diff, strict change validation и независимое ревью до первого коммита. Sync/архив только после коммита реализации, затем второй коммит без co-authored.

## Risks / Trade-offs

- Legacy история не знает incomeId → backfill только достоверного owner; не включать group cancellation для personal и не реконструировать связь.
- Новый group invariant строже personal → отдельные явные policy branches внутри общего сервиса и wire characterization; не пересчитывать старые остатки.
- Один group income нельзя исправить отдельно → 409 с документированной отменой и новой записью; гарантировать атомарную компенсацию, включая закрытый долг.
- Group income author и debt authority различаются → права debt на cancellation, прежние income rights перед защитным 409, revoked/ownership tests.
- Backdated cancel меняет историю отчётов и может сделать cash отрицательным → тот же original-date delete/rebuild и та же групповая политика, без нового алгоритма.
- Защита только одного HTTP entry point могла бы оставить обход → инвентаризировать и протестировать все income/generic transaction write routes, не добавлять bypass DTO.
- CAS/parent backfill может столкнуться с новым владельцем → отсутствие заполняемых полей в CAS, parent-first проверка, explicit maintenance window, conflict report.

## Migration Plan

Остановить запись Debt/истории и связанных финансовых ссылок на время maintenance; backup. Выполнить debt-owners dry-run, разобрать issues без догадок, explicit apply, повтор с candidates/updated0 и integrity audit. Затем включить backend с индексами, проверить старые personal debts/history и group repay/cancel. В задаче только disposable DB, production rollout отдельно.

Откат: сохранить коллекции/поля/историю, выключить group debt writes; прежний worker и прямые income mutations не понимают group ownership/cancellation. Нужна согласованная версия с защитой этих путей, а не purge новых данных/удаление owner. Backup не применяется для повторного получения уже отменённого дохода. Новые поля обратно автоматически не стираются, персональные данные не восстанавливаются.
