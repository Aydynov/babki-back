# Shared financial core

Every financial HTTP operation is scoped by `/spaces/:spaceId`. `BudgetContext` contains only `spaceId`; financial accounts, transactions, categories, limits, plans, debts and repayments store that immutable reference. Snapshots inherit their scope from their account. There is one financial service path and no personal ledger or implicit user context.

`Space.ownerId` is the administrative owner. `createdBy`, `participantId`, `deletedBy`, `cancelledBy`, member `userId` and actor `userId` describe people, never financial ownership. Deleting an author preserves financial records, balances and history; actor names become null after anonymization.

| Domain | Shared responsibility |
| --- | --- |
| Accounts and snapshots | Account create/list/detail/rename/archive/RESTRICT; opening balances, historical balances and snapshot effects use the selected space account. Snapshots are read-only over HTTP. |
| Income, expense and transfers | Typed domain commands delegate ledger effects to TransactionsService. Both transfer sides must belong to the requested space; one transaction commits both sides. |
| Categories and limits | Space-scoped names, reference locks, archives and usage checks. Limits count only their category and currency with inclusive UTC bounds. |
| Reports | Space-filtered aggregations, UTC periods and independent currency baskets. Balance and saving accounts remain separate; transfers expose both directed currency amounts. |
| Plans | Close joins expense creation in the same session, preserves planned amount and immutable expense origin, and executes at most once. |
| Debts and repayments | Repay/cancel join remaining/status, linked income and ledger compensation in one session. Noncash repayment does not affect accounts. |

The outer financial write owns the MongoDB transaction. Nested calls reuse its ClientSession. Access and write services serialize the space before checking current membership and delegated rights; permission revocation, removal and deletion therefore take effect with existing JWTs. Every reference lookup includes the requested space, including snapshots through accounts, transfer sides, categories and generated transaction origins. A member of two spaces cannot combine their records.

Public financial responses expose `spaceId` and omit internal mutationVersion, lockVersion and __v recursively. Actors retain their userId and current display names subject to privacy rules. Clients cannot inject space ownership or authorship through financial DTOs.

See [space-finances-api.md](space-finances-api.md) for monetary, permissions and lifecycle rules and [family-budget-contract-audit.md](family-budget-contract-audit.md) for regression coverage.
