# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit group wallet creation
Создание группы SHALL не создавать счёт автоматически. Владелец или участник с manageAccounts SHALL явно создать несколько счетов balance и saving с обязательными name и поддерживаемой currency, начальным остатком не меньше нуля и точностью выбранной валюты, по умолчанию ноль. Тип SHALL по умолчанию быть balance. Повторное создание SHALL создавать новый счёт; одинаковые тип, валюта или имя SHALL не вызывать конфликт. Клиент SHALL иметь возможность указать неизменяемую дату открытия openedAt, по умолчанию текущее время. Начальный остаток SHALL действовать с этой даты; операции раньше неё SHALL возвращать 400, баланс до неё SHALL быть нулевым.

#### Scenario: Create wallet
- **WHEN** участник с manageAccounts создаёт кошелёк
- **THEN** система возвращает 201; счёт и начальный баланс возникают атомарно

#### Scenario: Concurrent creation
- **WHEN** два уполномоченных участника одновременно создают счета
- **THEN** оба запроса возвращают 201; возникают два независимых счёта, каждый с одним начальным снимком, без потери или удвоения остатков

## ADDED Requirements

### Requirement: Group account collection and immutable type
Действующие участники SHALL читать все счета группы, включая архивные, и детали каждого счёта с его собственными amount/timeline. Список SHALL поддерживать optional type и currency; неподдерживаемые значения SHALL давать 400. Валюта SHALL нормализоваться trim/uppercase. type, currency, initialAmount и openedAt SHALL быть неизменяемыми. accountId SHALL выбираться явно; групповой счёт по умолчанию SHALL не назначаться.

#### Scenario: Multiple accounts and filters
- **WHEN** созданы два RUB balance, RUB saving и KWD saving
- **THEN** возвращаются четыре независимых счёта; type=saving выбирает два, type=saving&currency=RUB — один; личные и чужие групповые счета не попадают в список

#### Scenario: Compatible account creation
- **WHEN** участник с manageAccounts создаёт счёт с name и currency без type
- **THEN** создаётся balance; отсутствие кошелька при создании группы сохраняется

#### Scenario: Immutable financial identity
- **WHEN** клиент передаёт type, currency, amount либо openedAt в PATCH счёта
- **THEN** возвращается 400 без изменения типа, валюты, начальной суммы, истории или баланса

### Requirement: Group account rename authority
PATCH группового счёта SHALL принимать только непустое name длиной 1–100 после trim и требовать manageAccounts. Переименование активного или архивного счёта SHALL сохранять идентификатор, валюту, тип и финансовую историю. Недоступный счёт SHALL давать 404; отсутствие права у действующего участника SHALL давать 403.

#### Scenario: Delegate renames reserve
- **WHEN** делегат manageAccounts меняет имя общего saving-счёта
- **THEN** возвращается 200 с новым именем; оба участника видят прежние остатки и историю под тем же _id

#### Scenario: Reject invalid rename
- **WHEN** отправлен пустой PATCH, blank name или неизвестное поле
- **THEN** возвращается 400 без изменений

### Requirement: Group account archive preserves history
POST archive счёта SHALL требовать manageAccounts, возвращать 204 и сохранять archivedAt. Архивирование SHALL не менять остатки, операции, снимки и влияние на отчёты/лимиты. Архивный счёт SHALL оставаться в списках и деталях. Повторное архивирование SHALL возвращать 404; восстановления из архива SHALL не быть. Удаление архивного счёта SHALL подчиняться тем же ограничениям истории, что активного.

#### Scenario: Archive used saving
- **WHEN** владелец архивирует saving с начальной суммой и расходом
- **THEN** счёт и история остаются читаемыми, archivedAt заполнен; DELETE возвращает 409, а отчёт сохраняет накопления и расход

#### Scenario: Delete unused archived account
- **WHEN** уполномоченный участник удаляет архивный счёт с нулевым opening без каких-либо операций
- **THEN** счёт и его технические снимки удаляются атомарно с 204, последующие чтение/удаление дают 404

#### Scenario: Archive races with operation
- **WHEN** архивирование конкурирует с созданием, правкой или удалением операции
- **THEN** результат соответствует последовательному выполнению: операция завершается до архива либо отклоняется без частичной записи или потери денег

#### Scenario: Revoked account permission
- **WHEN** manageAccounts отозвано и прежний JWT используется для rename/archive
- **THEN** возвращается 403; операции другого бюджета дают 404 при наличии права в запрошенной группе
