# Multicurrency space finances

Registration creates a user without financial settings or spaces. Create a space explicitly; it starts without accounts, categories, limits, plans, debts or snapshots. A user may belong to zero spaces. The profile has no default currency or account.

All financial routes are below `/spaces/:spaceId`. Account creation requires name and currency, accepts balance/saving type and optional amount/openedAt. Only the name can change later. Multiple accounts with the same type or currency are allowed. Archiving freezes mutations and preserves readable history.

Income and expense require accountId and inherit the account currency. Amount precision follows ISO 4217 minor units. Transfers require sourceAccountId, destinationAccountId, sourceAmount, destinationAmount and transactionDate, with optional description. Both accounts belong to the requested space; both effects commit atomically. Same-currency amounts match; cross-currency amounts preserve actual debit and credit and derive a directed effectiveRate. No implicit conversion occurs.

Revenue and reports return independent currencies[] baskets; totalRevenue is null for mixed currencies. Period reports separate balance, saving, income, expense, transfer-in, transfer-out and categories. Account selection and UTC period rules follow [the financial API](space-finances-api.md).

Limits, plans and debts declare immutable currencies. Plan closing and financial debt repayment select an account in that currency. Noncash debt repayment changes debt remaining/status without creating income or touching accounts.
