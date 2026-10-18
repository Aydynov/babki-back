# Babki API в Postman

[Открыть личное рабочее пространство babki-back](https://www.postman.com/workspace/d0d20e5b-f061-46da-99d2-421f74f9294d)

Репозиторий связан через `.postman/resources.yaml` с `Aydynov/babki-back`. Старое пространство, связанное с `ISAYwtf/babki-back`, сохранено.

## Что подготовлено

- **Babki API — current**: 132 метода из текущих NestJS-контроллеров, JSON-тела, параметры, JWT и проверки HTTP-кодов. Это каталог для отдельных запросов, а не сценарий для полного запуска. Методы удаления, смены владельца, приглашений и настройки 2FA требуют осознанного выбора.
- **Babki Smoke**: health check, профиль пользователя с JWT и проверка отказа без JWT.
- **Babki Personal Finance**: регистрация отдельного пользователя, профиль, отказ при неизвестном DTO-поле, счёт, категория, доход, расход, проверка баланса, список операций и отчёт. Затем отмена операций, проверка защиты истории категории и архивирование категории/счёта. Пользователь и финансовая история остаются в целевой БД. Используйте только отдельную тестовую БД.
- **Local / Docker / Staging / Production**: четыре окружения. Local и Docker используют `http://localhost:5001/api/v1` из примеров конфигурации. Для Staging/Production задайте свой `base_url`.
- **OpenAPI 3.0**: `specs/babki.openapi.json`, выведенный из контроллеров и валидаторов DTO. Успешные response schemas намеренно не описаны, кроме проверок в сценариях: типы возвращаемых сервисами объектов отдельно не формализованы. Дополнительные бизнес-ошибки возможны.
- **Визуальные Flows** Smoke и Personal Finance сохранены в облачном редакторе; финансовый Flow — шаблон, не проверенный Runner. Ограничения и ID: [flows/README.md](flows/README.md).
- **Git-native YAML** в `collections/` и `environments/`; JSON для ручного импорта в `exports/`.

## Быстрый старт

1. Запустите API и MongoDB replica set согласно инструкции проекта.
2. Откройте workspace и выберите **Babki Local** (либо нужное окружение).
3. Для Smoke и отдельных запросов задайте `access_token` локально в Postman. Для логина задайте `email`, `password` и запустите `POST /auth/login`; перенесите выданный токен в локальное значение `access_token`. Внутри одного Collection Runner токен передаётся автоматически без сохранения.
4. Для **Personal Finance** выставьте `allow_mutations=true` в окружении отдельного тестового сервера. Запустите коллекцию целиком в Runner с остановкой при ошибке. Email и пароль генерируются для каждого запуска и существуют только во время него.
5. Для запросов каталога заполните нужные ID (`account_id`, `category_id`, `group_id`, `group_account_id` и другие). Создание личных объектов запоминает их ID в рамках одного запуска Runner. Исходный и целевой счета перевода должны различаться.

Запись по умолчанию отключена: `allow_mutations=false`. Это дополнительная защита от случайного запуска, а не механизм прав сервера. Production требует отдельного выбора URL и учётных данных.

Пароли, токены, OTP и invitation token в шаблонах пустые. Заполняйте только локальные значения или используйте Postman Vault; не синхронизируйте и не коммитьте рабочие секреты. Runtime-переменные запросов (`pm.variables`) живут в пределах запроса или одного Runner; они не заменяют сохранённое окружение для независимых нажатий Send.

2FA: после логина с включённым вторым фактором используйте `challenge_token`, `second_factor_code` и `POST /auth/login/two-factor`. Поле `method` выбирает `totp` или `recovery`. Enrollment и удаление пользователя зависят от серверных feature flags. Recovery-коды расходуются при применении.

## CLI

```sh
postman login
postman workspace lint
postman spec lint postman/specs/babki.openapi.json --no-report-events
postman environment lint postman/environments --fail-severity warning
postman collection run postman/collections/smoke -e postman/environments/Local.environment.yaml --bail --no-report-events
postman collection run postman/collections/personal-finance -e postman/environments/Local.environment.yaml --env-var allow_mutations=true --bail --no-report-events
postman workspace diff --push-strategy default
postman workspace push --push-strategy default
```

Smoke требует локального окружения с JWT. Не передавайте реальные секреты в аргументах команд: используйте локальный неотслеживаемый файл окружения или Vault. `workspace pull` может затронуть локальные правки; перед импортом проверьте diff. Не используйте `force-sync` для обычной публикации.

## Поддержка актуальности

При изменении endpoint обновляйте OpenAPI, соответствующий YAML-запрос, сценарии и JSON-экспорт. Источник текущих маршрутов — `src/**/**.controller.ts`, ограничений — DTO. Запускайте lint и соответствующие сценарии после правок. Не регенерируйте каталог поверх вручную добавленных сценариев.

## Проверка при подготовке

Сценарии исполнены на настоящем NestJS приложении с глобальным JWT guard, ValidationPipe и error filter, с отдельной временной MongoDB replica set; тестовая БД удалена после проверки.

- Smoke: 3 запроса, 7 assertions, 0 ошибок.
- Personal Finance: 15 запросов, 30 assertions, 0 ошибок.
- Все 132 метода каталога структурно проверены; полный CRUD каждого домена отдельно не запускался.
- Полный каталог не следует запускать целиком.
