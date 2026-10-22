# Babki API in Postman

The existing `.postman/resources.yaml` workspace binding and environment templates are preserved. These changes are local; no workspace push or publication is required.

`specs/babki.openapi.json` is the interface source of truth, derived from runtime routes and DTOs. The catalog contains only auth/users, health, spaces, invitations and space financial operations. Maintained Git-native YAML adds executable scripts; JSON exports mirror those requests and scripts for manual import. Successful response schemas remain unspecified unless explicitly documented.

`Babki Smoke` reads health/profile and checks missing JWT. `Babki Space Finance` registers a unique user without currency, verifies zero spaces, creates an empty space, creates accounts/categories/income/expense, checks balances and reports, then cancels operations and archives entities. It also checks missing membership, cross-space references and removed routes. It leaves the disposable user and history behind.

Start API with a disposable MongoDB replica-set database. Select Local/Docker or set the appropriate base_url. Smoke needs access_token in a local environment. Finance generates credentials and stores tokens/IDs only in Runner-scoped variables. Set allow_mutations=true only for disposable data. Catalog requests are for individual use; do not run the whole catalog as a workflow. Populate space_id and the requested resource IDs for manual calls.

```sh
npm run postman:lint
npm run postman:smoke
npm run postman:finance
# Equivalent finance command:
postman collection run postman/collections/space-finance -e postman/environments/Local.environment.yaml --env-var allow_mutations=true --bail --no-report-events
```

Do not commit passwords, JWTs, OTPs, invitation tokens or working environment secrets. Use local values or Vault. Existing environment bindings are retained. The historical cloud flows are not an executable authority for the current API; see [flows/README.md](flows/README.md).

Registration creates no finances. Space creation accepts name and optional description, has no type, and creates no financial documents. Financial routes require /spaces/:spaceId and immutable spaceId references. Profile financial defaults and personal financial root routes have been removed. Invitation preview returns name/expiresAt only. Actor/member userId and administrative Space.ownerId remain intentional.

Validate the spec, YAML collections and exports together when changing the API. Static parsing/lint establishes artifact structure; only execution against the current local API establishes workflow behavior. The Postman CLI may require a working local keychain/session even for lint; report that failure separately instead of claiming execution success.
