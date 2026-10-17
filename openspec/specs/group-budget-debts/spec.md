# group-budget-debts Specification

## Purpose

Позволить участникам общего бюджета учитывать долги перед группой, частичные финансовые и некассовые погашения и их отмену, сохраняя согласованность денежных остатков, историю и личную совместимость.

## Requirements

### Requirement: Group debt access and attribution

Любой действующий участник SHALL создавать и читать долг группы и историю. Изменение, погашение, отмена, архивирование и удаление SHALL требовать действующего автора долга, владельца либо manageTransactions. Автор погашения SHALL фиксироваться отдельно и сам по себе не давать полномочий. JWT SHALL быть обязателен; недоступный бюджет/объект SHALL давать 404, недостаточные права участника — 403.

#### Scenario: Delegate repays another member debt

- **WHEN** действующий делегат погашает долг другого участника
- **THEN** автор долга сохраняется, автор истории и дохода равен исполнителю, бюджет остаётся групповым

#### Scenario: Repayment author loses delegation

- **WHEN** у исполнителя отозван manageTransactions, а долг создан другим участником
- **THEN** прежний JWT и авторство погашения не разрешают отмену; запрос даёт 403, бывший участник получает 404

### Requirement: Receivable debt starts without a financial movement

Групповой долг SHALL означать только «нам должны» и создаваться с debtor, положительной principalAmount и поддерживаемой неизменяемой currency. Remaining SHALL равняться principal, status — active. Создание SHALL не двигать деньги. Description и dueDate SHALL быть необязательными. Client owner/creator/remaining/status/direction SHALL отклоняться с 400.

#### Scenario: Create a shared receivable

- **WHEN** участник создаёт долг 4000 USD с контрагентом
- **THEN** principal=remaining=4000, status=active; счета, доходы, отчёты и лимиты не меняются

#### Scenario: Currency units and counterparty

- **WHEN** переданы JPY 1, RUB 0.01 или KWD 0.001 и непустой debtor после trim
- **THEN** долг создаётся; лишняя точность, нулевая/отрицательная сумма, пустой контрагент и неизвестная валюта дают 400

### Requirement: Debt edits preserve repayment accounting

PATCH SHALL менять только debtor, description, dueDate и principalAmount. Principal SHALL меняться только до первой записи погашения, включая отменённую; remaining SHALL изменяться вместе с ним. После истории попытка principal PATCH SHALL давать 409. Remaining/status/currency SHALL не приниматься. Metadata SHALL редактироваться и у закрытого неархивного долга; dueDate=null SHALL очищать срок.

#### Scenario: Change principal before history

- **WHEN** principal меняется с 4000 на 4500 до первого погашения
- **THEN** remaining становится 4500 без денежного движения; пустой PATCH и неразрешённые поля дают 400

#### Scenario: Cancelled history still freezes principal

- **WHEN** все погашения отменены и клиент пытается изменить principal
- **THEN** PATCH возвращает 409, исторические суммы и деньги сохраняются

### Requirement: Shared debt history is explicit and stable

Долги SHALL возвращать бюджет, автора и createdByActor; история — автора погашения, isIncome, сумму/дату, incomeId для финансовой записи и cancelledAt/cancelledBy/cancelledByActor при отмене. Групповые DTO SHALL не содержать userId, participantId или фиктивный type. Список долгов SHALL иметь pagination/status/currency/includeArchived; история SHALL включать отменённые записи. Архивные детали и история SHALL читаться действующим участником.

#### Scenario: Deterministic pages and historical actors

- **WHEN** супруги читают одинаковые страницы долга и истории после выхода автора
- **THEN** они видят одни данные своего бюджета и текущие actor имена; pending/deleted/missing обезличены, списки стабилизированы по _id

### Requirement: Partial repayments update the remaining debt

Погашение SHALL требовать положительную amount не больше remaining, repaymentDate и явный boolean isIncome. Оно SHALL уменьшать remaining на сумму и закрывать долг при нуле. Закрытый долг SHALL отклонять новые погашения с 400. Некорректная точность SHALL давать 400. Отдельное ручное закрытие, правка remaining и переплата SHALL не поддерживаться.

#### Scenario: Partial and full repayments

- **WHEN** долг 100 USD погашается на 40, затем 60
- **THEN** remaining последовательно 60 и 0, status становится closed; попытка 61 после первого погашения даёт 400 без записи

#### Scenario: Noncash write off

- **WHEN** записано погашение isIncome=false без accountId
- **THEN** появляется история и уменьшается remaining, но доходы, счета, снимки и отчёты не меняются; accountId в некассовом запросе даёт 400

### Requirement: Financial repayment creates one group income

При isIncome=true SHALL требоваться активный accountId того же бюджета и валюты, дата не раньше openedAt. Доход SHALL создаваться на сумму погашения с автором-исполнителем и origin долга, а история SHALL сохранять точный incomeId. Доход SHALL учитываться один раз обычными денежными механизмами; групповые расходы/лимиты SHALL от него не меняться.

