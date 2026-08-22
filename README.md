# babki-back

`babki-back` is a NestJS + TypeScript REST API for personal-finance data, backed by MongoDB via Mongoose. The codebase exposes versioned, JWT-protected endpoints for accounts, transactions, expense tracking, debt management, spending plans, and monthly/yearly summaries.

## What Is In The Repo

The application currently contains these functional areas:

- `auth`: register, password/TOTP login, recovery codes, JWT guards, `@Public()` and `@CurrentUser()` decorators
- `users`: profile read and update for the authenticated user
- `accounts`: base schema with two discriminators — `balance` and `saving`
- `accounts-snapshots`: one snapshot per account per month, tracks account balance over time
- `transactions`: base schema with three discriminators — `expense`, `income`, `save`
- `expense-categories`: shared category list, user-scoped
- `expense-limits`: per-category spending limits enriched with a `rest` field (limit total minus actual spend)
- `debts`: debt tracking with principal and remaining amounts
- `debt-transactions`: repayment history per debt
- `plans`: spending plans with a target date and amount; `POST /plans/:planId/close` atomically creates an expense transaction and marks the plan closed
- `reports`: monthly and yearly aggregations (`PeriodReport[]`)

Technical cross-cutting behavior:

- global request validation via Nest `ValidationPipe`
- MongoDB ObjectId validation via a custom pipe
- normalized error payloads via a global exception filter
- request logging via a global interceptor
- JWT authentication via a global `JwtAuthGuard` — every endpoint requires a valid token unless decorated with `@Public()`

## Tech Stack

- Node.js
- NestJS
- TypeScript
- MongoDB (must run as a replica set)
- Mongoose
- bcrypt (password hashing)
- passport + passport-jwt (JWT authentication)
- date-fns (date utilities)
- Jest for unit and e2e tests

## Authentication

Every endpoint requires a valid JWT Bearer token except registration and the two login steps.

**Flow:**

1. `POST /auth/register` — create an account with email, password, first/last name, and currency
2. `POST /auth/login` — authenticate and receive `{ accessToken, user }` when 2FA is disabled
3. When 2FA is enabled, the password step instead returns `{ requiresTwoFactor, challengeToken, expiresAt }`; complete it at `POST /auth/login/two-factor` with a TOTP or recovery code
4. Include the resulting token on subsequent requests: `Authorization: Bearer <accessToken>`

The JWT payload carries `{ sub: userId, email, authVersion }`. Protected requests compare `authVersion` with MongoDB so completing enrollment, regenerating recovery codes, or disabling 2FA immediately revokes older tokens. Controllers access the authenticated user via the `@CurrentUser()` decorator — there is no `:userId` route parameter.

### TOTP two-factor authentication

The optional TOTP flow uses RFC 6238 with SHA-1, six digits, a 30-second period, and a server verification window of the previous/current/next time step. TOTP reduces damage from password compromise but is not phishing-resistant.

Authenticated management endpoints:

```text
GET  /auth/two-factor
POST /auth/two-factor/setup
POST /auth/two-factor/setup/confirm
POST /auth/two-factor/disable
POST /auth/two-factor/recovery/regenerate
```

Public login endpoints:

```text
POST /auth/login
POST /auth/login/two-factor
```

`POST /auth/two-factor/setup` requires the current password and returns a temporary Base32 `secret`, `otpauthUri`, and `expiresAt`. The backend never generates a QR image: the frontend renders the QR locally from `otpauthUri`. Confirmation returns ten recovery codes exactly once plus a replacement access token. Store recovery codes offline; only keyed digests are retained by the API.

Disabling accepts the current password plus TOTP or one recovery code. Regeneration accepts only the current password plus TOTP, invalidates the entire old recovery set, and returns ten replacements once.

## Configuration

Every runtime uses exactly two files:

1. `.env` contains non-secret application and deployment settings.
2. One JSON file contains secrets and is selected by `SECRETS_FILE_PATH`.

`SECRETS_FILE_PATH` must be relative to the project root and must not contain
parent-directory traversal. The repository provides environment-specific pairs:

