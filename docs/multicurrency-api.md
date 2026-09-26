# Multicurrency personal finance API

`User.defaultCurrency` is a UI preference. `defaultAccountId` is nullable and
may reference only an active personal `balance` account in that currency.
Changing only the currency clears an incompatible default account; it never
rewrites historical amounts.

Personal accounts are managed through `/accounts`. Creation accepts `name`,
`type` (`balance` or `saving`), `currency`, optional `amount`, and optional
`openedAt`. Only `name` can be changed later. Archiving prevents new operations
while retaining reports and history.

Income and expense creation requires `accountId`. Currency is read from the
account and stored on the operation. Amount precision follows the ISO 4217
minor units of that currency.

`GET /transactions` can filter by `accountId` across income, expense and both
transfer effects. Personal `/incomes/revenue` and `/expenses/revenue` return
`currencies[]` totals. `totalRevenue` is `null` when more than one currency is
present, so unlike currencies are never added into one number.

`POST /transfers` accepts `sourceAccountId`, `destinationAccountId`,
`sourceAmount`, `destinationAmount`, `transactionDate`, and optional
`description`. Both effects are committed atomically. Same-currency amounts
must match; cross-currency amounts preserve the actual debit and credit. The
response derives a directed effective rate from those stored amounts. Fees are
not part of this version's public contract.

Limits, plans, and debts declare an immutable currency. Plan closing and
income-producing debt repayment require an account in that currency. Personal
reports return `currencies[]` per period with independent income, expense,
balance, saving, transfer-in, transfer-out, and category totals; no implicit
conversion is performed.
