# Spec Delta

## MODIFIED Requirements

### Requirement: Group report currency contract
Каждый групповой период SHALL иметь только period и currencies. Корзина SHALL содержать currency, incomes, expenses, transfersIn, transfersOut, balance, saving, expensesByCategory с { categoryId, total }. Валюты SHALL сортироваться по коду и не складываться между собой. Денежные значения SHALL нормализоваться по minor units. balance SHALL суммировать остатки balance-счетов, saving — saving-счетов, включая архивные. transfersIn и transfersOut SHALL оставаться нулевыми до этапа переводов; saves SHALL отсутствовать.

#### Scenario: Shared report shape
- **WHEN** запрашивается отчёт группы с balance-счётом KWD, начальным остатком 0.001 и доходом 0.002
- **THEN** корзина KWD содержит incomes 0.002, balance 0.003 и нулевые остальные суммы; плоских incomes/expenses/balance/saves нет

#### Scenario: Empty group
- **WHEN** отчёт запрошен для группы без счёта и операций
- **THEN** каждый период возвращает currencies=[] без выдуманной валюты пользователя

## ADDED Requirements

### Requirement: Group report account type separation
Групповой отчёт SHALL суммировать все счета отдельно по currency и type на конец периода, учитывая initialAmount/openedAt и архивную историю. saving SHALL не включаться повторно в balance. Прямые доходы/расходы saving SHALL входить в incomes/expenses и категории ровно один раз; opening и архивирование SHALL не порождать доход/расход. Фильтр categories SHALL сохранять полные balance/saving/incomes.

#### Scenario: Multiple accounts in one currency
- **WHEN** у группы RUB balance 100, второй RUB balance 20 и RUB saving с opening 50, доходом 10 и расходом 5
- **THEN** RUB-корзина возвращает balance=120, saving=55, incomes=10, expenses=5; общие деньги 175 не выводятся как balance=175 вместе с saving=55

#### Scenario: Multiple currencies and archival
- **WHEN** дополнительно есть KWD saving 0.001, а RUB saving архивирован
- **THEN** KWD и RUB остаются отдельными корзинами в порядке кода, KWD saving=0.001 и RUB saving=55; архив не меняет расходы, доходы и сохранённые остатки

#### Scenario: Historical and filtered saving
- **WHEN** запрашивается период до открытия saving или расход другого category исключён фильтром
- **THEN** saving до открытия равен 0; фильтр меняет expenses/expensesByCategory, сохраняя полный saving, balance и incomes
