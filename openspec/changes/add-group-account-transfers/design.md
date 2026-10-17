# Design

## Context

См. proposal.md. Этап 04 зафиксирован fac8ec5. Transfer discriminator уже содержит source/destination { accountId, snapshotId, amount, currency }, общий owner/author/deletion audit и дату. TransfersService пока использует personalBudget, личные snapshots и персональную сериализацию. Общие BudgetContext, BudgetWriteService и account lifecycle/locks уже обслуживают user/group.

Групповой balanceForBudget пока ищет только верхнеуровневый accountId и amount, поэтому source/destination effects не увидит. Групповой history filter аналогично упрощён до прямого accountId. ReportsService уже умеет aggregateTransfers, но вызывает его только для user. Это конкретные места расширения; второго ledger или report engine не требуется.

## Goals / Non-Goals

**Goals:** один Transfer/TransfersService для обоих бюджетов, атомарность обеих сторон и согласованный финансовый контракт; сохранить личные snapshots и текущий личный HTTP-контракт.

**Non-Goals:** межбюджетные переводы даже при общем участнике, комиссии, внешний FX, изменение дат/счетов, group defaultAccountId, новые модели, ключ идемпотентности, переработка личных календарных/исторических особенностей.

## Decisions

### 1. Общий сервис, тонкий групповой адаптер

Расширить существующий TransfersService budget-scoped методами create/list/get/update/delete; личные методы остаются совместимыми обёртками, GroupFinancesController или небольшой group transfer adapter вызывает тот же сервис. Не копировать CRUD/валидацию/effects и не вызывать личный API внутренним HTTP.

Групповые мутации проходят BudgetWriteService.run и сериализацию группы в одной ClientSession. Создание требует действующее членство; update/delete проверяют owner либо active author либо effective manageTransactions. Настройки счетов/категорий/лимитов этого права не заменяют. Делегат может исправить перевод вышедшего автора, но createdBy не меняется, deletedBy хранит отменившего пользователя. Read проверяет актуальный доступ к группе.

Оба счёта разрешаются через общий active account lookup строго в переданном budget; locks — стабильный порядок ids. Для группы transactionDate проверяется относительно openedAt обеих сторон. Архив любой стороны даёт 404 на create/PATCH/DELETE; история читает архивные ссылки. Гонки с archive/revoke/remove/ownership/group deletion используют существующую групповую сериализацию, без process-local mutex.

### 2. HTTP и денежный DTO

| Маршрут относительно /groups/:groupId | Вход | Успех |
| --- | --- | --- |
| POST /transfers | sourceAccountId, destinationAccountId, sourceAmount, destinationAmount, transactionDate; optional description | 201, transfer DTO |
| GET /transfers | page/limit, accountId, currency, fromDate/toDate | 200, { items,total,page,limit } |
| GET /transfers/:id | без query | 200, transfer DTO |
| PATCH /transfers/:id | optional sourceAmount, destinationAmount, description; хотя бы одно поле | 200, transfer DTO |
| DELETE /transfers/:id | без body/query | 204 без тела |

Групповые DTO используют те же поля, что личные, и общие money utilities, сохраняя strict optional/nullable-поведение группового API: null/неизвестные поля/пустой PATCH — 400. Явные валюты, owner и author клиентом не принимаются. Личные DTO/null/пустой PATCH не менять этим change. Групповые даты строго ISO, суммы конечные >0 с minor units каждой стороны (нормализованная сумма также >0, значения ниже минимальной единицы не принимаются); same-currency суммы должны совпадать. Счета различны и принадлежат одной группе. effectiveRate = destination.amount / source.amount, baseCurrency=source.currency, quoteCurrency=destination.currency; внешний курс не загружается.

DTO сохраняет _id/type/createdBy/дату/описание и обе стороны с snapshotId; top-level amount/currency для transfer не выдумывать. Для dedicated и общей групповой истории возвращать одинаковый transfer monetary DTO с effectiveRate. Переиспользовать существующий mapper ответа TransfersService; при необходимости выделить маленький pure helper для rate, чтобы TransactionsService не импортировал TransfersService циклически. Личная mixed-history сериализация остаётся прежней.

Ошибки: validation/precision/одинаковые счета/дата до открытия/недостаток средств — 400, нет JWT — 401, недостаточные права действующего участника — 403, чужой/архивный/недоступный объект — 404; DB transaction failure — прежний нормализованный 503 группы.

### 3. Достаточность средств и повторы

Пользователь выбрал запрет недостатка source funds. Для группы до записи нового перевода читать balanceForBudget(source, transactionDate, session); требовать >= sourceAmount. При увеличении sourceAmount читать текущий ledger-остаток на эту дату с уже учтённой старой записью и проверять положительный extraDebit. Сравнение после currency normalization, в той же сессии и под locks. При уменьшении/description-only новой нагрузки на source нет. Проверка касается даты перевода, а не текущего остатка или всех будущих периодов; backdated обычные расходы сохраняют свои правила.

Личный путь сохраняет прежние findOrCreate/findBy snapshot-проверки и эффекты; не заменять их групповым ledger. Отдельного общего интерфейса policy с одной реализацией не нужно — сохранить существующее различие внутри общих budget-методов.

