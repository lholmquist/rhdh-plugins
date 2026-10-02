# Secure token storage: administrator grant management plan

Status: proposed; no implementation started  
Target: `workspaces/secure-token-storage` in this repository  
Related plan: [Authentication Providers integration](./rhidp-1661-authentication-providers-integration-plan.md)

## Goal and boundary

Give authorized RHDH administrators a separate screen to find grants approved by
other users and revoke a specific grant when access must end. The first release
is an operational and security control, not a way for an administrator to grant
consent on a user's behalf.

An administrator may see grant metadata: owner user entity ref, opaque grant ID,
provider, approved scopes, caller subject, optional workflow instance ID,
creation/expiry/revocation times, and a derived lifecycle status. The screen
and its API must never return provider access tokens, refresh tokens, encrypted
token fields, OAuth authorization codes, or connection secrets.

Keep the existing user-facing **Settings > Authentication Providers** workflow
section for connecting providers, approving consent, viewing one's own grants,
refreshing one's own grant, and disconnecting. The admin screen is separate;
it must not alter login, logout, ordinary provider sessions, or the
Orchestrator/SonataFlow `grantId` forwarding and `/token` exchange.

### First-release operations

| Operation                                                        | Included? | Reason                                                                               |
| ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| List/search/filter grants across users                           | Yes       | Investigation and incident response.                                                 |
| Revoke one grant                                                 | Yes       | End a specific workflow's access.                                                    |
| Show a grant's token value or call `/token` for an admin         | No        | A grant ID is not a credential for an administrator.                                 |
| Approve/create, refresh/extend, or transfer another user's grant | No        | These would change the user's consent and need a separate product/security decision. |
| Disconnect another user's provider connection or bulk revoke     | No        | Larger blast radius; consider only after single-grant revocation is proven.          |

## Existing implementation to preserve