| Environment    | General configuration     | Secret structure                             |
| -------------- | ------------------------- | -------------------------------------------- |
| Direct local   | `.env.example`            | `config/secrets/example.json`                |
| Docker Compose | `.env.docker.example`     | `config/secrets/docker-compose.example.json` |
| Production     | `.env.production.example` | `config/secrets/production.example.json`     |

General settings such as Mongo topology, `JWT_EXPIRES_IN`, rollout flags,
`TRUST_PROXY`, ports, prefixes, and authentication limits belong only in `.env`.
The JSON file may contain only `MONGO_URI` or Mongo credentials, `JWT_SECRET`,
the TOTP/recovery keyrings and active IDs, and `AUTH_THROTTLE_HMAC_KEY`.

`MONGO_DB_NAME` remains required even when the secret file provides a complete
`MONGO_URI`. Missing files, invalid paths, malformed keys, or reused key material
cause startup to fail before the API accepts requests.

If required configuration or key material is missing, malformed, the wrong length, or references an unknown active key, the service fails before accepting requests.

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Create local environment files

Copy the direct-local environment example and generate the one secret file it
references:

```bash
cp .env.example .env
npm run secrets:generate
```

The generator reads `SECRETS_FILE_PATH` from `.env`, writes the file with mode
`0600`, and refuses accidental overwrite. The default local example disables
Mongo authentication. If authentication is enabled, add `MONGO_USER` and
`MONGO_PASSWORD` to the secret JSON; keep host, port, auth source, and replica-set
configuration in `.env`.

### 3. Start MongoDB as a replica set

The application uses multi-document transactions (`session.withTransaction()`), which require MongoDB to run as a **replica set**. The Docker Compose setup handles this automatically. For bare local installs:

```bash
mongod --replSet rs0
```

Then in the Mongo shell (run once on a fresh node):

```bash
rs.initiate()
```

Make sure MongoDB is reachable with the configured host, port, credentials, and database name.

### 4. Seed development data (optional)

```bash
NODE_ENV=development npm run seed
```

Populates the database with:

- test user: `test@test.com` / `Test1234!`
- balance and saving accounts
- expense categories (Food & Dining, Transport, Utilities, Entertainment, Shopping, Health)
- expense limits
- sample transactions from March–June 2026
- sample debts and plans

Only works when `NODE_ENV=development`.

### 5. Start the service

Development mode with file watching:

```bash
npm run start:dev
```

Normal local run:

```bash
npm run start
```

Production build and run:

```bash
npm run build
npm run start:prod
```

With the example `.env`, the API starts at:

```text
http://localhost:5001/api/v1
```

A simple health check is available at:

```text
http://localhost:5001/api/v1
```

Expected response:

```json
{
  "status": "ok",
  "service": "babki-api"
}
```

## API Overview

All routes are exposed under the configured global prefix (`api/v1` by default). All routes require a valid JWT Bearer token unless marked **public**.

### Auth (public)

```
POST /auth/register
POST /auth/login
POST /auth/login/two-factor
```

### Two-factor management (JWT protected)

```
GET  /auth/two-factor
POST /auth/two-factor/setup
POST /auth/two-factor/setup/confirm
POST /auth/two-factor/disable
POST /auth/two-factor/recovery/regenerate
```

### User profile

```
GET   /users/me
PATCH /users/me
```

### Accounts

```
POST   /balances
GET    /balances
POST   /savings
GET    /savings
DELETE /accounts/:accountId
GET    /accounts/:accountId/snapshots
```

### Transactions

```
POST  /expenses
GET   /expenses
GET   /expenses/:expenseId
PATCH /expenses/:expenseId

POST  /incomes
GET   /incomes
GET   /incomes/:incomeId
PATCH /incomes/:incomeId

POST  /saves
GET   /saves
GET   /saves/:saveId
PATCH /saves/:saveId

GET    /transactions
GET    /transactions/:transactionId
DELETE /transactions/:transactionId
```

### Expense categories and limits

```
POST   /expense-categories
GET    /expense-categories
GET    /expense-categories/:categoryId
PATCH  /expense-categories/:categoryId
DELETE /expense-categories/:categoryId

POST   /expense-limits
GET    /expense-limits
GET    /expense-limits/:limitId
PATCH  /expense-limits/:limitId
DELETE /expense-limits/:limitId
```

