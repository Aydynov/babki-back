# Verification

2026-10-18, local disposable MongoDB replica sets only; no working DB, deployment or external publication.

- Red regression: `npm run test:e2e -- --runInBand test/group-financial-response.e2e-spec.ts` failed at mutationVersion in POST account before the fix (1 suite/1 test, exit1, 4.13s).
- `npm run test -- --runInBand response-fields.util personal-budget.util`: 2 suites/4 tests passed, exit0.
- `npm run test:e2e -- --runInBand test/group-financial-response.e2e-spec.ts test/family-budget-contract.e2e-spec.ts`: 2 suites/2 tests passed, exit0, 8.803s. Family scenario belongs to stage10 and is committed separately.
- `npm run test -- --runInBand`: 59 suites/374 tests passed, exit0, 4.358s. Initial sandbox run could not open local sockets; rerun with loopback permission supplied these results.
- `npm run test:e2e -- --runInBand`: 47 suites/440 tests passed, exit0, 221.413s. Includes focused lifecycle, concurrency, seed, personal compatibility, owner-backfill and integrity suites.
- `npm run build`: exit0.
- Scoped `npx eslint --no-warn-ignored` for changed production/unit/e2e/helper TS files: exit0; Prettier and diff checks run before commit.
- `openspec validate hide-group-financial-internal-fields --strict`: valid, exit0.
- Independent read-only serialization review: no actionable findings.

The common traversal is extracted without changing the personal omission set. HTTP regression covers all financial controllers and nested/compound objects; __v/mutationVersion stay in storage, public identifiers/dates/money/actors stay in responses. Stage10 blocker is resolved; its matrix/docs and final lifecycle remain a separate change.
