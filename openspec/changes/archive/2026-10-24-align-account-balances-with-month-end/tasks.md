# Tasks

Change оформлен после реализации. Ниже зафиксированы выполненные работы и проверки из этой сессии от 24 октября 2026 года.

## 1. Баланс счёта на конец месяца

- [x] 1.1 Использовать конец текущего месяца UTC при создании и общем формировании ответов счетов; проверить в AccountsService оба вызова balanceForBudget и общую дату расчёта списка.
- [x] 1.2 Добавить HTTP-регрессию будущего перевода между balance/saving, исключения дохода следующего месяца, одинаковых amount в list/detail/rename и будущего openedAt; `npm run test:e2e -- --runInBand test/space-accounts-savings.e2e-spec.ts` — 7/7. До исправления новый тест падал: amount 100000 вместо 50000.
- [x] 1.3 Обновить описание amount в docs/space-finances-api.md и сверить его с новым требованием Account response balance at current UTC month end.

## 2. Общая проверка

- [x] 2.1 Проверить совместимость через `npm run test -- --runInBand` — 373/373, `npm run test:e2e -- --runInBand` — 407/407 и `npm run build` — успешно.
- [x] 2.2 Проверить изменённые TypeScript-файлы через `npx eslint src/modules/accounts/accounts/accounts.service.ts test/space-accounts-savings.e2e-spec.ts` и `npx prettier --check src/modules/accounts/accounts/accounts.service.ts test/space-accounts-savings.e2e-spec.ts` — успешно.

## Workflow follow-up

- Синхронизировать delta group-wallet с основной спецификацией и архивировать завершённый change.
- Проверить OpenSpec validation и отсутствие активного change после архивации.