### Debts

```
POST   /debts
GET    /debts
GET    /debts/:debtId
PATCH  /debts/:debtId
DELETE /debts/:debtId
POST   /debts/:debtId/repayments
GET    /debts/:debtId/transactions
GET    /debts/:debtId/transactions/:debtTransactionId
```

### Plans

```
POST   /plans
GET    /plans
GET    /plans/:planId
PATCH  /plans/:planId
DELETE /plans/:planId
POST   /plans/:planId/close
```

### Reports

```
GET /reports/months
GET /reports/years
```

`/reports/months` and `/reports/years` return `PeriodReport[]` containing period, expenses, incomes, saves, balance, saving, and expensesByCategory. Both accept `categories` as a comma-separated string or a repeated query parameter.

## Architecture Notes

Request flow:

```text
HTTP request → JwtAuthGuard → controller → service → Mongoose model → MongoDB → JSON response
```

Data relationships:

- users are authenticated via JWT; there is no `:userId` route parameter — all data is scoped to the token's subject
- accounts (`balance` / `saving`) are owned by users via Mongoose discriminator pattern
- transactions (`expense` / `income` / `save`) reference `userId`, `accountId`, and `snapshotId`
- each transaction write requires a matching monthly `AccountSnapshot` (snapshot invariant); services call `findOrCreateByAccountId` before creating a transaction, then `recalculateSnapshotsFromDate` to propagate the amount delta forward
- `save` transactions move money between accounts — they debit the source `balance` and credit the `saving`; both snapshot chains are updated atomically in a single session
- expenses reference `categoryId`; plans reference `categoryId` and optionally link a closed expense via `expenseId`
- reports aggregate across all transaction types

Discriminator pattern: both `Account` and `Transaction` use Mongoose discriminators with `discriminatorKey: 'type'`. The base schema is registered first; sub-types are registered as discriminators in each module's `MongooseModule.forFeature` call.

Multi-document atomicity: services that touch more than one collection inject `@InjectConnection()` and wrap writes in `session.withTransaction()`. MongoDB must be running as a replica set for this to work.

Caller-managed sessions: `ExpensesService.create` and `IncomesService.create` accept an optional `ClientSession`. When a session is provided they join the caller's transaction; when omitted they self-manage. Use this pattern when combining expense/income creation with writes to another collection (for example, `PlansService.close`).

Not found in repo:

- background jobs or queues
- caching layer
- external API integrations
- migration tooling

## Docker Workflow

The complete local-upgrade and production-rollout procedure is in [Docker build and deployment](docs/docker-deployment.md).

The repo includes a containerized local stack:

- `Dockerfile`: multi-stage production image for the NestJS API
- `docker-compose.yml`: starts the API together with MongoDB configured as a replica set
- `scripts/generate-secrets.mjs`: creates the ignored secrets file selected by `.env` without printing values
- `config/secrets/docker-compose.example.json`: non-runnable structure example only

### Local Kubernetes

The three-node Docker Desktop deployment uses a MongoDB replica set, NGINX
Gateway Fabric, and default-deny NetworkPolicy. See
[`docs/kubernetes-local-deployment.md`](docs/kubernetes-local-deployment.md).

### Local quick start

Install the Docker-specific version of the same two runtime files, then generate
secrets once:

```bash
cp .env.docker.example .env
npm run secrets:generate
```

Validate, build, and start with new enrollment disabled:

```bash
docker compose config --quiet
docker compose build api
docker compose up -d
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:5001/api/v1
```

The services exposed by default are:

- API: `http://localhost:5001/api/v1`
- MongoDB: `localhost:27017`

The generated `config/secrets/docker-compose.local.json` is ignored by Git, mounted read-only, and has owner-only permissions. The generator refuses accidental overwrite. Do not use `--force` during a routine rebuild because rotating encryption keys without preserving the old keyring can lock enrolled users out.

### Useful Docker commands

Stop the stack:

```bash
docker compose down
```

View container logs:

```bash
docker compose logs -f api
docker compose logs -f mongo
```

