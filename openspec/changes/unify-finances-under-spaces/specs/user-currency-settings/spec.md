# Spec Delta


## ADDED Requirements

### Requirement: Identity profile has no financial defaults
Профиль и auth-ответы SHALL не содержать defaultCurrency и defaultAccountId. Регистрация SHALL не принимать currency, а изменение профиля SHALL не принимать defaultCurrency/defaultAccountId. Наличие пространства и счёта SHALL не быть условием работы с профилем.

#### Scenario: Register and read profile without currency
- **WHEN** пользователь регистрируется без currency и запрашивает профиль до создания пространства
- **THEN** регистрация и чтение успешны, defaultCurrency/defaultAccountId отсутствуют и финансовых записей нет

#### Scenario: Reject removed profile fields
- **WHEN** регистрация содержит currency либо PATCH профиля содержит defaultCurrency или defaultAccountId
- **THEN** возвращается 400 по строгому DTO, профиль и финансы не меняются

#### Scenario: Financial defaults stay absent
- **WHEN** пользователь создаёт, архивирует или удаляет счета разных пространств
- **THEN** профиль не получает основной счёт или валюту; новая операция требует явный accountId пространства

## REMOVED Requirements

### Requirement: Default currency is an explicit profile preference
**Reason**: Профиль больше не хранит финансовую валюту и основной счёт; валюты задаются финансовым сущностям пространства явно.
**Migration**: Использовать финансовые API пространства на новой базе; перенос старых данных и обратная совместимость не предусмотрены.

### Requirement: Default account is currency-consistent
**Reason**: Профиль больше не хранит финансовую валюту и основной счёт; валюты задаются финансовым сущностям пространства явно.
**Migration**: Использовать финансовые API пространства на новой базе; перенос старых данных и обратная совместимость не предусмотрены.
