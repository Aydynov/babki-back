# Design

## Context

См. proposal.md — Why. Пользователь согласовал полное исполнение новым расходом, фактическую сумму, author/owner/manageTransactions и сохранение closed/expenseId/origin после удаления расхода (2026-10-17).

PlansService сейчас читает Plan по userId, сам создаёт сессии и закрывает план через ExpensesService.create. Plan содержит amount/currency/categoryId, active/closed, archivedAt, closedAt и expenseId. Close уже использует условный переход active → closed и расход с origin=plan; личные lifecycle и multicurrency e2e проверяют одноразовость/валюту. Plan.amount schema min=0.01 не позволяет групповой KWD 0.001. Общий финансовый код умеет BudgetContext, category/account locks, переданную ClientSession и групповой ledger.

Category deletion проверяет Plan только для user; user worker удаляет plans по userId; integrity relations знают plan.user/category/expense, но не plan.owner/createdBy. Lifecycle migration умеет совместимые backfills и восстановление plan origin, но статический update недостаточен для вычисления owner из userId. GroupFinancialActorsService уже общий для финансовых ответов, хотя его тип входа пока требует transaction.type.

## Goals / Non-Goals

**Goals:** один Plan и один PlansService с личными адаптерами и бюджетными методами; однократный финансовый факт через существующий ExpensesService; безопасный rollout личных данных и групповой lifecycle.

**Non-Goals:** частичные исполнения, готовый expenseId на входе, cancel/reopen, перевод между бюджетами, резервирование средств, новые роли/права, копии моделей/денежной арифметики. Долги — отдельный этап 09.

## Decisions

### 1. Общая модель и сервис

Расширить Plan неизменяемыми ownerType/ownerId/createdBy. userId остаётся только у личных записей; у группового плана его нет, поэтому удаление автора не означает владение планом. Общие createForBudget/listForBudget/getForBudget/updateForBudget/removeForBudget/archiveForBudget/closeForBudget принимают BudgetContext, actor и supplied session для мутаций. Групповой GroupPlansService только проверяет актуальные права и вызывает общий сервис через BudgetWriteService.run; PlansModule экспортирует PlansService и регистрируемые модели. Не создавать GroupPlan schema и не вызывать личные HTTP-контроллеры.

Личные create/find/update/remove/archive/close остаются совместимыми wrappers. Использовать personalBudget/personalResponse, сохраняя userId, прежние DTO, ошибки и личную политику снимков. Не отправлять в личный DTO owner/createdBy/actor или новые групповые поля. Личный sort и default-фильтры не менять ради симметрии. При refactor сравнить прежние ответы до/после, включая archived/detail, nullable/empty PATCH и ошибки close.

Общий schema amount допускает положительный currency unit; личные DTO сохраняют min 0.01, групповые проверяют IsPositive, конечность, normalizeMoney > 0 и precision валюты, включая JPY/RUB/KWD. Currency нормализуется trim/uppercase и неизменяема. Групповой description после trim 1–500; targetDate — строгая ISO-дата, просроченные/будущие планы допустимы. Create требует активную категорию; PATCH старой архивной категории без переназначения допускается, новое назначение/close с ней — 409.

### 2. Групповые маршруты и DTO

Все пути ниже относительно `/groups/:groupId`, JWT обязателен:

| Метод  | Путь               | Результат                               |
| ------ | ------------------ | --------------------------------------- |
| POST   | /plans             | 201, план                               |
| GET    | /plans             | 200, items/total/page/limit             |
| GET    | /plans/:id         | 200, план, включая архивный             |
| PATCH  | /plans/:id         | 200, активный неархивный план           |
| DELETE | /plans/:id         | 204, только active без расхода и архива |
| POST   | /plans/:id/archive | 204, повтор 404                         |
| POST   | /plans/:id/close   | 201, закрытый план                      |

