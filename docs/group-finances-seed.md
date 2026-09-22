# Development seed for group finances

Seed is intended only for an empty local development database. The command clears application collections before creating fixtures:

```bash
NODE_ENV=development npm run seed
```

All users have password `Test1234!`:

| Email                | Main scenarios                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `test@test.com`      | Personal budget, family owner, member of two organizations, empty budget owner                     |
| `maria@test.com`     | Family member with all three delegated settings permissions                                        |
| `ivan@test.com`      | Family member with `manageLimits`, owner of North Studio                                           |
| `elena@test.com`     | Former family member with historical expense, owner of South Agency                                |
| `delete-me@test.com` | No group ownership; one deletable account and one archived account for account/user deletion tests |

The seed creates:

- `Семья Тестовых`: wallet, categories, current-month limit, income, Alex's expense attributed to Maria, Maria's own expense and Elena's historical expense after she leaves.
- `North Studio`: its own wallet, category, income and an expense authored by Alex; Alex has only `manageCategories`.
- `South Agency`: its own wallet, category, income and an expense authored by Alex; Alex has no delegated settings permissions, while Ivan has `manageAccounts` and `manageLimits`.
- `Пустой бюджет`: no wallet or financial settings, plus a pending invitation. Its token is printed by the seed command.
- `Deletion test: deleted group`: soft-deleted organization with retained wallet and transactions, two memberships ended with `group_deleted`, and a pending invitation revoked with the same reason.

Entity deletion scenarios in Alex's personal budget:

- `Deletion test: unused` is an unreferenced category that can be physically deleted; `Deletion test: archived` is hidden from ordinary category lists.
- `Deletion test: soft-deleted income` remains in storage with `deletedAt` and is excluded from ordinary transaction reads and totals.
- The debt named `Deletion test: unused debt` has no financial history and can be physically deleted. Maria's fully repaid debt is archived and retains its repayment history.
- Active plans without expenses can be physically deleted. `Birthday dinner` is closed and archived while retaining its origin expense.
- Alex's normal accounts and categories have financial dependencies and exercise `RESTRICT`. The dedicated deletion candidate has one empty active account and one archived account; their identifiers are printed by the seed command.

The seed does not create a `deletion_pending` user or a user-deletion job. This
keeps every seeded login usable until a deletion request is submitted explicitly.

Dates are derived from the seed run month, so current reports and limits remain useful for manual checks. Group and personal records share category names safely because uniqueness is scoped by budget owner.
