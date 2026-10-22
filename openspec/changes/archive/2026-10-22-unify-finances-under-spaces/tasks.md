# Tasks

## 1. Пространства, членство и приглашения

- [x] 1.1 Переименовать domain groups в spaces: schemas/refs/collections, module/provider/controller/DTO names, membership events и причины lifecycle; удалить type пространства, сохранив Space.ownerId как пользователя-владельца. Проверка: focused schema/service tests подтверждают Space без type, атомарное owner membership и уникальность spaceId/userId.
- [x] 1.2 Перенести управление на /spaces/:spaceId, сохранив пагинацию, owner/member, передачу владения, исключение, выход и четыре permissions. Перенести groups/permissions e2e: новый owner имеет все права, member без делегирования — четыре false, старый JWT учитывает revoke/leave/transfer, пользователь может остаться без пространств.
- [x] 1.3 Перенести invitation routes на /space-invitations и /spaces/:spaceId/invitations; accept возвращает spaceId, preview только name/expiresAt. Перенести invitation preview/rate-limit/concurrency tests: TTL boundary, одноразовость, совместный quota preview/accept, no-store, секреты не попадают в логи, регистрация не потребляет приглашение.
- [x] 1.4 Перенести конкурентные проверки membership/ownership/delete на пространства: e2e подтверждают одного владельца, атомарное завершение членств и отзыв pending invitations, отсутствие доступа и публичного восстановления удалённого пространства.
- [x] 1.5 Обновить документацию управления пространствами и соответствующие OpenAPI/catalog invitation/membership requests в этом этапе. Проверка: примеры не используют groupId/type, описывают нулевой список пространств и вступление без собственного; JSON OpenAPI разбирается и focused HTTP tests совпадают с примерами.

## 2. Единое владение и финансовое ядро

- [x] 2.1 Заменить ownerType/ownerId и личный ownership userId обязательным неизменяемым spaceId в Account, Transaction, ExpenseCategory, ExpenseLimit, Plan, Debt и DebtTransaction; обновить индексы/refs и проверку startup indexes. Проверка: schema/index tests подтверждают новые индексы, обязательность spaceId и сохранность account/transaction discriminator values.
- [x] 2.2 Упростить budget context/filter/access/write до обязательного пространства; удалить personalBudget fallback. Сохранить актуальную авторизацию внутри write transaction. Проверка: focused budget access/write tests покрывают отсутствие fallback, current membership, rollback и отказ для ссылки другого пространства, даже если actor состоит в обоих.
- [x] 2.3 Перевести общие accounts/snapshots/transactions/categories/limits/reports services, selectors, aggregation pipelines и mutation locks на spaceId, сохранив единые sessions и алгоритмы денег. Проверка: focused unit tests для каждого затронутого домена используют два пространства и подтверждают отсутствие смешения и точные исторические остатки.
- [x] 2.4 Сохранить привязку snapshots через accountId и проверять пространство счёта до чтения любого снимка; сохранить createdBy/participantId/deletedBy/cancelledBy, member.userId и actor.userId. Проверка: nested snapshot/transfer origin tests отклоняют чужие ссылки с 404, attribution tests сохраняют пользователя независимо от space owner.
- [x] 2.5 Обновить карту общих финансовых вызовов и описание ownership в docs/budget-financial-core.md и связанных актуальных документах. Проверка: документация описывает один space context, роль userId-ссылок и отсутствие личного ledger; зависимости общих providers не удалены вместе с controllers.

## 3. Счета, операции, переводы и настройки

