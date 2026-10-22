# Spaces and invitations

All routes require JWT and the configured prefix (`/api/v1` by default). Registration accepts firstName, lastName, email and password, creates only the user and permits zero memberships. Profiles expose no financial defaults. Create a space or accept an invitation to start using finances. Spaces have name, optional description and administrative ownerId; there is no space type. Creation makes the caller owner and creates no financial documents.

| Method and path | Behavior |
| --- | --- |
| POST /spaces | `{name,description?}` → 201 space |
| GET /spaces | Current memberships → `{items,total,page,limit}` |
| GET/PATCH/DELETE /spaces/:spaceId | Read, owner rename/description update, owner logical deletion |
| GET /spaces/:spaceId/members | Current members, paginated |
| PATCH /spaces/:spaceId/members/:userId/permissions | Owner sets delegated rights |
| POST /spaces/:spaceId/ownership | `{userId}` transfers ownership to an active member |
| POST /spaces/:spaceId/leave | Member leaves; owner first transfers ownership |
| DELETE /spaces/:spaceId/members/:userId | Owner removes a member |
| POST/GET /spaces/:spaceId/invitations | Owner creates/lists invitations |
| DELETE /spaces/:spaceId/invitations/:invitationId | Owner revokes invitation |
| POST /space-invitations/preview | `{token}` → `{name,expiresAt}` only |
| POST /space-invitations/accept | `{token}` → `{spaceId,role}` |

Space DTOs use id, name, optional description, ownerId, role, permissions, createdAt and updatedAt. Administrative lists use items/total/page/limit (default page 1, limit 20, maximum 100). Spaces/invitations sort createdAt then id ascending; members sort joinedAt then id. Member userId and ownerId identify people and are retained deliberately.

Every current member sees all space finances. The owner has all four financial permissions: manageAccounts, manageCategories, manageLimits, manageTransactions. Delegation retains the existing per-domain rules. Current membership and rights are checked on every write, including requests with an older JWT. Missing, deleted or nonmember spaces return 404; insufficient rights return 403. Owners cannot leave or be removed; self-transfer returns 409. Leaving the last space does not disable login/profile.

Invitations are bearer secrets, stored only as digests and returned only on creation as `{id,token,expiresAt}`. Send tokens exclusively in JSON bodies; client links may put the token in a fragment. Links expire after seven days. Preview requires authentication but no membership, returns Cache-Control: no-store, and does not consume or reserve the link. Accept rechecks state. Invalid, expired, consumed, revoked or deleted-space tokens return the same 400 Invalid invitation; a current member gets 409 without consumption. Preview exposes no IDs, members, permissions, description or finances.

Preview and accept share the existing per-user limit of ten requests per fixed minute, including invalid bodies. Exceeding it returns 429 with Retry-After; storage failures return 503. Tokens and digests are excluded from responses other than creation and from application logs. Queries are rejected and redacted from request/error paths for these routes.

Space deletion ends memberships and revokes pending invitations while retaining financial/history records. Public archive reads and restoration are unavailable. User deletion requires transfer or deletion of owned active spaces and preserves all financial history with anonymized actors. See [entity-deletion-api.md](entity-deletion-api.md).

The [financial API](space-finances-api.md) is available only under /spaces/:spaceId. Root financial routes and old group routes have been removed without aliases or redirects. MongoDB replica-set transactions are required for membership, invitation and financial mutation coordination. Use a new disposable database as described in [setup notes](entity-deletion-rollout.md).
