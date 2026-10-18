# Визуальные Postman Flows

Созданы в личном workspace `d0d20e5b-f061-46da-99d2-421f74f9294d` через штатный редактор Postman и **Create from collection**:

| Flow | ID | Источник | Окружение |
| --- | --- | --- | --- |
| Babki Smoke | `6ad49bc81969c711258fe79e` | Babki Smoke | Babki Local |
| Babki Personal Finance — template | `6ad49c68445fae9445297883` | Babki Personal Finance | Babki Local |

Они сохранены в Cloud View, не развёрнуты как публичные webhook endpoints. `postman workspace pull` не скачивает canvas Flows; эти ID — ссылки на облачные ресурсы, не локальные исполняемые файлы. Проверить наличие:

```sh
postman flows list --workspace d0d20e5b-f061-46da-99d2-421f74f9294d --json
```

Визуальные Flows **не запускались и не подтверждены как регрессионные тесты**. Для проверенного последовательного сценария используйте одноимённые коллекции в Collection Runner (`npm run postman:smoke`, `npm run postman:finance`). Коллекции проверены на настоящем API с временной БД.

Финансовый canvas — заготовка с 15 HTTP-блоками. Перед его запуском нужно проверить передачу `accessToken`, ID, дат и генерируемых регистрационных данных между блоками: локальные `pm.variables` в Runner не гарантируют тот же scope в Flows. Ожидаемые HTTP 400 и 409 требуют отдельной маршрутизации через Fail-порты; HTTP 401 в Smoke также ожидается. По умолчанию Success-порт ориентируется на HTTP 2xx и может игнорировать результаты assertions. Успешный статус одного блока не означает успех всего Flow.

Для последующей автоматизации canvas экспортируйте/сохраните настоящий Flow в Git-connected Local View редактора Postman и проверьте его командой `postman flows run <реальный-файл>`. Не подменяйте формат canvas произвольным JSON со списком шагов. Deployment нужен только если Flow должен вызываться по webhook и выбран подходящий доступный ему API target; облачный запуск не видит ваш localhost.
