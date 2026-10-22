# Disposable database setup and integrity

The spaces contract is a breaking replacement intended for a new disposable database. Old personal/group databases are not supported by this release. There are no compatibility routes, redirects or owner backfills. Startup never resets the database automatically.

1. Configure a new local database using the ordinary environment and secret-file configuration. MongoDB must run as a replica set.
2. Build and start the application; allow its indexes to be created before HTTP traffic.
3. For development fixtures, explicitly run `NODE_ENV=development npm run seed`. Seed clears application collections: use only disposable development data.
4. Run `npm run integrity:audit`. Exit 0 means no known violations, 1 means violations, 2 means the audit failed. The audit is read-only.
5. Run the affected space, monetary, concurrency, lifecycle, authentication and seed suites, then full unit/e2e and build checks before handing off.

The integrity audit checks space parents and cross-space references, account-derived snapshot sides, transaction origins, exact repayment income links, currencies, debt remaining/status and user attribution. Retained history and anonymized users remain valid references. Never repair a broken relationship by guessing its space from an author or amount.

User deletion requires explicit step-up and the existing feature flags. An administrative owner must transfer ownership or delete their active spaces first. Accepted jobs revoke authentication immediately; workers preserve all space finances, including records authored or attributed to the deleted user, and erase personal/authentication data. Use `USER_ID=<object-id> npm run user-deletion:dry-run` for diagnostics and `npm run user-deletion:work` for queued jobs. These commands do not migrate old finances.

No deployment, production reset or shared Postman publication is part of this local change. Completed user deletion is irreversible; archived/soft-deleted space history is retained without a public restore endpoint.
