# Tasks

## 1. Общий resolver и контракт операций

- [x] 1.1 До изменения запустить личные compatibility и групповые finances/transfers HTTP-наборы, записать исходные результаты. Добавить failing проверки createdByActor/participantActor на групповых расходе, доходе, переводе и общей истории; подтвердить RED отсутствующих полей.
- [x] 1.2 Добавить GroupFinancialActor и один GroupFinancialActorsService с пакетным active User lookup, безопасной проекцией и fallback. Unit-тестами проверить точные keys/nullability, dedup, один запрос на страницу/ноль на пустой список, отсутствие мутации входа, ClientSession и propagation ошибки; никаких копий имён и N+1.
- [x] 1.3 Подключить resolver к group expense/income/transfer list/detail и mixed history после текущей авторизации/фильтров/пагинации. Проверить единый DTO, раздельных автора/участника, отсутствие participantActor у дохода/перевода и при отсутствующем legacy participantId, сохранение type/effectiveRate/items/total/page/limit/денег.
- [x] 1.4 Обогащать create/PATCH доходов/расходов/переводов внутри существующего BudgetWriteService callback с той же сессией. Проверить HTTP-ответы и переатрибуцию participantActor при разрешённой смене participantId, server-owned actor fields (unknown input — 400), неизменные createdBy и DELETE 204 без тела/actor lookup.
- [x] 1.5 Обновить docs/group-finances-api.md точными actor DTO/nullable-полями/охватом routes и примерами, сверить с HTTP assertions. Исправить документальное имя discriminator `type` вместо `transactionType` в ответе перевода, сохранив `transactionType` как query и production-поле; архивные спеки не менять.

## 2. Исторические субъекты, приватность и ошибки

- [x] 2.1 Проверить текущие имена после profile rename, выхода/исключения/повторного вступления, чтение архивных счетов и исторический participantId filter. Сопоставить с неизменным active-only каталогом и 404 бывшего вызывающего со старым JWT; зафиксировать отсутствие дополнительного доступа или финансовых эффектов.
- [x] 2.2 Проверить реальный UserDeletionService.request: deletion_pending с ещё сохранёнными именами уже даёт обезличенный actor. Довести реальный worker до tombstone и подтвердить тот же userId/null-имена/isAnonymized, отсутствие копий профиля и неизменные групповые ссылки/деньги. Отдельно проверить отсутствующий профиль и совпадающего автора/участника.
- [x] 2.3 Проверить JWT 401, чужие ID/группу 404, пустой чужой participantId filter без user lookup, личный бюджет и две группы. Exact-key assertions должны исключить email/description/auth/status/defaultCurrency/личные финансы; личные DTO, revenue/отчёты, исторические суммы и permissions не меняются.
- [x] 2.4 Добавить failure injection User lookup: read возвращает нормализованную серверную ошибку без ложного успеха/fallback, create/PATCH откатывают запись, счета и snapshots в той же транзакции, включая обе transfer sides. Проверить новые чтения после committed rename/deletion без stale cache; повторить текущие permission/concurrency/deletion suites.
- [x] 2.5 Обновить docs/groups-api.md и docs/budget-financial-core.md политикой текущих имён/обезличивания и общим resolver call path. Проверить соответствие поведения worker, раннего pending-маскирования, session/rollback и active-only каталога фактическим тестам; описать добавочные поля для строгих клиентов и отсутствие миграции.

## 3. Общая проверка и журнал

- [x] 3.1 Запустить затронутые тесты, `npm run test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npm run build`, scoped Prettier/ESLint без массового --fix, `git diff --check`, `openspec validate resolve-group-historical-actors --strict --no-interactive`. Провести независимое ревью изоляции/приватности/транзакций; исправить существенные замечания, сопоставить все delta-сценарии с тестами и записать точные exit codes/suites/tests.
- [x] 3.2 Обновить docs/family-budget-roadmap.md результатами, переиспользованием общих механизмов, отсутствием миграции/reset, средой временных replica sets и ограничениями live API. Проверить 12/12 задач; незапущенные проверки не считать успешными. Не создавать change этапа 08 до отдельного планирования.

## Workflow follow-up

- После реализации/проверок/ревью создать первый коммит без co-authored. Затем sync единственной group-transactions delta с сохранением Purpose и прежних сценариев, архивировать change и создать второй коммит архива.
- Проверить обычную main-spec валидацию и отсутствие активного change этапа 07; обновить журнал commit/датой/путём архива. Не сокращать unrelated требования ради strict-предупреждений.
- Далее отдельно спланировать этап 08 — общие планы; применять тот же resolver в его групповом адаптере, не создавать его копию.
