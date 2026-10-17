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

- `Семья Тестовых`: the existing `Family` balance account, a second `Family bank` balance account, a `Family reserve` saving account, categories, current-month limit, income, Alex's expense attributed to Maria, Maria's own expense and Elena's historical expense after she leaves.
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

Group wallets now have explicit name and USD currency, and group limits use USD. Income/expense currency is inherited from the wallet. Recreating disposable dev fixtures is required for the stage 03 currency contract; no automatic currency mapping of legacy amounts is performed.

Stage 04 adds two family accounts through the same account service: `Family bank`
opens with USD 20000 and `Family reserve` opens with USD 50000. Both open on the
first day two months before the anchor month, matching the original family
account. Alex and Maria can both read the reserve through the account list
(`?type=saving`) and account details. The existing account identifiers and eight
transactions across the active groups are preserved; no artificial transfers or
reserve income/expense pairs are created. There are now five accounts across the
four active groups (plus the retained account of the deleted group).

For the anchor month, `GET /api/v1/groups/:familyId/reports/months` with explicit
`fromDate` and `toDate` spanning that month returns one USD bucket:

| Field        |   Amount |
| ------------ | -------: |
| incomes      |   180000 |
| expenses     |  27250.5 |
| balance      | 292749.5 |
| saving       |    50000 |
| transfersIn  |        0 |
| transfersOut |        0 |

The original `Family` account remains USD 272749.5; `balance` adds the second
account's USD 20000 and excludes the reserve. Food expenses remain USD 8450.5,
home USD 15600 and leisure USD 3200. Opening amounts do not count as income.
These additions do not require a migration or a reset of existing databases;
the destructive seed command above is only for deliberately rebuilding disposable
local fixtures.
