# Design

## Context

Мотивация и согласованный объём — в `proposal.md`. Сейчас `BudgetContext` содержит `ownerType: 'user' | 'group'` и `ownerId`; `budgetFilter` дополнительно выбирает личный `userId`. `BudgetAccessService.resolve(actorId, groupId?)` допускает неявный личный бюджет. Финансовые schemas содержат обе модели ownership, часть индексов остаётся user-scoped.

`groups` отвечает за членство, приглашения и права. `group-finances` авторизует запрос и вызывает общие финансовые services. Например, GroupPlansService/GroupDebtsService делегируют операции общим services с budget context и одной MongoDB session. Простое удаление личных modules уничтожило бы используемую общую логику. Общие account/transaction discriminators и механизм snapshots уже поддерживают требуемые денежные правила.

Профиль связан с AccountsLookupService через выбор defaultAccountId; регистрация требует currency. UserDeletionService сначала запрещает удаление владельца группы, затем worker удаляет личные деньги по owner-фильтру и обезличивает пользователя. В репозитории есть owner-backfill scripts, integrity audit, большой набор personal compatibility e2e и локальные Postman YAML/exports/OpenAPI.

## Goals / Non-Goals

**Goals:**

- Одна обязательная граница финансовых запросов, индексов, ссылок и агрегаций: spaceId.
- Сохранить проверенную общую финансовую логику и транзакционные гарантии, удалив личные адаптеры и ветвления.
- Согласовать публичный контракт, runtime wiring, fixtures, integrity audit и локальные API artifacts в одном breaking release.

**Non-Goals:**

- Новый ledger, изменение денежных формул, валютной точности, discriminator values или модели прав.
- Active space в JWT/профиле, автоматическое пространство, автоматический счёт, новые onboarding endpoints или frontend.
- Миграция старых баз, aliases, совместимые DTO, production rollout и публикация Postman workspace.

## Decisions

### 1. Space replaces Group; financial ownership is a space reference

Переименовать актуальные domain types, modules, controllers, DTO, refs, collections и membership event reasons в Space/space. Space сохраняет name, description, ownerId пользователя, deletedAt, timestamps и внутреннюю mutationVersion; type удаляется. `Space.ownerId` означает административного владельца и сохраняется: он не является удаляемым финансовым ownerId.

Финансовые Account, Transaction, ExpenseCategory, ExpenseLimit, Plan, Debt и DebtTransaction используют обязательный неизменяемый spaceId с ref на Space. Убрать ownerType/ownerId и legacy ownership userId из этих документов. AccountSnapshot продолжает получать пространство через свой accountId; отдельный дублирующий spaceId для snapshots не вводится. Любой snapshot lookup обязан сначала ограничить доступ его счётом. createdBy, participantId, deletedBy, cancelledBy, membership.userId и actor.userId остаются ссылками на пользователей по своему назначению.

Индексы и уникальность категорий переходят на spaceId. Индексы списков сохраняют используемые status/currency/date/_id sort поля. Уникальность членства сохраняется для пары spaceId/userId. Новая модель не содержит personal/group discriminator; account `balance|saving` и transaction `income|expense|transfer` сохраняются.

Альтернатива `ownerType='space'` оставляет лишний discriminator для единственного вида финансового владельца; она отклонена. Подмена всех userId недопустима, поскольку уничтожает авторство и членство.

### 2. Explicit space context and one financial service path

Контекст содержит только spaceId. Удалить fallback к personalBudget, personal response serializers и личные controller registrations. Запрос без пространства не получает финансовый контекст. Сохранить domain services в accounts/transactions/plans/debts и других owning modules, их экспортируемые providers и DI; убрать только personal entry points и неиспользуемые wrappers. Тонкие пространственные адаптеры располагаются рядом с соответствующим доменом, если это упрощает wiring; отдельное второе финансовое ядро не создаётся.

BudgetWriteService и spaces access/transaction services продолжают проверять актуальное членство и права в одной MongoDB transaction с изменениями денег. Ссылки счёта/категории/плана/долга/погашения выбираются с spaceId запроса, даже если actor состоит и в другом пространстве. Snapshot и transfer side checks наследуют ту же границу. Отзыв прав, исключение и удаление пространства сохраняют текущую сериализацию с мутациями.

### 3. API contract is renamed without compatibility endpoints

Префикс API остаётся настроечным, по умолчанию `/api/v1`. Ниже пути относительно префикса:

| Область | Целевой контракт |
| --- | --- |
| Пространства | `/spaces`, `/spaces/:spaceId` |
| Членство и права | `/spaces/:spaceId/members`, `/members/:userId/permissions`, `/leave`, `/ownership` |
| Приглашения владельца | `/spaces/:spaceId/invitations`, `/invitations/:invitationId` |
| Предпросмотр/вступление | `/space-invitations/preview`, `/space-invitations/accept` |
| Финансы | `/spaces/:spaceId/accounts`, `/transfers`, `/transactions`, `/incomes`, `/expenses`, `/expense-categories`, `/expense-limits`, `/plans`, `/debts`, `/reports/...` |

Для финансов остальные suffixes, HTTP methods, пагинация, фильтры и ошибки соответствуют нынешним групповым маршрутам. В таблице сокращённые suffixes относятся к соответствующему пространственному prefix. DTO финансов возвращают spaceId вместо ownerType/ownerId; DTO пространства сохраняет ownerId и effective permissions. Accept возвращает spaceId и role. Preview возвращает ровно name и expiresAt, с прежним Cache-Control и защитой токена; type исчезает.

