## ADDED Requirements

### Requirement: Group financial responses exclude storage metadata

Групповые финансовые HTTP-ответы SHALL рекурсивно исключать mutationVersion, lockVersion и __v. Правило SHALL действовать для create/PATCH/detail/list счетов, категорий, лимитов, операций, переводов, планов, долгов и погашений, включая timeline и compound ответы. Публичные данные, деньги, даты, идентификаторы, actors и личный контракт SHALL сохраняться; сохранённые поля блокировки SHALL не удаляться из БД.

#### Scenario: Nested account timeline and page

- **WHEN** участник создаёт, изменяет или читает групповой финансовый объект либо страницу
- **THEN** служебных ключей нет ни в объекте, ни во вложенных массивах и timeline; _id, ownerType/ownerId и финансовые значения сохраняются

#### Scenario: Repayment and cancellation compound responses

- **WHEN** участник погашает долг или отменяет погашение
- **THEN** debt и repayment не содержат служебных ключей, сохраняя origin/связи, createdByActor и cancelledByActor

#### Scenario: Storage and personal compatibility

- **WHEN** общий механизм обслуживает личные маршруты или выполняется групповая денежная мутация
- **THEN** личный DTO сохраняет прежнюю форму, а счётчики блокировок в БД продолжают работать; чтение ответа не изменяет сохранённые документы
