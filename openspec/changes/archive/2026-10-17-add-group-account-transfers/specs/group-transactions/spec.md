# Spec Delta

## MODIFIED Requirements

### Requirement: List and filter group history
Все действующие участники SHALL читать пагинированные операции и суммы своей группы с фильтрами периода, счёта, типа income/expense/transfer и currency. Перевод SHALL входить в общую историю одной записью; фильтр счёта и валюты SHALL находить его по любой денежной стороне. Расходы SHALL дополнительно фильтроваться по категории и participantId; фильтр SHALL использовать историческую атрибуцию, включая бывших участников. Фильтр участника SHALL не означать фильтр автора. Ответы SHALL не раскрывать email и приватные поля пользователя.

#### Scenario: Filter spouse expenses
- **WHEN** пользователь выбирает participantId супруги
- **THEN** получает её расходы независимо от того, кто внёс записи

#### Scenario: Filter departed member
- **WHEN** участник фильтрует расходы по бывшему участнику
- **THEN** его исторические расходы остаются в выдаче и суммах

#### Scenario: Foreign participant filter
- **WHEN** фильтр содержит идентификатор без расходов в группе
- **THEN** возвращается пустой результат без раскрытия существования пользователя

### Requirement: Archived group accounts freeze financial mutations
Создание, PATCH и DELETE групповых доходов/расходов и переводов SHALL требовать активные затронутые счета. Для архивного счёта запрос при наличии обычных прав на операцию SHALL возвращать 404 без изменения операции, атрибуции, снимков, остатков или лимитов. Это SHALL применяться к автору, участнику расхода, владельцу и делегату. Чтение истории и сумм архивного счёта SHALL оставаться доступным действующим участникам группы.

#### Scenario: Reject new archived operation
- **WHEN** участник создаёт доход или расход с accountId архивного balance либо saving
- **THEN** возвращается 404, новых операций и snapshots не возникает

#### Scenario: Freeze historical operation
- **WHEN** владелец, автор или уполномоченный делегат отправляет PATCH amount/description/items/participantId либо DELETE старой операции архивного счёта
- **THEN** возвращается 404, запись и её влияние на деньги/лимиты сохраняются

#### Scenario: Archived history remains readable
- **WHEN** другой действующий участник читает детали, список либо revenue с фильтром accountId архивного счёта
- **THEN** операции и суммы доступны с прежней исторической атрибуцией; бывший участник доступа не получает

## ADDED Requirements

### Requirement: Group transfer authority and attribution
Любой действующий участник SHALL создавать перевод между счетами той же группы. Автор SHALL определяться из JWT и сохраняться как createdBy отдельно от бюджета; participantId SHALL отсутствовать. Изменять суммы/описание и удалять перевод SHALL только действующий автор, владелец или действующий делегат manageTransactions. Остальные права настроек SHALL не давать такого доступа. Счета, валюты и дата SHALL быть неизменяемыми.

#### Scenario: Spouse moves reserve
- **WHEN** участник переводит средства с balance на saving группы
- **THEN** createdBy указывает его, owner указывает группу; оба супруга читают один перевод, личные данные не меняются

#### Scenario: Delegate corrects departed author
- **WHEN** автор вышел из группы, а действующий делегат меняет суммы или отменяет перевод
- **THEN** действие разрешается по manageTransactions, исходный createdBy сохраняется; отмена фиксирует делегата в deletedBy

#### Scenario: Ordinary member and revoked delegate
- **WHEN** не связанный с авторством участник либо делегат после отзыва manageTransactions с прежним JWT меняет или удаляет чужой перевод
- **THEN** возвращается 403; свои переводы остаются доступны действующему автору по обычным правилам

#### Scenario: Foreign account or transfer
- **WHEN** участник передаёт личный/чужой групповой счёт либо идентификатор чужого перевода в маршруте своей группы
- **THEN** возвращается 404 без финансовых изменений; межбюджетный перевод не создаётся даже при доступе к обоим бюджетам

### Requirement: Group transfer history contract
Действующие участники SHALL читать пагинированный список и детали переводов, включая записи бывших авторов и архивных счетов. DTO SHALL содержать _id, transactionType=transfer, createdBy, transactionDate, source/destination с accountId/snapshotId/currency/amount и effectiveRate с baseCurrency/quoteCurrency/rate. Общая история SHALL использовать тот же денежный DTO. Удалённые переводы SHALL исключаться из обычных выдач и сумм.

#### Scenario: Either account or currency
- **WHEN** создан перевод RUB balance → USD saving
- **THEN** фильтр по любому из двух accountId или по RUB/USD находит одну запись; общая история без фильтра также содержит её один раз, с effectiveRate USD за RUB

#### Scenario: Combined filters and pagination
- **WHEN** список ограничен accountId, currency, периодом и type=transfer
- **THEN** все условия применяются совместно; items/total/page/limit и порядок transactionDate desc, _id desc сохраняются; другие бюджеты не включаются

#### Scenario: Transfers excluded from expense revenue
- **WHEN** перевод попал в период расходного лимита или expense revenue
- **THEN** сумма расходов, rest лимита и participantId-фильтр расходов не меняются из-за перевода

### Requirement: Group transfer reversal and request repeats
DELETE перевода SHALL логически помечать запись и атомарно обращать обе сохранённые суммы не более одного раза; повторный DELETE SHALL возвращать 404. Каждый успешный POST SHALL создавать новый перевод, без ключа идемпотентности. Пустой PATCH и изменение неизменяемых полей SHALL возвращать 400. Конкурентные edit/delete, archive или отзыв доступа SHALL соответствовать последовательному выполнению.

#### Scenario: Repeated post and delete
- **WHEN** при достаточных средствах отправлены два одинаковых POST
- **THEN** создаются два разных перевода; DELETE одного компенсирует только его, повторный DELETE даёт 404 без нового движения

#### Scenario: Edit versus delete
- **WHEN** автор и делегат одновременно меняют суммы и удаляют перевод
- **THEN** остатки соответствуют последовательному результату, без потерянной дельты или повторной компенсации

#### Scenario: Archive either side
- **WHEN** исходный либо целевой счёт архивирован
- **THEN** чтение перевода доступно, PATCH/DELETE при наличии обычных прав возвращают 404; гонка archive с мутацией не создаёт частичных effects
