# Development space fixtures

Use a new disposable development database with MongoDB configured as a replica set. Startup does not reset data. Seed explicitly clears application collections and recreates fixtures:

```sh
NODE_ENV=development npm run seed
```

Seed users use the development password `Test1234!`; never deploy these credentials. Fixtures include an explicit single-member space, shared spaces with different delegated rights, an empty space and deleted-space history. Financial fixtures use spaceId, explicit account currencies, inherited transaction currency and independent authorship/participant references. The single-member space uses the same financial and membership services as shared spaces.

The financial history covers balance/saving accounts, multiple currencies, income/expense, transfers, limits, planned and executed purchases, financial and noncash repayments, cancellation, archive and deletion/RESTRICT cases. Empty spaces have no automatic accounts or categories. The seed prints pending invitation and selected fixture IDs for local checks; do not commit runtime tokens.

Dates derive from a supplied anchor month for deterministic tests and from the run month for manual use. Category-name uniqueness is scoped by spaceId. Run `npm run integrity:audit` after seeding to check space references, snapshot account sides, transaction origins, repayment links and debt consistency without modifying data. Test fixture assertions are the authority for exact fixture counts and names.

No old database conversion or owner maintenance is needed or supported. See [setup and integrity](entity-deletion-rollout.md) and [the financial contract](space-finances-api.md).
