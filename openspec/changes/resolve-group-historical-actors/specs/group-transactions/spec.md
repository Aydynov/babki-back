# Spec Delta

## MODIFIED Requirements

### Requirement: Group transfer history contract
Действующие участники SHALL читать пагинированный список и детали переводов, включая записи бывших авторов и архивных счетов. DTO SHALL содержать _id, type=transfer, createdBy, createdByActor, transactionDate, source/destination с accountId/snapshotId/currency/amount и effectiveRate с baseCurrency/quoteCurrency/rate. Общая история SHALL использовать тот же денежный DTO. Удалённые переводы SHALL исключаться из обычных выдач и сумм.

#### Scenario: Either account or currency
- **WHEN** создан перевод RUB balance → USD saving
- **THEN** фильтр по любому из двух accountId или по RUB/USD находит одну запись; общая история без фильтра также содержит её один раз, с effectiveRate USD за RUB

#### Scenario: Combined filters and pagination
- **WHEN** список ограничен accountId, currency, периодом и type=transfer
- **THEN** все условия применяются совместно; items/total/page/limit и порядок transactionDate desc, _id desc сохраняются; другие бюджеты не включаются

#### Scenario: Transfers excluded from expense revenue
- **WHEN** перевод попал в период расходного лимита или expense revenue
- **THEN** сумма расходов, rest лимита и participantId-фильтр расходов не меняются из-за перевода

## ADDED Requirements

### Requirement: Group transaction actor summaries
Ответы create/PATCH, деталей и списков групповых доходов, расходов, переводов и общей истории SHALL дополняться createdByActor. Расход с participantId SHALL также иметь participantActor; доход и перевод SHALL его не иметь. Actor SHALL содержать только userId, firstName, lastName, isAnonymized. Исходные createdBy/participantId SHALL сохраняться без изменения. DELETE 204 SHALL оставаться без тела.

#### Scenario: Author and attributed participant differ
- **WHEN** супруг создаёт расход за супругу
- **THEN** createdByActor.userId соответствует createdBy супруга, participantActor.userId соответствует participantId супруги; объекты возвращаются с текущими именами, lastName либо null и isAnonymized=false

#### Scenario: One contract across transaction responses
- **WHEN** участник создаёт, изменяет, читает детали или страницу доходов/расходов/переводов либо общей истории
- **THEN** одна запись имеет одинаковую структуру actor-объектов; фильтры, суммы, порядок и пагинация сохраняются, у дохода/перевода participantActor отсутствует

#### Scenario: Server owned actor fields
- **WHEN** клиент передаёт createdByActor, participantActor или вложенные сведения о пользователе в create/PATCH
- **THEN** возвращается 400; субъектов определяют сохранённые сервером ссылки и профиль, а не клиент

### Requirement: Current names survive membership departure
Имена actor SHALL браться из текущего активного профиля при каждом запросе, без сохранения снимка имени в операции. Выход/исключение из группы SHALL не препятствовать отображению такого исторического субъекта действующим участникам. Каталог членов SHALL оставаться каталогом действующих участников. Имя SHALL не предоставлять полномочия или изменять авторство и исторический participantId-фильтр.

#### Scenario: Rename after leaving
- **WHEN** автор/участник расхода вышел из группы и изменил имя профиля
- **THEN** новый запрос доступной групповой истории показывает новое имя под прежними ссылками; в каталоге членов его нет, а запрос истории от бывшего участника с прежним JWT возвращает 404

#### Scenario: Archived account history
- **WHEN** счёт операции архивирован, а автор покинул группу
- **THEN** действующий участник читает историю с actor; архивные финансовые мутации остаются запрещёнными, исторический фильтр participantId продолжает находить расходы

### Requirement: Anonymized historical actors
Для deletion_pending, deleted или отсутствующего профиля actor SHALL сохранять userId из операции, возвращать firstName=null, lastName=null, isAnonymized=true. Прежние имена SHALL не восстанавливаться из копий, событий или кэша. Запрос, начатый после принятия удаления пользователя, SHALL не раскрывать его имена, даже до очистки профиля worker. Сбой хранилища SHALL не маскироваться под отсутствующего пользователя.

#### Scenario: Deletion pending still has stored names
- **WHEN** запрос удаления принят и профиль deletion_pending ещё содержит имя и фамилию
- **THEN** последующие ответы операций дают только обезличенный actor; групповые деньги, исходные ссылки и история не меняются

#### Scenario: Worker completes or referenced profile is absent
- **WHEN** очистка завершена либо профиль по сохранённому идентификатору отсутствует
- **THEN** actor имеет тот же userId и null-имена; пагинация и количество операций сохраняются без ошибки 404 для истории

#### Scenario: Profile lookup outage
- **WHEN** хранилище профилей недоступно при подготовке ответа
- **THEN** возвращается нормализованная серверная ошибка без персональных данных; состояние не выдаётся за успешное обезличивание

### Requirement: Actor summaries remain scoped to accessible history
Сведения actor SHALL разрешаться только для ссылок из возвращаемых операций уже доступной группы. Произвольный поиск пользователей SHALL не появляться. Ответы SHALL исключать email, описание профиля, auth-поля, статус удаления, личные финансы и сведения иных пользователей. Личный API, агрегаты revenue/отчётов и права доступа SHALL сохранять прежний контракт.

#### Scenario: Foreign or unrelated identity
- **WHEN** пользователь запрашивает чужую операцию/группу либо задаёт participantId без расходов в доступной группе
- **THEN** недоступный объект даёт 404, исторический фильтр даёт пустую выдачу; имя постороннего пользователя не разрешается и не раскрывается

#### Scenario: Personal and separate group isolation
- **WHEN** один пользователь имеет личные операции и членство в двух группах
- **THEN** actor добавляется только к операциям запрошенной доступной группы; личный DTO, денежные агрегаты и финансовые данные других бюджетов не меняются
