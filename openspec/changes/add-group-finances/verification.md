## Verification

Проверено 21 сентября 2026 года в локальной ветке `feat/group-finances`.

### Команды и результаты

- `npm run test:e2e -- --runInBand` — 10 suites, 75 tests passed. Тесты используют отдельные временные MongoDB replica set и не обращаются к рабочей базе.
- `npm run test -- --runInBand` — 32 из 33 suites и 187 из 188 tests passed; один ранее существовавший тест упал: `src/config/config-files.spec.ts` ожидает успешный `docker compose config`, но временная фикстура копирует `.env` и не копирует требуемый текущим compose-файлом `.env.docker`. Этот сбой воспроизводился до change и не связан с групповыми финансами.
- `npm run build` — passed.
- `npx eslint src/common/utils/personal-budget.util.ts src/database/seeds/01-users.ts src/database/seeds/02-accounts.ts src/database/seeds/08-groups.ts src/database/seeds/index.ts src/modules/group-finances src/modules/groups src/modules/accounts src/modules/accounts-snapshots src/modules/transactions src/modules/expense-categories src/modules/expense-limits src/modules/reports test/group-finances-boundaries.e2e-spec.ts test/group-finances-compatibility.e2e-spec.ts test/group-finances-concurrency.e2e-spec.ts test/group-finances-isolation.e2e-spec.ts test/group-finances-seed.e2e-spec.ts test/group-finances.e2e-spec.ts test/group-permissions.e2e-spec.ts test/groups.e2e-spec.ts` — passed без ошибок и предупреждений.
- `openspec validate add-group-finances --strict` — valid.
- `git diff --check` — passed.

### Сверка спецификаций

- `budget-ownership`: три независимых бюджета, запрет межбюджетных ссылок и внедрения владельца, совместимость личного API, готовая начальная структура и изоляция после выхода/удаления группы проверены isolation, compatibility и seed e2e.
- `group-financial-permissions`: независимая выдача и немедленный отзыв трёх прав, owner-only управление, строгие DTO, журналирование, сброс при выходе/исключении/повторном вступлении и передаче владения проверены permission и isolation e2e.
- `group-wallet`: явное и конкурентное создание единственного кошелька, дата открытия, защита истории, атомарный расчёт, прошлые периоды/разные годы, дробные и отрицательные остатки, откат ошибки снимка проверены base, boundary и concurrency e2e.
- `group-transactions`: авторство и participantId, расход за другого участника, права изменения/удаления, доходы, историческая фильтрация и сериализация с изменениями членства проверены base, isolation и concurrency e2e.
- `group-budget-settings`: категории, архивирование и защита ссылок, непересекающиеся лимиты и их остатки, месячные/годовые отчёты и изоляция личных данных проверены isolation, boundary и concurrency e2e.

Групповые накопления, переводы между бюджетами, несколько групповых счетов, валюты, долги и планы остались за пределами change согласно proposal/design.

### Начальные данные и эксплуатация

Промышленное развёртывание рассчитано на пустую базу и использует актуальные Mongoose-схемы и индексы без legacy-миграции или startup barrier. Development seed создаёт четыре пользователя, семью, две организации и пустую группу, разные наборы прав, независимые кошельки, категории, лимит, операции за другого и бывшего участника и активное приглашение. Состав и учётные данные описаны в `docs/group-finances-seed.md`; отдельный e2e проверяет ключевые свойства этих fixtures.
