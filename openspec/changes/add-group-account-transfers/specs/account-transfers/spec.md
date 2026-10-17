# Spec Delta

## MODIFIED Requirements

### Requirement: Transfer records both monetary effects
Перевод SHALL содержать исходный и целевой счета одного личного или группового бюджета, положительную фактическую сумму списания `sourceAmount`, положительную фактическую сумму зачисления `destinationAmount`, дату и необязательное описание. Счета SHALL быть различными, активными и принадлежать одному бюджету. Валюты SHALL определяться сервером по счетам и сохраняться в исторической записи. Комиссии SHALL отсутствовать в контракте первой версии.

#### Scenario: Same-currency transfer
- **WHEN** пользователь переводит 1000 RUB с RUB `balance` на RUB `saving`
- **THEN** исходный счёт уменьшается на 1000 RUB, а целевой увеличивается на 1000 RUB

#### Scenario: Cross-currency transfer
- **WHEN** пользователь указывает списание 90000 RUB и зачисление 1000 USD между соответствующими счетами
- **THEN** система сохраняет обе фактические суммы и применяет каждую только к её счёту

#### Scenario: Reject same account
- **WHEN** исходный и целевой `accountId` совпадают
- **THEN** система возвращает 400 без создания перевода

## ADDED Requirements

### Requirement: Group transfer monetary validation
Групповой перевод SHALL требовать sourceAccountId, destinationAccountId, sourceAmount, destinationAmount и transactionDate; description SHALL быть необязательным. Суммы SHALL быть конечными, положительными и соответствовать minor units валюты каждой стороны. Дата SHALL быть не раньше openedAt обоих счетов. Неверные суммы, одинаковые счета, дата или входные поля SHALL возвращать 400 без изменения денег.

#### Scenario: Small currency units
- **WHEN** перевод списывает JPY 1 и зачисляет KWD 0.001
- **THEN** обе суммы принимаются и effectiveRate отражает KWD за JPY; JPY 0.1 и KWD 0.0001 отклоняются с 400

#### Scenario: Both opening dates
- **WHEN** дата перевода раньше openedAt хотя бы целевого счёта, даже при достаточном остатке исходного
- **THEN** возвращается 400 без создания перевода и снимков

#### Scenario: Reject forged monetary identity
- **WHEN** клиент передаёт currency, source.currency, ownerId, createdBy, participantId или неизвестные поля вместо установленного DTO
- **THEN** возвращается 400; обе валюты и автор назначаются сервером

### Requirement: Group transfer source funds
При создании группового перевода доступный исходный остаток на transactionDate SHALL быть не меньше sourceAmount. При увеличении списания доступный остаток с уже применённым старым переводом SHALL покрывать дополнительную разницу. Иначе SHALL возвращаться 400 без изменений обеих сторон. Обычные расходы SHALL сохранять допустимый отрицательный остаток; перевод SHALL не получать такого исключения.

#### Scenario: Insufficient group source
- **WHEN** на дату перевода исходный saving имеет 5, а требуется списать 6
- **THEN** возвращается 400, даже если сегодня остаток больше; исходный/целевой остатки и история сохраняются

#### Scenario: Increase existing debit
- **WHEN** исходный остаток после старого списания 10 равен 2, а sourceAmount меняется с 10 на 13
- **THEN** PATCH возвращает 400; увеличение до 12 принимается, если остальные поля валидны

#### Scenario: Cancellation preserves historical reversal
- **WHEN** действующий уполномоченный участник отменяет перевод между активными счетами после расходования целевого зачисления
- **THEN** перевод компенсируется один раз по сохранённым суммам; целевой остаток может стать отрицательным, как при отмене личного перевода
