# Financial ownership inventory

The ownership boundary covers accounts, transactions (income, expense, save), expense categories and expense limits. Each stores `ownerType` and `ownerId`; personal `userId` remains for compatibility. Transactions also store `createdBy`; expenses store `participantId`. Snapshots derive ownership exclusively from their account. Debts and plans remain personal.

| Flow                              | Ownership enforcement and compatibility                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration / balances / savings | Personal AccountsService creates the user owner pair and initial snapshot in one transaction. Existing discriminator names remain unchanged.                                                                      |
| Development seeds                 | Seed создаёт четыре пользователя, личный бюджет, семью, две организации и пустую группу. Финансовые записи создаются актуальными сервисами с owner-парой, авторством и участником.                              |
| Personal accounts and snapshots   | User owner context filters account lookup before snapshot access; manual snapshot creation and account deletion lock the account and reuse one session.                                                           |
| Personal income, expense, save    | Server assigns user owner and author; expense participant is the user. Updates read within the transaction; saves lock both accounts in sorted ObjectId order. Deletion and balance compensation commit together. |
| Personal categories and limits    | Explicit user owner context filters reads and mutations, including foreign identifiers. Populated category responses strip new internal metadata.                                                                 |
| Personal reports and revenue      | Transaction aggregation matches the explicit user budget; snapshot reads use personal account IDs. Group authorship and participation never select personal data.                                                 |
| Group settings and operations     | Route group resolves through current membership; all mutations serialize on the group and reauthorize in the same session. Related account, category, participant and limit checks stay in that budget.           |
| Group history and reports         | Expense/income soft deletion is excluded from lists and totals, while historical references continue to prevent destructive account/category deletion. Participant filters use stored attribution.                |
| Wire format                       | Personal services remove ownership, attribution, group opening balance and lock metadata recursively. Group responses retain author/participant fields. JWT supplies the actor; DTOs reject injected ownership.   |

Verification is divided between focused personal service tests and real replica-set group finance HTTP/isolation/permissions/concurrency tests. Deployment starts with an empty production database; development seed data are only for local manual testing.