Rebuild only the API image after code or dependency changes:

```bash
docker compose build api
docker compose up -d --no-deps --force-recreate api
```

Never add `-v` to `docker compose down` during an upgrade: that deletes the MongoDB volume.

### Notes about the container setup

- MongoDB data is stored in the named Docker volume `mongo_data`.
- MongoDB is started as a single-node replica set inside the container so multi-document transactions work.
- The API container mounts the relative path selected by `SECRETS_FILE_PATH` at the same path under `/app`, read-only.
- Compose derives the API port and healthcheck URL from `PORT` and `API_PREFIX` in the same `.env`.
- The API image runs as the non-root `node` user for better container security.
- `depends_on` with a health check delays API startup until MongoDB is ready to accept connections.
- `TOTP_ENROLLMENT_ENABLED` defaults to `false`; enabling it requires recreating the API container but not rebuilding the image.

## Testing

Run unit tests:

```bash
npm run test
```

Run unit tests in watch mode:

```bash
npm run test:watch
```

Run test coverage:

```bash
npm run test:cov
```

Run end-to-end tests:

```bash
npm run test:e2e
```

Run Jest in debug mode:

```bash
npm run test:debug
```

## Developer Workflow

Format source and test files:

```bash
npm run format
```

Run ESLint with autofix:

```bash
npm run lint
```

Useful startup/debug scripts from `package.json`:

- `npm run start:debug`: starts Nest in debug + watch mode
- `npm run build`: compiles the application into `dist/`

## Secrets And Local Safety

Recommended local workflow:

1. Keep non-secret settings in `.env` and real secrets in its selected JSON file.
2. Commit only `.env*.example` and `config/secrets/*.example.json` templates.
3. Keep `SECRETS_FILE_PATH` relative to the project root.
4. Prefer `MONGO_URI` when you already have a managed Mongo connection string.

Notes:

- All `.env*.example` and `config/secrets/*.example.json` files are templates, not production credentials.
- The repo does not include secret-management tooling, vault integration, or environment-specific deployment manifests.
- Back up the complete TOTP encryption keyring separately from MongoDB. Losing an encryption key locks affected users out.
- For encryption-key rotation, deploy the new key to every instance, switch the active key ID, and retain old keys until no envelope references them. Encryption rotates lazily after successful verification.
- For recovery-HMAC rotation, retain old keys until every code under that key is consumed or regenerated; digests cannot be migrated without plaintext.
- Run the API only behind TLS, keep server clocks NTP-synchronized, and never widen the TOTP verification window to compensate for clock drift.
- Trust forwarded IP headers only through an explicit `TRUST_PROXY` policy matching known proxies. The default is `false`.
- Default rolling limits are 15 minutes: 5 password failures per normalized email, 50 per trusted IP, 5 failures per challenge, and a 15-minute account block after 10 second-factor failures. Limits are runtime-configurable through the `AUTH_*` variables in `.env.example`.
- Deploy first with `TOTP_ENROLLMENT_ENABLED=false`. After every instance enforces the two-step login and JWT version checks, enable enrollment. Once any factor is enabled, do not roll back to password-only binaries; forward-fix or stop authentication traffic instead.

## Troubleshooting

If the service fails during startup, check these first:

- MongoDB is running as a replica set and is reachable
- `MONGO_DB_NAME` is set in `.env`
- `SECRETS_FILE_PATH` is relative, stays inside the project, and points to an existing JSON file
- your Mongo auth settings match the actual database configuration
- `JWT_SECRET` is set in the secrets file (required in production)
- all three independent 32-byte Base64 key values and both active key IDs are configured
- server time is synchronized and `TRUST_PROXY` matches the real ingress topology

If requests fail validation, the app is likely rejecting unknown fields, invalid ObjectIds, or invalid DTO values through the global validation pipe.

**401 Unauthorized on any endpoint:** include `Authorization: Bearer <access_token>` in the request header. Obtain a token from `POST /auth/login`.

**MongoServerError: Transaction numbers are only allowed on a replica set member:** MongoDB must be running as a replica set. See "Getting Started → Start MongoDB as a replica set". Using `docker compose up` handles this automatically.
