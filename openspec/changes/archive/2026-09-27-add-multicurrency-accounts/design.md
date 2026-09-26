## Context

Личные `Account` и `Transaction` используют discriminator-модели, общие также с групповыми финансами. Личный API неявно находит единственный `balance` или `saving`; уникальный индекс запрещает несколько счетов одного типа. `save` хранит один `amount`, целевой `accountId` и исходный `sourceAccountId`, поэтому не может выразить конвертацию. Снапшоты хранят остаток конкретного счёта, а MongoDB transactions и сортированная блокировка счетов уже обеспечивают основу атомарных изменений. См. [proposal.md](./proposal.md) и delta specs для внешнего поведения.

Production-данных нет, поэтому схема, маршруты и seed-данные меняются напрямую без миграции и совместимости со старыми личными контрактами. Общие account/transaction schemas требуют при этом не изменить поведение групповых маршрутов.

## Goals / Non-Goals

**Goals:**

- Сделать валюту явным неизменяемым измерением каждого личного финансового факта.
- Поддержать несколько личных счетов одного типа и валюты через единый API.
- Представить перевод одним агрегатом с двумя фактическими денежными эффектами и атомарным lifecycle.
- Централизовать валютную валидацию, точность и группировку отчетов.
- Сохранить существующие гарантии budget ownership, блокировок и snapshot recalculation.

**Non-Goals:**

- Автоматические, рыночные или исторические курсы и единая оценка net worth.
- Комиссии, спред как отдельная сущность и бухгалтерский P&L от конвертации.
- Криптовалюты и произвольные пользовательские единицы стоимости.
- Мультивалютные групповые кошельки или переводы между личным и групповым бюджетом.
- Миграция production-данных и совместимость с `/balances`, `/savings` и `/saves`.

## Decisions

### 1. Separate profile preference from account denomination

`User` получает `defaultCurrency` и nullable `defaultAccountId`. `defaultCurrency` управляет UX-defaults, но не является валютой всех данных. `defaultAccountId` ссылается только на активный личный `balance` той же валюты. Первый подходящий balance назначается основным в той же MongoDB transaction; дальнейшая смена валюты и счёта может выполняться одним PATCH. Если меняется только валюта, несовместимая ссылка очищается атомарно и другой счёт не выбирается неявно.

Альтернатива — хранить только валюту профиля и выводить основной счёт по дате создания. Она создаёт неявный выбор и становится нестабильной при архивировании, поэтому отклонена.

### 2. Use one personal accounts resource with immutable denomination

Личные `/balances` и `/savings` заменяются коллекцией `/accounts`; `type` остаётся классификацией `balance | saving`, а не условием уникальности. Счёт хранит `name`, `currency`, `type`, `initialAmount`, `openedAt` и lifecycle fields. Уникальный индекс `(ownerType, ownerId, type)` удаляется; остаются индексы владельца, статуса, валюты и типа, нужные спискам и выбору основного счёта.

Валюта, тип, начальная сумма и дата открытия неизменяемы. Переименование не влияет на историю. Альтернатива с отдельной сущностью CurrencyWallet поверх текущих account discriminators добавила бы вторую конкурирующую модель баланса и отклонена.

### 3. Resolve operation currency from its account and snapshot it

Личные income/expense DTO требуют `accountId`; сервис загружает активный счёт внутри transaction, проверяет personal ownership и использует его валюту. `Transaction` денормализует `currency`, чтобы исторические выборки и агрегаты не зависели от populate и сохраняли смысл даже после архивирования счёта. Currency не принимается клиентом отдельно.

Групповые сервисы продолжают работать с их единственным счётом. Общая schema допускает currency, но личные и групповые write paths валидируют её согласно своему scope.

### 4. Model transfer as one aggregate with two effects

`save` discriminator и маршруты заменяются `transfer`. Общая Transaction schema сохраняет только действительно общие ownership/lifecycle/date/description fields; денежные `accountId`, `snapshotId` и `amount` переносятся в income/expense discriminators, а transfer discriminator получает вложенные `source` и `destination` effects. Каждый effect хранит `accountId`, `snapshotId`, `amount` и snapshot валюты. Индексируются оба account id и дата. Эффективный курс не хранится как независимая редактируемая истина: ответ вычисляет `destination.amount / source.amount` и обозначает base/quote direction.

