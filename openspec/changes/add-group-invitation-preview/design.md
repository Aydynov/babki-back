# Design

## Context

См. proposal.md — Why. Пользователь выбрал JWT и только `{ name, type, expiresAt }` (2026-10-17). Это ограниченное расширение существующего invitation flow, а не новый механизм приглашений.

GroupInvitationsController сейчас предоставляет accept; GroupInvitationsService хранит SHA-256 digest и проверяет pending/expiry внутри GroupsTransactionService. Accept сериализует мутации группы, повторно читает ссылку, создаёт членство и событие атомарно. GroupInvitationRateLimitGuard уже считает запросы до DTO-validation через уникальный MongoDB-счётчик userId/windowStart, умеет duplicate-key retry, 429/Retry-After и fail-closed 503. GroupsModule регистрирует все необходимые модели и индексы.

AcceptGroupInvitationDto проверяет 43 base64url-символа; глобальный ValidationPipe запрещает неизвестные поля. RequestLoggingInterceptor не пишет body, но использует request.url, как и поле path в HttpExceptionFilter. Поэтому ошибочный query с секретом требует защиты метаданных обоих invitation routes. Существующие groups HTTP/concurrency и guard unit tests уже проверяют одноразовость, срок, отзыв, удаление и лимит.

## Goals / Non-Goals

**Goals:** расширить существующий сервис и проверки, сохранить атомарный accept и общий безопасный денежно-независимый invitation flow. Предпросмотр должен быть чтением доменных данных; единственная запись — существующий счётчик попыток.

**Non-Goals:** public endpoint, inviter name, проверка членства как условие preview, новая invitation-модель, отдельный rate-limit store, изменения финансов, клиентское хранение токена, новая внешняя документационная инфраструктура.

## Decisions

### 1. Тонкий JWT-маршрут и явный DTO

Добавить POST preview в существующий контроллер: CurrentUser, тот же guard и формат token DTO, HTTP 200 и Cache-Control: no-store для успеха. Query должен быть пустым через существующий пустой DTO/глобальную валидацию; токен только в body. Не переименовывать публичный accept DTO ради косметики; переиспользовать его или минимальный общий базовый DTO без ослабления validation. Service возвращает явную проекцию трёх полей, без сериализации Group/Invitation целиком.

JWT выбран пользователем; public preview потребовал бы другого ограничения попыток и решения о приватности. В ответе нет groupId: accept по-прежнему получает token и возвращает groupId после вступления. Действующий участник/владелец может получить preview 200; accept для него остаётся 409.

### 2. Общий private resolver в GroupInvitationsService

Выделить поиск по digest и проверку pending/now < expiresAt в небольшой private helper, используемый preview и accept. Сохранить генерацию/хранение digest и Invalid invitation 400. Accept должен сохранить group serialization и повторную проверку после неё: нельзя заменить актуальное чтение объектом из preview или раннего lookup.

Preview выполняет чтения приглашения и неудалённой Group в одной read-only транзакции через существующий GroupsTransactionService.run с той же ClientSession; Group-модель уже зарегистрирована, достаточно DI в сервис. Не вызывать serializeMutation, requireMember или выдачу permissions: они либо изменяют группу, либо закрывают preview будущему участнику. Отсутствующую/удалённую группу преобразовать в тот же Invalid invitation. Сбой чтения/транзакции нормализуется существующим 503 без деталей MongoDB.

Альтернатива — отдельный service/resolver и собственная aggregation pipeline; для двух вызовов это усложняет существующий flow. Отдельные несогласованные чтения invitation/group создают лишние промежуточные состояния. Общая read-only сессия даёт согласованное прочитанное состояние без записи/резервирования группы. При конкурентном отзыве/accept допустим успешный ответ из ранее прочитанного действительного состояния: после preview клиент всегда заново вызывает accept, который проверяет актуальные данные.

### 3. Один существующий лимит для preview и accept

Повесить GroupInvitationRateLimitGuard и на preview, сохранив ключ userId/windowStart и 10 за фиксированную минуту. Не добавлять route dimension, второй лимит, новые env или индексы. Суммарный лимит учитывает успех, ошибки токена и malformed body; JWT проверяется раньше, неавторизованный запрос не расходует персональный счётчик. Успешный preview не является доменной мутацией, хотя счётчик увеличивается.

Отдельные квоты позволили бы удвоить проверки секрета и потребовали бы новой модели/миграции ключа. Клиенту явно сообщить общий бюджет запросов и Retry-After. Текст существующего 503 guard можно сохранить, чтобы не менять accept без необходимости.

### 4. Защита токена в стандартных логах и ошибках

Переиспользовать RequestLoggingInterceptor и HttpExceptionFilter, добавив небольшой общий helper безопасного request path для путей preview/accept: исключать query целиком в логах и path ошибки при любом HTTP-исходе, включая JWT failure и DTO rejection. Учитывать настраиваемый API-prefix, trailing slash и обычную нечувствительность маршрутов к регистру. Остальные URL и нормализованный error envelope сохранить. Не менять request.url и не создавать route-specific exception filter или второй механизм логирования.

Не журналировать body, digest или header JWT. Query не является альтернативным транспортом token. Регрессии должны покрывать query-only и body+query, с JWT/без него, success и failures, а также отсутствие секрета в nested/unknown-field validation errors. Инфраструктурные proxy/APM логи лежат вне локального API; docs повторяет запрет записи токенов там.

### 5. Проверки и сохраняемые контракты

Новый HTTP-набор переиспользует startGroupsTestApp и временную MongoDB replica set. Проверить обе группы family/organization, точный набор полей, актуальное имя после rename, no-store, 401, строгий body/query, одинаковые ошибки для всех недоступных состояний и точную границу expiresAt. Сравнивать доменные документы до/после двух preview: invitation/membership/events/group mutationVersion/updatedAt и финансы неизменны; счётчик исключить из этого сравнения.

После двух preview accept должен создать одно членство и событие. Проверить revoke/expire/другой accept/delete между preview и accept; concurrent preview не создаёт членств и не меняет одноразовость. Для shared quota использовать фиксированное время и реальные счётчики, два guard instance над тем же store; проверить смесь маршрутов, отдельного пользователя, следующее окно, malformed body и 503. Общие logging/filter helpers получают узкие unit-регрессии. Существующие groups/concurrency и full unit/e2e/build подтверждают совместимость accept и остального API.

## Risks / Trade-offs

- Preview может устареть сразу после ответа → accept повторно проверяет актуальную ссылку, UI обрабатывает общий 400.
- Preview расходует квоту принятия → docs описывает единый лимит; frontend не опрашивает endpoint циклически.
- Refactor проверки ссылки может ослабить сериализацию accept → characterization существующих правил до переноса и повторные реальные race tests.
- Непреднамеренная выдача полей Group → явный объект ответа и equality точных keys в HTTP-тесте.
- Query отражается до controller validation → helper используется глобальными logging/filter механизмами для invitation routes; unit и HTTP проверяют 401/400/429/503.

## Migration Plan

Миграций, reset, новых индексов/секретов/env нет. После проверок развернуть backend, затем frontend вызывает preview после авторизации и перед явным accept. Ранее созданные pending ссылки работают. Откат убирает preview; состояния ссылок/членств сохраняются, accept продолжает работать. В локальном workflow после реализации/проверок/ревью сначала создать коммит без co-authored, затем sync единственной delta и архив, записать результаты в roadmap. Рабочая база и live API при планировании не проверялись.
