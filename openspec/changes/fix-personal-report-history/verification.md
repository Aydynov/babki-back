# Verification

Дата: 15 октября 2026 года.

## Изменение

ReportsService выбирает минимальную доступную дату снимка независимо от порядка массива и больше не ограничивает историю началом текущего года. Общая выборка AccountsSnapshotsService, DTO, валютные агрегаты, схемы и авторизация не изменены.

## Команды и результаты

- `npm run test -- reports.service.spec.ts --runInBand`: до исправления 5 новых регрессионных тестов упали из-за пропущенных исторических периодов; после исправления 10/10 passed.
- `npm run test:e2e -- --runInBand personal-report-history.e2e-spec.ts`: 1/1 passed на отдельной временной MongoDB replica set. Проверены прошлый год, доход текущего года, совпадение исторического дохода с `/incomes/revenue` и начало месячной истории.
- `npm run test -- --runInBand`: 49/49 suites, 283/283 tests passed.
- `npm run test:e2e -- --runInBand`: 16 suites passed, 2 failed; 116 tests passed, 3 failed. Сбои перечислены ниже.
- `npm run build`: exit 0.
- `npx eslint src/modules/reports/reports.service.ts test/personal-report-history.e2e-spec.ts`: exit 0, без замечаний. Unit-файл исключён существующей конфигурацией ESLint.
- `npx prettier --check src/modules/reports/reports.service.ts src/modules/reports/reports.service.spec.ts test/personal-report-history.e2e-spec.ts`: успешно.
- `openspec validate fix-personal-report-history --strict`: успешно.
- `git diff --check`: успешно. Diff проверен: изменены helper отчётов, unit-тесты, добавлен e2e-тест и артефакты change; посторонних изменений нет.

Первые запуски HTTP-проверок внутри sandbox блокировались на `listen EPERM`; итоговые HTTP-прогоны выполнены с разрешением на локальные порты. Пользовательская и production-БД не использовались.

## Существующие сбои e2e

Все три сбоя также воспроизведены в отдельной временной копии исходного `HEAD`, без исправления ReportsService, командой `MONGO_DB_NAME=babki_groups_test npm run test:e2e -- --runInBand groups.e2e-spec.ts accounts-deletion-concurrency.e2e-spec.ts`: 21 passed, те же 3 failed.

- `groups.e2e-spec.ts` / `does not modify personal finance records or report results`: `/reports/years` возвращает 500 вместо 200.
- `accounts-deletion-concurrency.e2e-spec.ts` / `preserves both accounts, snapshots and transfer when either transfer account is deleted`: создание перевода возвращает 400 вместо 201.
- `accounts-deletion-concurrency.e2e-spec.ts` / `soft deletes a personal transfer, hides it and preserves immutable dependencies`: создание перевода возвращает 400 вместо 201.

Эти сбои не исправлялись в рамках данного change. Полный e2e-набор остаётся красным, хотя новые регрессии и все unit-тесты проходят.
