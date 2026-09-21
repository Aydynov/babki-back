# Development seed for group finances

Seed is intended only for an empty local development database. The command clears application collections before creating fixtures:

```bash
NODE_ENV=development npm run seed
```

All users have password `Test1234!`:

| Email | Main scenarios |
| --- | --- |
| `test@test.com` | Personal budget, family owner, member of two organizations, empty budget owner |
| `maria@test.com` | Family member with all three delegated settings permissions |
| `ivan@test.com` | Family member with `manageLimits`, owner of North Studio |
| `elena@test.com` | Former family member with historical expense, owner of South Agency |

The seed creates:

- `Семья Тестовых`: wallet, categories, current-month limit, income, Alex's expense attributed to Maria, Maria's own expense and Elena's historical expense after she leaves.
- `North Studio`: its own wallet, category, income and an expense authored by Alex; Alex has only `manageCategories`.
- `South Agency`: its own wallet, category, income and an expense authored by Alex; Alex has no delegated settings permissions, while Ivan has `manageAccounts` and `manageLimits`.
- `Пустой бюджет`: no wallet or financial settings, plus a pending invitation. Its token is printed by the seed command.

Dates are derived from the seed run month, so current reports and limits remain useful for manual checks. Group and personal records share category names safely because uniqueness is scoped by budget owner.
