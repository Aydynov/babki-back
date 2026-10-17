# Spec Delta

## ADDED Requirements

### Requirement: Direct operations on group savings
Активные balance и saving SHALL допускать групповые доходы/расходы с явным accountId и существующими правами авторства/атрибуции/manageTransactions. Валюта SHALL наследоваться от счёта, precision и openedAt SHALL проверяться одинаково для обоих типов. Учётный остаток saving SHALL допускать отрицательное значение. Операция SHALL менять только выбранный счёт и учитываться в общих расходах/доходах и лимитах ровно один раз.

#### Scenario: Shared reserve income and expense
- **WHEN** один участник создаёт доход KWD 0.003 на saving с opening 0.001, другой создаёт расход 0.005
- **THEN** saving amount равен -0.001; balance-счета и личные деньги не изменяются, валюта обоих движений KWD

#### Scenario: Existing attribution and permissions
- **WHEN** расход saving назначен другому участнику
- **THEN** author/participant остаются раздельными, исправление доступно по прежним правилам; manageAccounts само по себе не даёт права менять чужую операцию

#### Scenario: Savings expense limit
- **WHEN** расход 10 выполнен со saving в категории с лимитом той же валюты 15
- **THEN** rest равен 5, независимо от типа счёта; расход другой валюты не уменьшает этот лимит

### Requirement: Archived group accounts freeze financial mutations
Создание, PATCH и DELETE групповых доходов/расходов SHALL требовать активный счёт. Для архивного счёта запрос при наличии обычных прав на операцию SHALL возвращать 404 без изменения операции, атрибуции, снимков, остатков или лимитов. Это SHALL применяться к автору, участнику расхода, владельцу и делегату. Чтение истории и сумм архивного счёта SHALL оставаться доступным действующим участникам группы.

#### Scenario: Reject new archived operation
- **WHEN** участник создаёт доход или расход с accountId архивного balance либо saving
- **THEN** возвращается 404, новых операций и snapshots не возникает

#### Scenario: Freeze historical operation
- **WHEN** владелец, автор или уполномоченный делегат отправляет PATCH amount/description/items/participantId либо DELETE старой операции архивного счёта
- **THEN** возвращается 404, запись и её влияние на деньги/лимиты сохраняются

#### Scenario: Archived history remains readable
- **WHEN** другой действующий участник читает детали, список либо revenue с фильтром accountId архивного счёта
- **THEN** операции и суммы доступны с прежней исторической атрибуцией; бывший участник доступа не получает
