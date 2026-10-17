# Tasks

## 1. Общая проверка приглашения и HTTP-контракт

- [x] 1.1 До refactor запустить существующие groups HTTP/concurrency и guard unit tests: подтвердить accept 200/409/общий 400, одноразовость, срок/отзыв/удаление и сохранить результаты. Добавить failing preview HTTP-проверки JWT, family/organization и точного `{ name, type, expiresAt }`; подтвердить исходный 404.
- [x] 1.2 Выделить общий private resolver digest/pending/expiry в GroupInvitationsService, сохранив повторное чтение accept после serializeMutation. Добавить read-only preview в одной ClientSession через GroupsTransactionService, с проекцией Group.name/type и invitation.expiresAt. Проверить 200, актуальное имя после rename, no-store, preview владельцем/участником и сохранение accept 409 без потребления.
- [x] 1.3 Подключить JWT preview route с тем же token DTO, строгим body и пустым query. Проверить 401; отсутствие/null/нестроковый token, неверный base64url/длину, unknown/nested поля и query — 400 без доменных записей. Проверить одинаковые status/message/error неизвестного, accepted/revoked/expired и deleted-group токенов, границу now=expiresAt и 503 при ошибке чтения.
- [x] 1.4 Обновить docs/groups-api.md маршрутом, точным DTO/статусами, flow «вход → preview → явный accept», no-store, поведением существующего участника и недоступных ссылок. Сопоставить JSON-примеры с HTTP assertions, явно сохранить отсутствие groupId/приглашающего/финансов.

## 2. Неизменность домена и повторная проверка принятия

- [x] 2.1 Проверить два preview с byte-equivalent invitation/group/membership/events/financial documents до и после (кроме rate counter), без mutationVersion/updatedAt changes. Затем accept должен создать ровно одно членство/событие; обычное чтение группы/финансов до вступления остаётся 404. Проверить, что expiresAt не продлевается.
- [x] 2.2 Добавить реальные сценарии revoke/expire/другой accept/group delete между preview и accept, а также explicit-barrier concurrent preview/accept в обеих последовательностях. Подтвердить общий 400 после инвалидирования, единственность вступления и отсутствие доменных writes от preview; повторить существующие acceptance/revocation/deletion race tests. Дополнить docs предупреждением об отсутствии резерва и гарантии последующего accept.

## 3. Общий лимит и защита секрета

- [x] 3.1 Переиспользовать GroupInvitationRateLimitGuard и существующий userId/windowStart store для обоих маршрутов. Проверить реальную смешанную квоту preview+accept 10/11, Retry-After, malformed body до validation, нового пользователя/окно, два guard instance над одним store, duplicate-key retry и fail-closed 503. Подтвердить отсутствие счётчика для 401; обновить docs общим лимитом без новых env/индексов.
- [x] 3.2 Добавить общий безопасный path helper для invitation preview/accept в существующие RequestLoggingInterceptor/HttpExceptionFilter. Сначала подтвердить failing query-secret regression, затем проверить отсутствие token/digest в логах и всём ответе, включая error.path, для body/query-only/body+query с JWT/без него и исходами 200/400/401/429/503. Учесть API-prefix, регистр и trailing slash; сохранить URL остальных маршрутов и error envelope. Обновить docs по application/proxy/APM secret handling.

## 4. Общая проверка и журнал

- [x] 4.1 Запустить затронутые unit/e2e, полный `npm run test -- --runInBand`, `npm run test:e2e -- --runInBand` и `npm run build`; scoped ESLint/Prettier без массового --fix, `git diff --check`, `openspec validate add-group-invitation-preview --strict --no-interactive`. Провести ревью token validation, минимальности DTO, race/readonly гарантий и секретов; исправить существенные замечания, записать точные exit codes и suites/tests.
- [x] 4.2 Обновить docs/family-budget-roadmap.md результатами, общими механизмами, средой временных MongoDB replica sets, отсутствием миграции/reset и ограничением live API. Сверить все delta-сценарии с тестами и 10/10 задач; не отмечать непроведённые проверки успешными. До отдельного запроса не создавать change этапа 07.

## Workflow follow-up

- После реализации, проверок и ревью сначала создать коммит без co-authored. Только после него синхронизировать group-invitations, сохранив Purpose и прежние сценарии, и архивировать change. Затем создать второй коммит архива по уточнению пользователя.
- Проверить main specs обычной валидацией и отсутствие активного этапа 06; записать commit, дату/путь архива и результат в roadmap. Не сокращать unrelated длинные требования ради strict-предупреждений.
- Затем перейти к отдельному планированию этапа 07 — исторические авторы и участники.