List: status=active|closed, currency, includeArchived=true|false, page/limit. По умолчанию архив скрыт, includeArchived=true включает обе группы записей; значения boolean парсятся явно, строка false не превращается в true через implicit conversion. Group sort targetDate asc / createdAt desc / _id desc. Личный list/detail archive-контракт сохраняется отдельно. Архив не восстанавливается; group archived detail читается, PATCH/close — 404, DELETE — 409. Closed PATCH/повтор close — 400.

Group DTO сохраняет существующие поля Plan, добавляя owner/createdBy и createdByActor; у active нет expenseId/closedAt, у closed они присутствуют. Plan не имеет participantId. Закрытие принимает accountId, optional amount/closingDate/description/participantId; значения по умолчанию из плана, дата — сейчас, участник — исполнитель. Плановая amount не заменяется фактической; фактическая читается из связанного expenseId обычным expense API. Удалённый расход исключён из обычного чтения, но Plan остаётся closed и связь сохраняется; отдельного DTO удалённого расхода не добавлять.

Actor resolver этапа 07 переиспользуется: ослабить только требование type во внутреннем входном интерфейсе до optional, так как план не транзакция. Expense-only participant enrichment сохранить; не добавлять фиктивный type в Plan и не дублировать User lookup. Actor create/PATCH/close формируется внутри той же financial session; list — один batch по странице. Вложенные client actor/owner/status/expenseId/closedAt поля отклоняются global strict ValidationPipe. У пустых archive/delete/close query используются существующие пустые DTO.

### 3. Исполнение и права

Group adapter проверяет active membership и author/owner/manageTransactions до действий; settings permissions не дают mutation. Create/list/get доступны всем действующим участникам. Закрытие чужого плана делегатом сохраняет автора плана, createdBy расхода равен исполнителю. Новый participantId должен быть действующим; исторический creator может уже выйти/удаляться, и это не блокирует владельца/делегата.

В одной BudgetWriteService сессии: получить актуальный active/unarchived Plan; проверить права; получить активные счёт/категорию того же бюджета через существующие locks; проверить currency/date/precision/participant; вызвать ExpensesService.createForBudget с origin={type:plan,id}, исполнителем и participantId; условно закрыть Plan и записать expenseId/closedAt. Никакого nested commit. Plan.closedAt — серверное время закрытия, expense.transactionDate — closingDate; targetDate не ограничивает исполнение. Любая ошибка, включая actor lookup после записи, откатывает всё. Суммы расходов сохраняют обычную групповую политику отрицательного остатка; openingDate/архив/валюта проверяются как у обычного расхода.

Группа сериализуется до permissions и locks. Личные пути сохраняют сессию и условный active → closed переход, так что проигравший concurrent close откатывает созданный расход. У нового/старого closed плана нет повторного исполнения после expense soft-delete. Исправление/удаление расхода проверяет **его** createdBy/participantId/manageTransactions, а не автора плана; право на план не создаёт права на чужой расход. Plan.amount/closed/expenseId не меняются от обычного expense PATCH/DELETE, immutable origin сохраняется.

Альтернатива с частичными исполнениями потребовала бы отдельной истории и пересмотра состояний, что пользователь исключил. Использовать close вместо второго execute-алиаса: один совместимый термин и один call path.

### 4. Lifecycle и целостность

Create/update категории плана и её удаление используют общий lockBudgetExpenseCategory. Убрать user-only ветку проверки Plan при category RESTRICT: любые active/closed/archived планы своего бюджета блокируют удаление. Архив категории допустим, история сохраняется, новое исполнение блокируется. Group archive/delete plan сериализуются с close/permissions и не удаляют расход. Не добавлять accountId к самому плану: счёт выбирается при close, а его историю защищает уже созданный расход. Архив любого использованного счёта запрещает исправление/удаление этого расхода по прежнему правилу.

Group deletion сохраняет планы, но закрывает все endpoints. User deletion очищает только личные планы ownerType=user/ownerId (после backfill), не записи createdBy группового автора; диагностику worker согласовать. Добавить Plan owner user/group и createdBy к существующим integrity relations. В миграции/аудите проверять совпадение бюджетов Plan/category/expense и обратного origin, включая логически удалённый расход; не считать soft-delete висячей ссылкой. Исторические actor сведения остаются обезличенными.

