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

- `Семья Тестовых`: the existing `Family` balance account, a second `Family bank` balance account, a `Family reserve` saving account, categories, current-month limit, income, Alex's expense attributed to Maria, Maria's own expense, Elena's historical expense after she leaves, and Alex's USD 1000 transfer from `Family` to `Family reserve` on day 18 of the anchor month.
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
(`?type=saving`) and account details. Stage 05 preserves the original account identifiers and eight income/expense
transactions, and adds one real transfer through the shared transfer service.
Stage 08 adds one execution expense; there are ten transactions and five accounts across the four active groups
(plus the retained account and history of the deleted group). The transfer has
Alex as `createdBy`, no `participantId` or top-level `amount`/`currency`, and
source/destination effects each containing account and snapshot references,
amount 1000 and currency USD. Its description is `Пополнение семейного резерва`;
its effective rate is 1. No artificial income/expense pair is created.

For the anchor month, `GET /api/v1/groups/:familyId/reports/months` with explicit
`fromDate` and `toDate` spanning that month returns one USD bucket:

| Field        |   Amount |
| ------------ | -------: |
| incomes      |   180000 |
| expenses     |  28450.5 |
| balance      | 290549.5 |
| saving       |    51000 |
| transfersIn  |     1000 |
| transfersOut |     1000 |

The original `Family` account becomes USD 270549.5; `balance` adds the second
account's USD 20000 and excludes the reserve. Food expenses are USD 9650.5,
home USD 15600 and leisure USD 3200. Opening amounts and transfers do not count
as income. Alex and Maria see these same totals. Category filters preserve the
transfer movements and full account balances. These values describe the seed
after day 18; a report ending before the transfer retains the earlier balances.
These additions do not require a migration or a reset of existing databases;
the destructive seed command above is only for deliberately rebuilding disposable
local fixtures.

Stage 08 creates two family Plan records through GroupPlansService and shared PlansService: Maria's active home purchase for USD 2000 (target day 10 next month), and Alex's closed food purchase planned for USD 1000, actually USD 1200 on day 12, attributed to Maria. Both spouses read the same plans; only the closed plan has expenseId. The real generated expense retains origin.type=plan and its plan id. Active plans reserve no funds. Food limit total=50000, usage=9650.5 and rest=40349.5. The extra expense reduces Family and aggregate balance by exactly 1200; saving and transfer totals are unchanged. Personal plan fixture amounts/statuses remain unchanged.