- [x] 3.1 Перенести group-finances adapters/controllers/DTO на пространственную терминологию и /spaces/:spaceId/...; сохранить экспорт общих services и DI, убрать личные accounts/incomes/expenses/transfers/transactions/categories/limits/reports и snapshot controller registrations. Проверка: HTTP contract tests показывают работу новых маршрутов и 404 всех прежних корневых/групповых путей с JWT, приложение успешно создаётся в тестовом bootstrap.
- [x] 3.2 Привести финансовые HTTP responses к spaceId без ownerType/ownerId/ownership userId, рекурсивно сохранить исключение mutationVersion/lockVersion/__v и actor privacy. Проверка: response/actors e2e охватывают create/PATCH/detail/list/timeline, запрет client spaceId/author injection с 400 и корректные userId внутри actors.
- [x] 3.3 Перенести account lifecycle/savings/multicurrency e2e на новый API: пространство пустое, несколько balance/saving, явные name/currency, opening date, неизменяемые поля, precision, rename/archive/RESTRICT, отсутствие default account. Проверка: targeted account suites проходят для пространства с одним участником и общего пространства.
- [x] 3.4 Перенести transaction/transfer ledger и monetary regression tests на пространственный путь: обе денежные стороны, расходы saving, отрицательный учётный баланс, source funds на дату перевода, effectiveRate, archived freeze и однократная компенсация. Проверка: targeted unit/e2e и transaction/transfer concurrency suites проходят без потери дельт и частичных записей.
- [x] 3.5 Перенести category/limit/report e2e: space-scoped unique names, RESTRICT/архив, пересечения лимитов по валюте, currency baskets, UTC-периоды, opening/history, balance/saving и transfer totals. Проверка: targeted suites подтверждают прежний групповой календарный контракт и отсутствие данных второго пространства.
- [x] 3.6 Обновить финансовую документацию, OpenAPI и локальные catalog requests для счетов/операций/настроек вместе с HTTP изменениями. Проверка: методы, suffixes, фильтры, DTO и ошибки совпадают с e2e; примеры используют spaceId и не предлагают snapshot writes, currency профиля или type пространства.

## 4. Планы, долги и погашения

- [x] 4.1 Перенести Plan/Debt/DebtTransaction services/adapters и контроллеры на обязательный space context, удалить личные plan/debt/debt-transaction HTTP registrations и response wrappers. Проверка: focused services tests и новый route contract дают spaceId, прежние /plans и /debts со всеми дочерними маршрутами дают 404.
- [x] 4.2 Перенести plan lifecycle/permissions/concurrency tests: общая видимость, author/owner/manageTransactions, чужие и архивные ссылки, фактическая сумма close, участник, один расход, неизменяемый origin и отсутствие повторного close. Проверка: targeted plan unit/e2e suites подтверждают атомарный rollback и неизменность денег до исполнения.
- [x] 4.3 Перенести debt lifecycle/permissions/concurrency tests: receivable, partial/noncash repayments, currency, linked incomeId, cancellation, archive/RESTRICT, remaining/status и чужие ссылки. Проверка: targeted debt/repayment suites исключают переплату, двойную компенсацию и отдельный PATCH/DELETE связанного дохода, а отзыв права действует с прежним JWT.
- [x] 4.4 Обновить документацию планов/долгов, их OpenAPI и catalog requests. Проверка: примеры покрывают финансовое и некассовое погашение, отмену, close и spaceId; личного контракта и backfill-инструкций для этих сущностей в актуальном API guide нет.

## 5. Профиль, регистрация и удаление пользователя

- [x] 5.1 Удалить defaultCurrency/defaultAccountId из User schema, профиля, auth responses и DTO, currency из RegisterDto и AuthService; удалить ненужную финансовую зависимость UsersService. Проверка: auth/users unit и HTTP tests подтверждают регистрацию без валюты, отсутствие финансовых полей, 400 для удалённых полей и работу профиля при нуле пространств.
- [x] 5.2 Проверить сквозной onboarding: register → empty spaces → create либо accept invitation; после leave/removal/delete последнего пространства вход и профиль доступны. Проверка: новый focused onboarding e2e не находит автоматически созданных пространств, счетов, категорий или snapshots.
- [x] 5.3 Адаптировать UserDeletionService/worker к spaces; удалить personal financial cascade без замены на createdBy/participantId filters. Сохранить owner precondition, step-up, authVersion и retries. Проверка: user-deletion unit/e2e запрещают owner deletion с 409 и сохраняют все документы/суммы после удаления автора в нескольких пространствах, включая удалённое и бывшее одноучастниковое.
- [x] 5.4 Перенести deletion/actors privacy regression tests на пространства и выполнить существующие focused two-factor/authVersion проверки: pending/deleted/missing actors имеют null-имена, принятый запрос отзывает старый JWT и сохраняет tombstone; ошибка profile lookup не маскируется как успех.
- [x] 5.5 Обновить руководство регистрации/профиля/удаления и соответствующие OpenAPI/catalog/smoke requests в этом этапе. Проверка: примеры регистрации не содержат currency, удаление не обещает каскадную очистку финансов, owner transfer/delete описан как предварительное условие.

## 6. Seed, целостность и удаление legacy кода