### 5. Backfill и индексы

Новые Plan записываются с budget/creator сразу. Для существующих личных Plan backfill вычисляет ownerType=user, ownerId=userId, createdBy=userId только из валидного существующего userId, включая tombstone; уже назначенные значения сохраняются. Частично заполненные owner-поля проверяются на согласованность, конфликт/пропавшие ссылки выдаются в отчёте, а не угадываются. Не менять суммы, currency, targetDate/createdAt/updatedAt, статус, архив и expenseId/origin. Запись делать raw update без timestamps и без schema-default заполнения на чтении.

Разместить ограниченный helper backfill в существующем `src/database/integrity/` и поддержать dry-run/apply через отдельную maintenance entry point (по умолчанию dry-run, запись только с явным --apply). Не запускать seed или всю прежнюю lifecycle migration ради owner: она содержит другие writes. Пользоваться существующим runtime config/secrets без печати connection strings. Dry-run, apply и повтор на временной replica set обязаны доказать нулевые financial effects; реальные данные автоматически не трогать.

Сохранить личные индексы, добавить ownerType/ownerId/archivedAt/status/currency/targetDate/createdAt/_id для групповой выдачи и существующие categoryId/expenseId refs. Индексы создаются контролируемо до трафика тем же репозиторным паттерном и проверяются schema-indexes тестом. Составные индексы не означают новый фильтр author/participant.

### 6. Fixtures и проверки

Расширить существующие deterministic seeds одним active и одним закрытым семейным планом через общий сервис/adapter. Закрытие — настоящий origin-расход, не raw имитация; обновить суммы семейного ledger/report/limit/seed count и ожидания двух супругов. Активный план сам по себе не меняет деньги. Личные fixtures сохраняют прежний смысл.

До refactor зафиксировать личные plans + plan-debt-lifecycle/multicurrency characterization. Новые group HTTP RED подтвердят отсутствие routes. Затем проверить права/отзыв/изоляцию двух групп и личного бюджета, precision/openedAt, участника/архив/category RESTRICT, actor и отсутствие эффектов активного плана. Реальные explicit-barrier гонки: close/close, close vs PATCH/archive/delete, archive account/category, revoke/remove/ownership/group delete. Инъекции failure после расхода, Plan update и actor lookup должны восстанавливать документы/снимки. Личный snapshot carry остаётся прежним. Полные unit/e2e/build обязательны из-за cross-module изменений.

## Risks / Trade-offs

- Старые owner-поля отсутствуют → staged dry-run/apply и проверка до переключения scoped queries; не делать тихого широкого fallback по userId для групповых записей.
- Закрытый план с удалённым расходом выглядит исполненным → это согласованная история, frontend показывает closed и сохранённую связь, не предлагает повторный close.
- Изменение PlanSchema ослабляет schema min → личные DTO и characterization сохраняют прежний минимум, group service проверяет валютные units.
- Общий refactor может изменить личные ответы/ошибки → узкие characterization до изменения, затем полный набор, без косметических исправлений личного контракта.
- Расход и план меняются разными сервисами → одна supplied ClientSession, существующие locks/CAS и group serialization, rollback tests.

## Migration Plan

Остановить writes Plan на время owner backfill; сделать backup, dry-run, устранить неоднозначности, явно применить и повторно проверить нулевые обновления/целостность. Затем включить новый backend с индексами и scoped queries, проверить старые личные планы и групповой close. В локальной задаче миграция выполняется только на disposable test DB. Новых env/секретов не требуется.

Откат к прежнему backend после создания group Plan опасен: прежний user-deletion worker/категорийные проверки не понимают групповые планы. Сохранить данные и отключить групповые plan writes; нужен согласованный откат версии/новых полей и проверка личного API, без purge. Backfill полей обратно автоматически не откатывать и не восстанавливать удалённые персональные данные.

После реализации/проверок/ревью: первый коммит без co-authored → sync двух delta specs с сохранением Purpose/старых сценариев → архив → второй коммит. Этап 09 отдельно.
