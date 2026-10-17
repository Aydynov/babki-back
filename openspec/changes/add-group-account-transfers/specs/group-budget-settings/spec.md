# Spec Delta

## MODIFIED Requirements

### Requirement: Group report currency contract
Каждый групповой период SHALL иметь только period и currencies. Корзина SHALL содержать currency, incomes, expenses, transfersIn, transfersOut, balance, saving, expensesByCategory с { categoryId, total }. Валюты SHALL сортироваться по коду и не складываться между собой. Денежные значения SHALL нормализоваться по minor units. balance SHALL суммировать остатки balance-счетов, saving — saving-счетов, включая архивные. transfersIn SHALL суммировать фактические зачисления переводов, transfersOut — списания, по валюте соответствующей стороны; saves SHALL отсутствовать.

#### Scenario: Shared report shape
- **WHEN** запрашивается отчёт группы с balance-счётом KWD, начальным остатком 0.001 и доходом 0.002
- **THEN** корзина KWD содержит incomes 0.002, balance 0.003 и нулевые остальные суммы; плоских incomes/expenses/balance/saves нет

#### Scenario: Empty group
- **WHEN** отчёт запрошен для группы без счёта и операций
- **THEN** каждый период возвращает currencies=[] без выдуманной валюты пользователя

## ADDED Requirements

### Requirement: Group transfer reporting separates movements
Каждый неудалённый перевод SHALL отражаться в transfersOut исходной валюты и transfersIn целевой валюты своего UTC-периода. Он SHALL не увеличивать incomes, expenses, expensesByCategory или использование лимитов. Для одной валюты обе суммы SHALL учитываться, даже внутри одного типа счетов. Категорийный фильтр SHALL не ограничивать переводы или общий balance/saving. Удалённый перевод SHALL исключаться из движений и остатков.

#### Scenario: Reserve movement
- **WHEN** из RUB balance с 1000 переведено 100 на RUB saving с 0
- **THEN** отчёт показывает balance=900, saving=100, transfersOut=100, transfersIn=100, incomes=expenses=0; совокупные деньги группы остаются 1000

#### Scenario: Actual currency conversion
- **WHEN** из RUB balance с 90000 переведено 90000 с зачислением USD 1000 на saving
- **THEN** RUB transfersOut=90000 и balance=0, USD transfersIn=1000 и saving=1000; разные валюты не суммируются и доходы/расходы не возникают

#### Scenario: Category filter and reversal
- **WHEN** отчёт ограничен категорией после перевода либо перевод затем удалён
- **THEN** фильтр не убирает transfer totals; после удаления обе стороны исключены из transfersIn/Out, а остатки восстановлены с учётом остальных операций