Старые групповые и корневые личные финансовые пути отсутствуют в router и OpenAPI; для авторизованного запроса возвращается обычный 404. Удаляются также личные snapshot HTTP entry points: баланс корректируется операциями. В create/PATCH финансов DTO не принимает spaceId/ownership/author от клиента: принадлежность задаётся маршрутом после проверки доступа. Неизвестные поля отклоняет существующий ValidationPipe. JWT остаётся идентификацией пользователя без зафиксированных прав пространства.

### 4. Zero-space account and empty-space onboarding

Регистрация и профиль не содержат currency/defaultCurrency/defaultAccountId; вход и получение профиля работают при нуле членств. Удалить финансовую зависимость UsersService от AccountsLookupService, если после удаления settings она больше не нужна. Не вводить отдельный onboarding status: доступный список `/spaces` использует существующий пагинированный envelope с пустыми items и total=0.

Создание пространства атомарно создаёт Space и owner membership, без финансовых документов и без скрытых категорий/счетов. Принятие приглашения возможно без собственного пространства. Потеря последнего membership не удаляет и не блокирует пользователя. Клиент выбирает пространство явно для каждого запроса; сервер не переключает его автоматически. Пространство для одного человека не имеет особого типа или прав.

### 5. Preserve current group behavior as the financial baseline

Сохраняются общая видимость, права владельца/member, четыре permissions и обычные права автора/участника. manageTransactions применяется к чужим операциям, переводам, планам и долгам по существующим правилам. Кошельки сохраняют явные name/currency, opening, balance/saving, архив и RESTRICT; категории, лимиты, исполнение планов, погашение и отмена долгов используют те же денежные транзакции. Actor names/privacy и запрет внутренней metadata в HTTP сохраняются.

Текущие personal и group отчёты отличаются диапазонами по умолчанию: personal-report-history начинается с самого раннего snapshot, а group report — с начала текущего UTC-года. Для пространств выбран текущий групповой контракт, включая явный исторический диапазон, ограничение 100 лет, currency baskets и обработку обратного диапазона. Исторические правила личных endpoints удаляются вместе с endpoints; автоматическое расширение пространственных отчётов на всю историю не входит в согласованное перепроектирование.

Исторические capability paths `group-*` и точные заголовки MODIFIED requirements сохраняются для OpenSpec delta matching. Их описания и сценарии переходят к пространствам; capability IDs не являются частью публичного API. Удаляемые личные capabilities оформляются REMOVED Requirements. TOTP capability не меняется.

### 6. User deletion never deletes space finances

Сохранить step-up, authVersion, немедленный отзыв доступа и durable idempotent worker. Активное владение любым неудалённым пространством блокирует запрос с 409; после transfer/delete запрос допустим, в том числе при нуле пространств. Worker завершает membership, очищает auth/персональные данные и сохраняет tombstone identity. Удалить personal financial cascade и queries по удалённой модели owner, не заменяя их фильтром createdBy. Ссылки авторства и все финансовые документы остаются; pending/deleted/missing actor обезличивается уже при чтении.

Удаление пространства сохраняет soft-delete, атомарное завершение членств и отзыв pending invitations, без публичного восстановления и без физического удаления финансов.

### 7. Fixtures and contracts move together

Seed создаёт пользователя без пространств, пространство с одним участником, совместные пространства с разными permissions и изолированными одноимёнными категориями/мультивалютными счетами, а также lifecycle/archived/deleted fixtures. Семья/компания допустимы как названия, но не как type. Integrity audit проверяет space references, membership/owner, authors, snapshots и origin/repayment accounting; owner-backfill scripts и их npm commands/tests удаляются.

Перенести значимые проверки денежных правил из personal tests в единственный пространственный путь; удалить только assertions личной совместимости и backfill. Не удалять финансовые regression tests только из-за personal имени файла. Обновить Postman OpenAPI, catalog/smoke и заменить personal-finance runnable suite на space-finance: регистрация без currency, создание space и передача spaceId, ошибки чужого пространства и старых маршрутов. Локальные YAML, scripts, exports и npm references должны совпасть. Использовать существующие Postman workspace binding и environments; не публиковать и не раскрывать secrets.

## Risks / Trade-offs

- Удаление personal modules может разорвать shared DI → сохранять доменные services/providers, удалять controller registrations и wrappers избирательно, проверять build и e2e.
- Перепутанные ownerId/userId могут удалить административного владельца или исторических actors → отдельные проверки space owner, member directory, attribution и deletion worker.
- Пропущенный filter/aggregation может смешать пространства одного пользователя → сценарии с двумя пространствами, одинаковыми названиями и принадлежностью actor к обоим, включая nested origin/snapshots.
- Упрощение write context может ослабить конкурентный отзыв доступа → переиспользовать transaction sessions/serialization и перенести concurrency suite.
- Старые personal regression tests могут быть выброшены вместе с endpoints → классифицировать их по бизнес-инварианту и перенести необходимые денежные проверки.
- Клиенты со старыми путями/DTO перестанут работать → единый breaking контракт, синхронное обновление API artifacts и отсутствие обещаний совместимости.
- Исторические OpenSpec IDs сохраняют слово group → это технические ключи документов; переименование capability каталогов не смешивается с функциональным change.

## Migration Plan

Миграции данных и dual-read/dual-write нет. Реализация ориентирована на новую/одноразовую development и test базу с replica set и новыми индексами. Не добавлять автоматический сброс базы в startup; при необходимости development fixtures пересоздаются явно существующим seed-процессом. Применение к старой базе не поддерживается этим change.

Проверка выполняется на изолированной тестовой базе: targeted tests, затем полный unit/e2e и build, локальный Postman lint и runnable smoke/space-finance против локального API. Если runtime Postman недоступен, зафиксировать ограничение отдельно от успешно выполненных статических проверок. Откат схемы старой базы не проектируется; deployment и операции с пользовательской базой требуют отдельного запроса.