- [`router.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/router.ts) obtains the signed-in user from Backstage credentials for `GET /grants` and the owner-only grant actions. `POST /token` is a separate service-principal exchange.
- [`service.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/service.ts) rejects a revoke when the grant's owner does not match the caller and records grant audit events.
- [`repository.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/database/repository.ts) already stores owner, provider, caller subject, scopes, expiry, and revocation time. Its current list query is intentionally owner-filtered; it is not an admin query.
- The [sample app config](../workspaces/secure-token-storage/app-config.yaml) enables secure token storage but has no permission backend or RBAC policy configured. Do not treat its current authorization defaults as proof of admin isolation.

The grant row contains metadata only. Provider tokens live in a different
connections table. An admin query should project named grant columns rather
than reuse connection reads or `SELECT *` joins.

## Authorization and opt-in

1. Add `secureTokenStorage.admin.enabled`, default `false`. When false, do not
   register admin routes or display the admin page/navigation entry. Leave all
   existing user and workflow routes unchanged.
2. Require a non-empty, explicit `secureTokenStorage.admin.allowedUserEntityRefs`
   list when enabled. This is a fail-closed deployment gate for the first
   release, especially in installations whose permission policy allows all
   actions by default. Match normalized Backstage user entity refs exactly;
   never trust an owner or actor ref supplied in the request body.
3. Define two basic permissions in the shared secure-token-storage package:
   `secure-token-storage.grants.read` and
   `secure-token-storage.grants.revoke`. Register them with the backend
   permission registry. For every admin request, require an authenticated
   **user** principal, allowlist membership, and a successful permission
   authorization using that principal's credentials. A service token, even the
   `sonataflow` subject, is not an admin identity. Return 403 for a denied
   authenticated user and never query grant data before the checks succeed.
4. Configure a dedicated RHDH RBAC role/policy that grants only the intended
   permissions to the intended operators. Do not assume the built-in RBAC
   policy administrator automatically receives plugin-specific grant rights.
   Register the plugin's permissions in the deployment's RBAC configuration
   so they can be assigned. The frontend permission check may hide controls,
   but the backend check is authoritative.
5. Before enabling this in a deployment, verify that its permission backend
   actually denies a user outside the role. The sample must include a
   restrictive test policy; the allowlist alone does not demonstrate separate
   read and revoke roles.

This follows Backstage's [basic permission check](https://backstage.io/docs/permissions/plugin-authors/02-adding-a-basic-permission-check/)
and [permission registry](https://backstage.io/docs/backend-system/core-services/permissions-registry/)
patterns. RHDH documents custom role policies and plugin permission discovery
in its [authorization guide](https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.10/html/authorization_in_red_hat_developer_hub/manage-authorizations-by-using-external-files_authorization-in-rhdh).

## Backend interface and data path

Add backend-internal `AdminGrantManagement` operations for the admin router to
call. Keep the cross-user interface inside the secure-token-storage backend
plugin, rather than adding unrestricted cross-user methods to the root-scoped
`SecureTokenStorageService` consumed by other backend plugins. The admin router
does authentication and permission checks; `AdminGrantManagement` owns bounded
queries, safe projection, revocation, and audit. It can use the plugin-scoped
database client for the same `secure-token-storage` database; coordinate
migration/initialization with the existing root service factory. Do not duplicate
token handling or change the existing owner-facing service methods.

Proposed HTTP interface under `/api/secure-token-storage`:

| Route                                                               | Required permission | Behavior                                                             |
| ------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `GET /admin/grants?userEntityRef=&provider=&status=&limit=&cursor=` | `grants.read`       | Return safe summaries and `nextCursor`.                              |
| `POST /admin/grants/:grantId/revoke` with `{ "reason": "..." }`     | `grants.revoke`     | Revoke one grant; return 204 on success or an already-revoked grant. |

`GET` defaults to 25 rows and caps at 100. Use a stable keyset cursor ordered
by `(created_at DESC, id DESC)`; validate the cursor and filter values before
querying. Owner filtering is by exact normalized entity ref; provider and
status values are validated. The response includes the owner because an admin
cannot infer it from their own identity. Derive status as `revoked` first,
otherwise `expired` when `expiresAt <= now`, otherwise `active`. This describes
the grant lifecycle, not a guarantee that the underlying provider connection
is currently usable. Add indexes for the actual admin sort/filter patterns
after measuring representative queries; do not alter the owner-scoped query.

For revoke, look up the grant by ID only **after** authorization, then update
only if `revoked_at IS NULL`. Require a short, bounded non-empty reason and a
confirmation in the UI. Return 404 for a missing ID; an already-revoked ID is
idempotent and must not create a second revocation event. A subsequent
SonataFlow `/token` exchange for the grant must be denied by the existing
revocation check. Do not make a provider OAuth revoke call as part of this
single-grant action; the user's provider connection and other grants remain.

Record an audit event containing actor user ref, target owner ref, grant ID,
provider, caller subject, timestamp, and reason (never tokens). Distinguish an
admin revocation from the existing `user-revoked` reason, either with a new
event type or a typed `admin-revoked` reason. The grant update and its success
audit must commit atomically in one transaction; the current owner-revoke path
does its update and audit insert separately, so the admin path needs a new
repository operation. Log denied admin attempts without leaking other users'
grant details. Decide retention and access to audit records before production
rollout.

## Frontend experience

Add a separate New Frontend System page, for example
`/admin/secure-token-storage/grants`, within the existing frontend plugin.
Provide a nav entry only when the feature is configured and the viewer has
`grants.read`. If frontend configuration cannot reliably expose the flag, let
the page query a safe capability/status endpoint; never use a frontend flag as
the authorization check. A direct URL must still receive backend 403/404 when
access is not allowed.

The page should show owner, provider, grant ID (copyable), scopes, caller,
created/expiry/revocation times, and a clear active/expired/revoked badge.
Support exact-owner search, provider/status filters, pagination, loading and
empty states, and an actionable access-denied message. Show Revoke only with
`grants.revoke`; confirm the selected grant and owner, collect a reason, and
refresh the row after success. Avoid token-looking values in browser telemetry.

## Delivery slices and verification

1. **Security prerequisite:** register permissions, decide the RBAC role and
   fail-closed allowlist config, and make the sample app capable of exercising
   a real deny decision. Prove that feature-off, non-admin, and service-principal
   requests cannot reach an all-user query.
2. **Safe read path:** add bounded repository query, admin summaries, route,
   filters/cursor, and tests for cross-user visibility only after read
   authorization. Confirm no token material appears in JSON or logs.
3. **Revoke and audit:** add atomic admin revoke, reason validation, audit actor
   attribution, idempotency, and tests that an exchanged revoked grant fails
   while other grants on the same connection still work.
4. **Admin page:** wire the NFS page and permission-aware navigation, with
   search, pagination, status, and revoke confirmation. Keep Settings behavior
   unchanged.
5. **Sample and release readiness:** add a second sample catalog user and
   restrictive local RBAC policy, update the local testing guide and dynamic
   plugin wiring, and exercise UI/API tests using user A, user B, read-only
   admin, revoke admin, non-admin, and service principal. Test active, expired,
   revoked, missing, and concurrent-revoke cases on the supported databases.

Release acceptance is: a permitted administrator can locate and revoke another
user's grant without obtaining a provider token; an unpermitted principal
cannot enumerate or revoke grants; the owner-facing connection and grant flow
still works; revocation is auditable and blocks later workflow token exchange;
and the admin feature stays absent unless explicitly enabled.

## Decisions to settle before implementation

- Is a user notification required when an admin revokes their grant? Recommended
  for production, but it needs an agreed channel and failure behavior; it need
  not block the first operational slice.
- What audit retention and export requirements apply to grant metadata and
  administrator actions? Do not expose raw audit records through this first
  screen until that policy is set.
- Should later phases support bulk revoke or provider-wide disconnect? Treat
  these as separate, higher-blast-radius permissions and UX decisions, not an
  extension of the single-grant button by default.
