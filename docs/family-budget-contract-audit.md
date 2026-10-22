# Spaces contract regression map

This is the current spaces-only contract. The historical roadmap is retained separately and is not integration guidance. No new dependencies, data migration, compatibility routes or owner backfills are introduced. Use a new disposable database and run seed explicitly.

| Retired personal/dual-contract coverage | Preserved space coverage | Scope |
| --- | --- | --- |
| personal-transfer-compatibility | space-transfers and space-transfers-concurrency | Both monetary sides, source funds on effective date, cross-currency amounts/rate, same-space reference checks, compensation once and concurrent updates |
| personal-report-history | space-currency-reports, space-savings-reports | Currency baskets, UTC period boundaries, opening/history, balance/saving split and transfer totals |
| plans-personal-compatibility | space-plans, space-plans-lifecycle, space-plans-concurrency | Planned vs actual amount, exactly one close expense, immutable origin, RESTRICT/archive and transaction rollback |
| debts-personal-compatibility | space-debts, space-debts-lifecycle, space-debts-concurrency | Partial/noncash repayment, currency consistency, linked income, cancellation, remaining/status, overpayment/double-compensation rejection |
| space-finances-compatibility dual contract | space-account-lifecycle, space-currency-transactions, space-currency-limits, space-currency-reports | Account immutability and precision, archives, expense/saving rules, category/limit/reference boundaries and independent currencies |
| budget-core/settings personal branch | budget-core/settings space branch and space domain suites | Shared financial services and category/limit transaction locking under mandatory spaceId |

Removed expectations are deliberate API removals: registration currency/profile defaults, personal report default ranges, manual snapshot writes and snapshot carry adjustments, user/group ownership unions and owner backfills. They are not alternative behaviors supported by this release. Account snapshots remain derived read-only history through their owning space account. Existing account/transaction discriminator values and monetary rules remain.

Onboarding coverage must show register → zero spaces → create empty space or accept invitation, with login/profile usable after the last membership ends. Route coverage checks 404 for removed root financial/group endpoints with valid authentication. Space responses omit financial ownership aliases and internal counters while preserving actor/member userId and administrative ownerId.

Cross-space tests include an actor belonging to both spaces: references must still match the requested space. Membership/permissions are checked against current data with an older JWT. Lifecycle coverage preserves documents and sums after author deletion and logical space deletion; actors anonymize names independently of financial ownership.

Local Postman mirrors the contract in OpenAPI, catalog YAML, runnable space-finance scripts and JSON exports. Static artifact validation is separate from API execution; [the Postman guide](../postman/README.md) describes execution. Unit/e2e/build commands and actual outcomes are reported by the implementation run, rather than inferred from this mapping.