#### Scenario: Receive into a group account

- **WHEN** долг USD 100 погашается финансово на 40 USD на счёт группы
- **THEN** remaining=60, один доход 40 с origin долга и incomeId истории увеличивает счёт и доходы отчёта на 40; личные деньги не меняются

#### Scenario: Reject invalid financial references

- **WHEN** передан личный/чужой/архивный счёт, другая валюта либо дата до открытия
- **THEN** чужой/архивный счёт даёт 404, валюта/ранняя дата — 400, долг/история/деньги не меняются

### Requirement: Repayment cancellation preserves history and reverses effects

Отмена SHALL быть однократной, сохранять запись и incomeId, фиксировать cancelledAt/By, увеличивать remaining и открывать закрытый долг. Финансовая отмена SHALL логически удалять исходный доход и компенсировать деньги на исходную дату. Некассовая отмена SHALL не двигать деньги. Повтор SHALL давать 409 без повторной компенсации. Исправление SHALL выполняться отменой и новой записью.

#### Scenario: Cancel a final financial repayment

- **WHEN** действующий автор долга отменяет последнюю финансовую запись у закрытого неархивного долга
- **THEN** долг становится active с восстановленным остатком, доход soft-deleted и исключён из отчётов, история и origin сохранены

#### Scenario: Cancel noncash or spent income

- **WHEN** отменяется некассовая запись либо финансовый доход уже потрачен
- **THEN** первая отмена меняет только долг/историю, вторая компенсирует доход по обычной групповой политике, допускающей отрицательный остаток

### Requirement: Linked group income is changed only by cancellation

Обычные PATCH/DELETE дохода группового погашения SHALL возвращать 409 после проверки доступа, полномочий и активного счёта; архивный счёт SHALL давать 404. Отмена SHALL использовать сохранённый incomeId и проверять бюджет, origin, валюту, сумму и дату; несогласованная/уже удалённая ссылка SHALL давать 409 без частичных effects. Личные origin-доходы SHALL сохранять прежнее поведение.

#### Scenario: Prevent separate financial correction

- **WHEN** уполномоченный пользователь меняет сумму/описание или удаляет связанный групповой доход обычным income API
- **THEN** получает 409; долг, история и денежный факт сохраняются до отмены погашения

### Requirement: Debt archive freezes mutation and retains references

Архив SHALL замораживать PATCH/погашение/отмену с 404, сохраняя чтение и доходы; повторный archive SHALL давать 404. Долг без истории/доходов и архива SHALL удаляться с 204, повтор — 404; любая история, включая отменённую, либо архив SHALL давать DELETE 409. Архив счёта SHALL блокировать финансовое погашение/отмену, но не некассовые записи.

#### Scenario: Archive debt or account

- **WHEN** долг архивируется либо счёт финансового погашения архивирован
- **THEN** архив долга не меняет деньги и запрещает отмену; архив счёта даёт 404 при финансовой отмене, сохраняя долг и историю

### Requirement: Debt and cash mutations are atomic under concurrency

Права, состояние, история, доход, remaining/status и actor-ответ SHALL меняться одной атомарной операцией. Конкуренция погашений/отмен/редактирования/архива/удаления ссылок и полномочий SHALL соответствовать последовательному выполнению. Ошибка записи или подготовки ответа SHALL откатывать все документы и деньги. POST без ключа идемпотентности SHALL создавать отдельное погашение при достаточном remaining.

#### Scenario: Concurrent repayments cannot overpay

- **WHEN** два запроса по 60 погашают долг 100 либо конкурируют отмена/новое погашение
- **THEN** сумма действующих погашений не превышает principal, remaining соответствует истории, компенсация выполняется не более одного раза

#### Scenario: Failure after a financial write

- **WHEN** сбой происходит после создания/удаления дохода, изменения долга/истории либо actor lookup
- **THEN** remaining/status, история, доход, счета, снимки и версии полностью откатываются

### Requirement: Debt ownership migration preserves personal history

Личные Debt/DebtTransaction SHALL получить достоверные budget/creator из userId и родителя без изменения сумм, remaining/status, дат, архива, доходов/origin или личного DTO. Backfill SHALL иметь dry-run/explicit apply, повтор0 и защиту от конкурентного назначения owner. Конфликты и отсутствующие ссылки SHALL диагностироваться; legacy incomeId SHALL не угадываться.

#### Scenario: Migrate personal debt and repayments safely

- **WHEN** dry-run, apply и повтор выполняются на личных долгах с ручным remaining и на tombstone владельце
- **THEN** dry-run не пишет, apply добавляет только достоверные отсутствующие поля, повтор не меняет записи; финансовая история и её личный смысл сохранены

#### Scenario: Ambiguous references or concurrent ownership

- **WHEN** поля owner конфликтуют, ID имеют строковый тип, родитель отсутствует/чужой либо owner назначен конкурентом
- **THEN** проблемная запись не переписывается, отчёт объясняет причину, групповые записи не мигрируются и связь дохода не назначается по совпадениям