Отмена — обращение сохранённого факта по текущему личному правилу: не является новым исходящим переводом с целевого счёта и не проверяет достаточность destination. Поэтому после расходования зачисления возможен отрицательный destination, как и при отмене дохода; это явно закреплено сценарием. Обычный отрицательный баланс доходов/расходов не отменяется новым запретом source funds для переводов.

Повтор POST — новый факт с новым _id и обычной проверкой funds; поэтому при средствах только на один перевод второй получит 400. Повтор DELETE — 404 без второй компенсации. Ключ идемпотентности/автоматические retries не добавляются по выбору пользователя. Frontend не должен бездумно повторять POST после неизвестного сетевого исхода.

### 4. Общие эффекты с сохранением личной истории

Create: разрешить/заблокировать оба счёта, проверить даты/суммы/funds, подготовить оба snapshot, создать одну Transfer-запись, применить обе стороны через существующие budget-scoped snapshot methods. Update: загрузить и авторизовать активную запись, вычислить обе дельты/проверить funds и сохранить новые суммы **до** группового ledger rebuild. Delete: условно пометить active запись удалённой **до** rebuild, затем обратить обе стороны. Все шаги в одной ClientSession; rollback любой записи/второго эффекта возвращает всё.

Личному пути порядок сохранения до применения дельт не меняет итог в одной транзакции; сохранить существующие delta-величины и snapshots, включая исторические ручные корректировки. Подменять личный carry replay журналом запрещено.

Расширить существующий balanceForBudget group aggregate: owner + deletedAt:null + date<=requested + одна из ссылок accountId/source.accountId/destination.accountId. Для income/expense использовать ±amount, для transfer — -source.amount или +destination.amount выбранного счёта. Не суммировать две валюты и не учитывать запись дважды. rebuildForBudget пересчитывает month-end затронутого и всех последующих существующих snapshots для обоих счетов. Opening и UTC-политика прежние.

hasHistoryForBudget уже проверяет обе стороны и удалённые записи: сохранить RESTRICT, добавить тест именно на реально созданный групповой перевод. Legacy generic delete /transactions не должен обходить transfer service или компенсировать одну сторону: продолжить требовать dedicated маршрут для transfer.

### 5. Фильтры и отчёты

Групповой transactionType расширяется transfer, список /transactions включает одну запись на перевод. /transfers имеет fixed type; пагинация/порядок те же. accountId находит source **или** destination; currency находит top-level currency дохода/расхода либо currency любой transfer-стороны. Совместные accountId/currency/date/type-фильтры — AND условий над записью; account/currency могут совпасть с разными сторонами одного перевода. Использовать общий filter builder, сохранив обычные expense/category/participant filters и бюджетную изоляцию. Расходный revenue фиксирован type=expense, перевод туда не попадает.

Личные существующие фильтры и wire-контракт не расширять незаметно: текущий личный currency-filter обращается к top-level currency и не покрывает Transfer effects. Это существующая особенность вне группового change; сохранить её регрессией, возможное исправление выделить отдельно. Общие helper/query-фрагменты использовать повторно; owner-specific совместимость не превращать во второй движок.

ReportsService вызывает уже существующий aggregateTransfers и для группы. transfersOut = сумма source.amount по source.currency, transfersIn = destination.amount по destination.currency. Внутривалютный перевод показывает обе суммы, даже balance→balance; balance/saving отражают ledger на конец периода, incomes/expenses/categories/лимиты переводом не меняются. Category filters не ограничивают movements или остатки. Сохраняются UTC/full periods и сортировка currency buckets; удалённые переводы исключаются.

## Risks / Trade-offs

- Групповой ledger раньше видел только top-level accountId → регрессии обеих сторон на create/edit/delete/backdated и провал второго эффекта; порядок записи перед rebuild обязателен.
- Рефакторинг personal TransfersService может изменить carry/funds → characterization до переноса, прежние transfer/multicurrency/lifecycle/concurrency и snapshot carry tests после него.
- Ошибка фильтров может потерять переводы или раскрыть другой бюджет → тесты каждой стороны/валюты, совместного фильтра и user + две группы, архивные ссылки и бывший автор.
- Отмена после расходования destination может дать отрицательный остаток → документировать как сохранённое правило обратимости, не вводить скрытую проверку, мешающую отмене.

## Migration Plan

Схемы Transfer и owner fields уже готовы, существующие групповые данные не содержат переводов. Миграция/reset не нужны. Личные записи не перекладывать и не менять их _id, currency, snapshotId или суммы. Во время применения уточнить Purpose основной account-transfers spec для общего бюджета, сохранив существующие сценарии; delta sync не должен заменять остальные Purpose автоматически.

Добавить детерминированный внутригрупповой seed-перевод и обновить ожидаемые остатки/отчёт, не создавая искусственных income/expense. После появления group transfers откат к этапу 04 без восстановления dev fixtures семантически неверен: прежний ledger/report их не видит. Данные, требующие сохранения при rollback, требуют отдельного плана; рабочую базу автоматически не очищать. Deploy/live API и внешняя публикация не включены.
