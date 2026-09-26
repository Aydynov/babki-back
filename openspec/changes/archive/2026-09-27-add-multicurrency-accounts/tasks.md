## 1. Currency foundation and profile settings

- [x] 1.1 Add a centralized supported ISO 4217 currency catalog and money normalization/precision utilities with focused unit tests.
- [x] 1.2 Add required `defaultCurrency` and nullable `defaultAccountId` profile fields, wire registration currency through persistence/serialization, and update schema tests.
- [x] 1.3 Extend profile update behavior to validate or clear the default account atomically, including ownership, active-state, type and currency tests.

## 2. Unified personal accounts

- [x] 2.1 Replace the one-account-per-type index and schemas with named, currency-denominated personal accounts while preserving group account behavior and indexes.
- [x] 2.2 Replace personal balance/saving controllers and DTOs with unified account create/list/get/rename/archive/delete contracts and currency-aware validation.
- [x] 2.3 Implement atomic first-default-account selection and default-account clearing during archive/delete lifecycle operations.
- [x] 2.4 Add service and HTTP tests for multiple same-type accounts, mixed currencies, immutable fields, foreign/archived access and default-account transitions.

## 3. Currency-aware income and expense operations

- [x] 3.1 Refactor the transaction base/discriminators so income and expense own their monetary account/snapshot/amount fields and every personal operation snapshots account currency.
- [x] 3.2 Require personal income and expense `accountId`, resolve and lock the active personal account in-session, and remove implicit balance lookup.
- [x] 3.3 Apply centralized currency precision validation to account initial amounts, incomes, expenses and snapshot arithmetic.
- [x] 3.4 Update transaction queries, indexes, serialization and tests for explicit account targeting without changing group transaction contracts.

## 4. Atomic account transfers

- [x] 4.1 Replace the `save` discriminator/module/routes with a transfer schema containing source and destination effects plus indexes for both account sides.
- [x] 4.2 Implement transfer creation with sorted two-account locking, same-owner/active-account validation, same-currency equality, source-funds checks and atomic snapshot updates.
- [x] 4.3 Implement transfer read/list/revenue representation with derived directed effective rate and currency-aware account filters.
- [x] 4.4 Implement amount/description updates and idempotent soft deletion with atomic compensation of both snapshot chains.
- [x] 4.5 Add unit and replica-set concurrency tests for same-currency, cross-currency, backdated, insufficient-funds, update, rollback and competing-delete scenarios.

## 5. Currency-scoped financial features

- [x] 5.1 Add immutable currency to personal expense limits and scope overlap, usage and remaining calculations by category plus currency.
- [x] 5.2 Add immutable currency to plans, require an explicit matching account on close, and test atomic expense creation and mismatch rejection.
- [x] 5.3 Add immutable currency to debts and repayments, require an explicit matching account for generated income, and test atomic mismatch handling.
- [x] 5.4 Update DTOs, filters, indexes and focused lifecycle tests for currency-aware limits, plans and debts.

## 6. Multicurrency reporting

- [x] 6.1 Define and implement the personal report response DTO with separate currency buckets for balances, savings, incomes, expenses and transfer movements.
- [x] 6.2 Update monthly/yearly aggregation pipelines to group by stored currency, keep transfers out of income/expense totals and preserve category breakdowns per currency.
- [x] 6.3 Add report service and e2e tests proving RUB/USD isolation, backdated transfer effects and absence of implicit conversion.

## 7. Integrity, lifecycle and documentation

- [x] 7.1 Extend account dependency checks and deletion policies to detect both transfer effects, preserve deleted transfer history and clear default-account references atomically.
- [x] 7.2 Update integrity relation definitions and audit tests for transfer source/destination accounts and snapshots plus new profile/account references.
- [x] 7.3 Update README and API documentation for profile currency, unified accounts, explicit operation accounts, transfers and multicurrency report shapes.

## 8. Development scenarios and verification

- [x] 8.1 Rework personal seeds to create RUB-default users, RUB/USD balance and saving accounts, operations in both currencies and same-/cross-currency transfers including a backdated transfer.
- [x] 8.2 Extend seeds with currency-scoped limits, plans, debts, archived accounts and deletion candidates while keeping group seed behavior unchanged.
- [x] 8.3 Update seed and schema-index tests and verify deterministic seed output against a clean replica-set database.
- [x] 8.4 Run focused module tests, group finance regression tests, the complete unit/e2e suites, `npm run build`, and strict OpenSpec validation; record exact results.

### Verification (2026-09-23)

- `npm test -- --runInBand`: 49 suites, 275 tests passed.
- `npm run test:e2e -- --runInBand`: 17 suites, 118 tests passed.
- `npm run test:e2e -- --runInBand test/multicurrency.e2e-spec.ts`: 1 suite, 3 tests passed after final report normalization.
- `npm run build`: passed.
- `openspec validate add-multicurrency-accounts --strict`: valid.
- `npx eslint` on the modified core modules and new multicurrency e2e test: passed. Repository-wide lint still reports pre-existing issues in unrelated lifecycle migration and legacy e2e files.
