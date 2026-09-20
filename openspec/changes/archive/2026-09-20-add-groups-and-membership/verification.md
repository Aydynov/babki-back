# Проверка реализации

Дата: 2026-09-20. Реализованы три capabilities текущего change: groups, group-membership и group-invitations. Финансовые схемы и API не изменялись.

## Команды и результаты

- `npm run test -- --runInBand groups`: 3 suites, 10 tests — passed.
- `npm run test -- --runInBand`: 29 suites passed, 1 failed; 180 tests passed, 1 failed. Исходное падение `src/config/config-files.spec.ts` / `renders the API port, healthcheck, and secrets mount from one .env`: тест создаёт `.env`, а текущий docker-compose.yml требует `.env.docker`. Диагностический запуск `docker compose config --format json` в изолированной копии тестовой фикстуры подтвердил ошибку отсутствующего файла. Этот сбой воспроизведён до реализации групп и не менялся в рамках change.
- `npm run test:e2e -- --runInBand`: 3 suites, 33 tests — passed, включая 16 конкурентных/транзакционных сценариев на настоящем replica set.
- `npm run build`: passed.
- `npx eslint src/modules/groups src/app.module.ts test/helpers test/groups*.ts test/two-factor.e2e-spec.ts`: passed.
- `openspec validate add-groups-and-membership --strict`: passed.
- `git diff --check`: passed.

## Покрытие и review

HTTP-тесты работают с настоящим AppModule, JWT и MongoDB; проверяют изоляцию групп, роли, изменение членства, приглашения, валидацию, приватность DTO, отсутствие токенов в логах, лимит запросов и независимость личных финансов/отчётов. Тесты срока действия фиксируют время и проверяют границу expiresAt.

Конкурентный набор выполняет настоящие транзакции на одноразовом MongoDB replica set и синхронизирует их тестовыми барьерами. Проверены одна ссылка/два получателя, две ссылки/один получатель, принятие против отзыва/удаления, передача против выхода/исключения/удаления/другой передачи. Ошибка записи события откатывает создание группы или потребление приглашения вместе с членством и mutationVersion.

Независимый review обнаружил обход защиты владельца через uppercase ObjectId. HTTP-регрессия сначала получила ошибочный 204 вместо 409, после исправления сравнения через ObjectId.equals проходит. Повторный scoped review подтвердил исправление. Выявленная интеграционными тестами типизация ссылок как Mixed исправлена явным Schema.Types.ObjectId во всех новых схемах.

Существующие TOTP e2e переведены на тот же одноразовый локальный replica set без изменения проверяемого поведения. Для запуска нужен mongod (или MONGOD_BINARY) и разрешение локальных TCP-сокетов. Sandbox-запуск был ограничен EPERM; итоговые HTTP-тесты выполняются вне этих ограничений. Рабочие базы не использовались.