Сервисы блокируют оба счёта в отсортированном ObjectId-порядке, затем в одной session создают/находят оба снапшота, проверяют доступный остаток и применяют противоположные дельты. Update изменяет только суммы/описание и применяет разницы к обеим цепочкам; delete остаётся soft delete и компенсирует обе стороны ровно один раз.

Такая форма заранее допускает добавление связанных fee effects или отдельной fee-транзакции, не меняя значение `sourceAmount` и `destinationAmount`. Пустой `fees` в первой версии не публикуется, чтобы не обещать неподдерживаемый контракт.

Альтернативы отклонены: две независимые income/expense записи допускают рассинхронизацию и искажают отчёты; один amount плюс rate теряет фактически полученную сумму и создаёт проблемы округления.

### 5. Centralize ISO currency metadata and normalization

Общий money utility предоставляет список поддерживаемых ISO 4217 кодов, число minor units, проверку суммы, нормализацию и безопасные арифметические операции. Wire format остаётся JSON number, чтобы не менять общий стиль API; вычисления нормализуются на границах и после арифметики. В первой итерации не меняется общее Mongo-представление `number`, поскольку те же schemas обслуживают одновалютные групповые финансы.

Альтернатива с немедленным переходом всех сумм на integer minor units или Decimal128 точнее, но расширяет изменение на групповые контракты и сериализацию. Её следует рассматривать отдельным системным изменением.

### 6. Keep reports exact by grouping, never by implicit conversion

Личные отчёты агрегируют по currency и возвращают валютные buckets для incomes, expenses, transfers, balances и savings. Transfer source/destination влияют на соответствующие остатки и movement totals, но не на income/expense. Limits filter expenses by both category and currency. Plan close и debt repayment принимают accountId и валидируют совпадение с неизменяемой currency родительской сущности.

Категории остаются currency-neutral. Это позволяет иметь одну категорию «Продукты», но независимые RUB/USD limits.

### 7. Treat seeds as scenario fixtures

Seed orchestration создаёт профиль с RUB default, четыре активных личных счёта (RUB balance/saving и USD balance/saving), одно- и межвалютные transfers, операции обеих валют, валютные limits/plans/debts, backdated movement и lifecycle candidates. Невалидные сценарии остаются в unit/e2e tests. Group seeds сохраняют текущую одновалютную модель.

## Risks / Trade-offs

- [Общие discriminator schemas могут непреднамеренно изменить группы] → Разделить personal/group DTO и write validation, оставить focused group regression suites и не менять group specs.
- [JavaScript number допускает floating-point артефакты] → Централизовать нормализацию по minor units, запретить лишнюю точность и проверять точные граничные сценарии; полный storage refactor вынести отдельно.
- [Два snapshot effects усложняют конкурентные мутации] → Сохранять сортированную блокировку обоих счетов и выполнять запись/пересчёт только в одной MongoDB transaction.
- [Архивирование default account временно оставляет пользователя без основного счёта] → Атомарно очищать ссылку и явно возвращать nullable состояние; следующий подходящий счёт назначается пользователем либо правилом первого счёта.
- [Форма мультивалютных отчетов является breaking change] → Обновить все DTO, документацию, seeds и e2e assertions как единый переход без compatibility adapter.
- [Точность effective rate может быть бесконечной дробью] → Возвращать документированное вычисляемое decimal-представление с достаточной display precision, сохраняя фактические суммы источником истины.

## Migration Plan

1. Изменить schemas и индексы, затем очистить локальную development БД; production migration не создаётся.
2. Перевести personal write paths и API на новые account/transfer contracts до включения обновлённых seeds.
3. Обновить агрегаты, связанные сущности, integrity audit и lifecycle проверки.
4. Пересоздать seed-базу и проверить RUB/USD сценарии вместе с полным regression suite.
5. Rollback выполняется возвратом к предыдущей версии приложения и повторным созданием development БД из прежних seeds; сохранение данных между версиями не гарантируется.