- [x] 6.1 Перестроить development seeds и test helpers на пространства без type и финансовых настроек пользователя; добавить zero-space user и одноучастниковое пространство, сохранить мультивалютные и lifecycle fixtures общих пространств. Проверка: seed determinism/dynamic seed tests и seed e2e подтверждают воспроизводимость и изоляцию на чистой replica-set базе.
- [x] 6.2 Обновить integrity-relations/reader/audit и проверки debt consistency на space refs, сохранив проверки snapshot sides, origin/incomeId, currencies/remaining/status и authors. Проверка: integrity unit/e2e принимают чистый seed и обнаруживают специально созданные cross-space/orphan ссылки без изменения данных.
- [x] 6.3 Удалить backfill-plan-owners/backfill-debt-owners, их maintenance npm scripts и устаревшие personal ownership migration helpers/tests; актуализировать lifecycle maintenance, если оно используется integrity audit. Проверка: rg не находит активных ссылок на удалённые команды и helpers; актуальные integrity tests проходят без legacy owner-фильтров.
- [x] 6.4 Разобрать оставшиеся personal compatibility suites и utilities: удалить проверки старого wire contract, перенести ещё не покрытые денежные инварианты на пространства, удалить мёртвые imports/exports/wiring. Проверка: таблица соответствия старых suites новым проверкам в docs/contract audit подтверждает сохранность бизнес-регрессий; исходники и runtime tests не требуют user/group budget union.
- [x] 6.5 Обновить seed/integrity инструкции и актуальные rollout notes: новая disposable база, явное выполнение seed, без автоматического reset startup и обещаний переноса старых данных. Проверка: documented seed command соответствует package.json; свежие fixtures не содержат ownerType, финансового ownerId/userId или type пространства.

## 7. Согласование локальных API artifacts и интеграционная проверка

- [x] 7.1 Заменить runnable personal-finance collection на space-finance, обновить npm run postman:finance, scripts, примеры, ссылки environments и локальные exports. Использовать сохранённый workspace binding. Проверка: OpenAPI/catalog/smoke/runnable suite не ссылаются на удалённые финансовые маршруты, создают space и передают spaceId; secrets не добавлены в Git.
- [x] 7.2 Выполнить npm run postman:lint и npm run postman:smoke, затем npm run postman:finance против локального тестового API с одноразовыми данными. Проверка: сохранить команды и результаты; цепочка register/create space/account/operation проверяет новый контракт, негативные сценарии покрывают отсутствие членства и cross-space ссылки. Workspace push не выполнять; недоступный runtime отметить отдельно от статической проверки.
- [x] 7.3 Выполнить полный npm run test -- --runInBand, npm run test:e2e -- --runInBand и npm run build после всех изменений. Проверка: все команды успешны на replica-set окружении; isolation/concurrency/lifecycle/auth/seed suites работают на новой модели, причины любых внешних ограничений явно зафиксированы.
- [x] 7.4 Проверить финальный diff, согласованность OpenAPI с runtime routes и отсутствие старой терминологии в актуальных исходниках/API artifacts/документации. Проверка: rg по groupId, старым путям, personalBudget, ownerType и финансовым default fields не находит действующих совместимых веток; исторические OpenSpec IDs и архивные материалы учитываются отдельно, Space.ownerId и actor/member.userId сохранены намеренно.

## Workflow follow-up

- После реализации и проверки отдельно выполнить согласованный review и OpenSpec archive. Автоматическая реализация, публикация Postman workspace и deployment этим планированием не запускаются.

## Verification results

Проверено 2026-10-22 на локальных одноразовых MongoDB replica set; пользовательская база не использовалась.

- `npm run test -- --runInBand`: 57 suites, 373 tests passed.
- `npm run test:e2e -- --runInBand`: 40 suites, 406 tests passed.
- `npm run build`: exit 0.
- `npx eslint '{src,test}/**/*.ts'`: exit 0, без замечаний.
- `npm run postman:lint`: exit 0, 123 entities, 0 errors, 0 warnings.
- `npm run postman:smoke -- --env-var base_url=<temporary-api> --env-var access_token=<temporary-token>`: 3 requests, 7 assertions passed.
- `npm run postman:finance -- --env-var base_url=<temporary-api>`: 35 requests, 66 assertions passed; профиль и данные создавались только во временной базе.
- `openspec validate unify-finances-under-spaces --strict --json`: valid, без замечаний.
- `git diff --check`: exit 0. Независимый read-only review не нашёл actionable correctness/spec gaps.

Временные API, replica set и секреты Postman-проверки остановлены/удалены. Коммит, публикация workspace, deployment и архивирование change не выполнялись.
