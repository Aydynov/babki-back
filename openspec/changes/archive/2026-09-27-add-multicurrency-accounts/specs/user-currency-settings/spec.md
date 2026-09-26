## Purpose

Определить пользовательскую валюту по умолчанию и согласованный основной счёт, не меняя валюту или номинальные суммы уже созданных финансовых данных.

## ADDED Requirements

### Requirement: Default currency is an explicit profile preference
Профиль пользователя SHALL хранить обязательный ISO 4217 код `defaultCurrency`. Регистрация SHALL принимать поддерживаемую валюту, нормализовать код в верхний регистр и возвращать его в профиле. Изменение настройки SHALL влиять только на последующие значения по умолчанию и представление интерфейса и SHALL не конвертировать счета, операции, лимиты, планы или долги.

#### Scenario: Register with default currency
- **WHEN** пользователь регистрируется с поддерживаемым кодом `rub`
- **THEN** профиль создаётся с `defaultCurrency: RUB`

#### Scenario: Reject unsupported currency
- **WHEN** регистрация или изменение профиля содержит неизвестный или неподдерживаемый код валюты
- **THEN** система возвращает 400 без изменения профиля

#### Scenario: Change does not rewrite history
- **WHEN** пользователь меняет `defaultCurrency` с RUB на USD при наличии RUB-счетов и операций
- **THEN** существующие валюты и суммы сохраняются без пересчёта

### Requirement: Default account is currency-consistent
Профиль SHALL допускать один `defaultAccountId`, ссылающийся на активный личный счёт типа `balance`, валюта которого совпадает с `defaultCurrency`. До создания подходящего счёта ссылка MAY отсутствовать. Первый созданный активный `balance` в валюте профиля SHALL атомарно стать основным, если основной счёт ещё не выбран. Явная смена основного счёта или одновременная смена валюты и счёта SHALL проверять принадлежность, тип, активность и совпадение валюты. Смена только `defaultCurrency` SHALL атомарно очистить несовместимый `defaultAccountId`, не выбирая другой счёт неявно.

#### Scenario: First matching balance becomes default
- **WHEN** пользователь без основного счёта создаёт первый `balance` в своей `defaultCurrency`
- **THEN** созданный счёт атомарно записывается как `defaultAccountId`

#### Scenario: Select matching default account
- **WHEN** пользователь выбирает принадлежащий ему активный USD `balance` и одновременно устанавливает `defaultCurrency: USD`
- **THEN** обе настройки обновляются согласованно

#### Scenario: Reject incompatible default account
- **WHEN** пользователь выбирает чужой, архивный, накопительный либо имеющий другую валюту счёт
- **THEN** система возвращает 400 или 404 без частичного изменения настроек

#### Scenario: Currency-only change clears incompatible default
- **WHEN** пользователь меняет только `defaultCurrency` с RUB на USD при выбранном RUB-счёте
- **THEN** валюта обновляется, а `defaultAccountId` атомарно становится null
