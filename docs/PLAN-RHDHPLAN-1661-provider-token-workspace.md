# RHDHPLAN-1661: new provider-token plugin workspace plan

Status: implementation in progress (Slice 6 next)  
Prepared: 2026-10-02  
Repository: rhdh-plugins  
New workspace: workspaces/provider-token  
Feature: [RHDHPLAN-1661 — Secure short-lived user tokens for queued and long-running Orchestrator workflows](https://issues.redhat.com/browse/RHDHPLAN-1661)  
Source plan: [PLAN-RHIDP-1661.md](./PLAN-RHIDP-1661.md)

## Decision

Implement the provider-token design as a new plugin in a new workspace,
workspaces/provider-token, within this repository. The existing
workspaces/secure-token-storage stays in place as an independent implementation
and reference. The new workspace gets its own packages, database namespace,
sample app, configuration, and lockfile.

The source plan proposes a separate repository. The user's later placement
decision keeps the work in this monorepo while preserving the plugin and package
isolation described by that plan. The source plan remains unchanged as design
history.

## Implementation progress

- Slice 0 is complete: the independent workspace installs, type-checks, builds,
  and its sample frontend/backend start with the feature disabled and without
  provider secrets.
- Slice 1 is complete: shared types, permissions, encryption, and persistence
  are implemented and covered by crypto and SQLite repository tests.
- Slice 2 is complete: the adapter extension point, GitHub and Microsoft
  adapters, and in-memory refresh service are implemented. Adapter and refresh
  coordination tests, full workspace build, API reports, formatting, and a
  feature-disabled backend startup have passed.
- Slice 3 is complete: owner-scoped grant listing/revocation, permission-checked
  service-only token issuance, configured client/caller binding, provider and
  grant lifecycle/scope validation, and the discovery/AuthService node client
  are implemented. SQLite-backed policy tests, route-handler authorization
  tests, node-client tests, package builds, lint, type-checking, and API reports
  pass.
- Slice 4 is complete: PKCE connect sessions, hashed one-use state, encrypted
  verifier and pending refresh credentials, allow-listed post-OAuth redirects,
  owner-scoped consent decisions, atomic provider-secret/grant persistence,
  disconnect and local grant revocation, best-effort GitHub upstream revoke,
  and periodic expired-session cleanup are implemented. The access token from
  the OAuth callback is never persisted. SQLite lifecycle and rollback tests,
  route auth/permission/redaction tests, and provider revocation tests cover the
  lifecycle. Workspace type-checking, formatting, lint, API reports, builds,
  and affected package tests pass.
- Slice 5 is complete: the new frontend plugin and sample app provide a
  standalone provider page for configured connect options, PKCE redirect,
  callback consent, owner grant/connection listing, revoke, and disconnect.
  The browser client projects only safe response fields and the UI never
  renders token values. Page interaction tests cover connect, approval,
  rejection, revoke, disconnect, empty/error states, and token non-disclosure.

The Jira key in the source document is also stale: RHIDP-1661 is an EKS
documentation sub-task. The provider-token feature is RHDHPLAN-1661.

## Scope and coexistence

The new plugin is a parallel prototype until its behavior and security review
are accepted. It does not import secure-token-storage's tables, encryption
keys, service reference, or frontend module.

- Use plugin ID provider-token and a separate provider-token database.
- Store no provider credentials in SonataFlow state. The workflow carries the
  approved opaque grantId and obtains an access token at execution time.
- Keep RHDH sign-in independent from provider connection. Logging out never
  revokes the provider-token grant.
- Keep the current Orchestrator input/header compatibility for grantId.
  Resolve a grant for the signed-in workflow owner and provider when the caller
  omits grantId, then exchange it at execution time.
- For this prototype, grantId is the reference sent by the workflow. The
  separate per-run delegation record from the source plan is deferred, following
  the earlier product direction to retain the grantId exchange flow. Revisit
  this only if the security review requires a narrower, per-run capability.
- Do not migrate or copy existing secure-token-storage connections or grants.
  A user connecting to provider-token must complete that plugin's own OAuth
  consent flow.
- Run the new workspace's sample app independently. The current
  secure-token-storage and provider-token plugins share a singleton
  Authentication Providers settings input and a single Orchestrator grant
  resolver slot, so only one implementation should be active in a sample host.
  A later consumer cutover or composed Settings extension is a separate slice.

## Package and workspace layout

Follow the standalone workspace conventions used by this repository and the
current secure-token-storage workspace: root package.json, backstage.json,
tsconfig.json, yarn.lock, sample app and backend, plugin packages, catalog
metadata, examples, and workspace documentation.

Proposed package set:

| Package                                 | Responsibility                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| provider-token-common                   | Shared grant, provider, permission, configuration, and error types.                       |
| provider-token-node                     | Consumer-facing contract and client used by Orchestrator or other trusted backends.       |
| provider-token-backend                  | HTTP routes, grant policy, encrypted storage, refresh coordination, audit, and lifecycle. |
| provider-token-backend-module-github    | GitHub OAuth authorize, code exchange, refresh, and optional upstream revoke.             |
| provider-token-backend-module-microsoft | Microsoft OAuth authorize, code exchange, refresh, and tenant/audience handling.          |
| provider-token                          | One user-facing connect, consent, grant list, and revoke page for the prototype.          |
| packages/app and packages/backend       | Isolated Backstage test host that loads the new frontend and backend features.            |

Use scoped package names consistent with this repository, for example
@red-hat-developer-hub/backstage-plugin-provider-token-backend. Keep the provider
modules optional, and fail closed when a provider is configured without its
module. Start with a standalone provider-token page in the sample app; do not
register a second providerSettings singleton while secure-token-storage is
still installed.

## Trust and data model

Keep the storage plugin provider-neutral. Provider modules handle only the
OAuth dialect; provider-token owns consent, grant enforcement, token refresh,
locking, persistence, and audit.

- User routes require a verified user principal and derive the owner from that
  principal. Ignore or reject a userEntityRef supplied by a service caller.
- Access-token issue routes require a verified service principal. The caller
  subject must be allowed by the configured client and must match the caller
  bound to the approved grant.
- Call permissions.authorize for the issue, grant read, and grant revoke
  permissions. A deny or conditional result fails closed. Keep principal,
  configured client, grant-owner, provider, scope, expiry, and revoke checks
  even if permission authorization allows the request.
- A grant binds the consenting user, client, provider, scopes, expiry, and
  revocation state. The opaque grantId is returned to the workflow caller and
  is not a substitute for service authentication.
- Persist refresh material encrypted with AES-256-GCM using versioned keys and
  additional authenticated data bound to the user and provider. Keep access
  tokens in process memory only, with a short expiry-aware cache. Never log or
  serialize access tokens, refresh tokens, authorization codes, PKCE verifiers,
  encryption keys, or Authorization headers.
- Store PKCE verifiers encrypted and OAuth state as a hash. Connect sessions
  expire, are single-use, and validate the return URL against an allow-list.
- A rotating refresh token must be committed before the newly issued access
  token is returned. Provider invalid_grant revokes local access and produces
  an actionable, non-retryable error. There is no automatic retry loop.
- Local revoke always blocks future exchanges. Provider-side revoke is
  best-effort where the provider supports it; failure does not restore the
  local grant.

The source plan includes a separate hash-only delegation table. This prototype
uses grantId for the workflow reference under the existing product direction.
The security review must explicitly confirm that service authentication,
caller binding, and an unguessable grantId provide the intended protection
without a per-run delegation record.

## External interfaces

Keep the external contract small and independent of provider-specific OAuth
details.

| Operation                        | Caller                       | Result                                                                                                                        |
| -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Start provider connection        | User                         | Provider authorization URL and short-lived session reference.                                                                 |
| Read and decide consent          | User who started the session | Provider, client name, scopes, offline-use explanation; approve or deny.                                                      |
| Complete OAuth callback          | Provider redirect            | Store refresh material, complete one-use session, return to the consent experience.                                           |
| List and revoke grants           | Owner user                   | Own provider/client grants and lifecycle metadata; no token fields.                                                           |
| Issue access token               | Configured service principal | Accept grantId and optional non-authorizing workflow context; return short-lived token, expiry, scopes, and safe error codes. |
| Resolve a grant for Orchestrator | Backend client               | Find the owner's active grant for a provider when grantId is absent.                                                          |

Use the versioned route family from the source design under the new plugin ID.
Validate all route inputs, including provider and client identifiers, scope
arrays, grant IDs, context length, and return URL. The node package is the
consumer seam; consumers should not duplicate route construction or OAuth
policy.

## Implementation slices

### Slice 0 — Workspace skeleton and architecture baseline

- Create workspaces/provider-token with its own workspace manifest, Backstage
  version declaration, TypeScript config, lockfile, packages, catalog metadata,
  and sample app/backend.
- Add package manifests for the common, node, backend, GitHub module, Microsoft
  module, and frontend packages.
- Load only provider-token features in the sample backend and app. Keep the
  current secure-token-storage test host and configuration untouched.
- Record the current product decisions: same monorepo, new workspace, grantId
  workflow reference, independent login and provider consent, and no automatic
  data migration.

**Exit:** the new workspace installs, type-checks, starts its sample app, and
does not require provider secrets while disabled.

### Slice 1 — Shared types, permissions, encryption, and persistence

- Define shared types and stable error codes in provider-token-common.
- Define and register issue, grant-read, and grant-revoke permissions.
- Implement key-versioned AES-256-GCM encryption and validation.
- Add plugin-owned tables for secrets, grants, and connect sessions, plus
  indexes and cleanup queries.
- Keep schema operations portable between SQLite and PostgreSQL. Specify the
  PostgreSQL row-lock behavior separately.

**Exit:** migration and storage behavior work in the isolated sample database;
encryption, key rotation, integrity failure, and safe metadata projection have
a clear test surface.

### Slice 2 — Provider extension and refresh engine

- Define a small provider adapter interface in provider-token-node.
- Register adapters through a backend extension point. Reject duplicate IDs
  and missing configured adapters at startup or connect time.
- Implement GitHub OAuth App and Microsoft identity platform adapters,
  including PKCE, offline_access, token/scope/expiry parsing, and refresh-token
  rotation behavior.
- Add refresh coordination: a database row lock across refresh for PostgreSQL
  and in-process single-flight for the SQLite sample.
- Commit new refresh material before returning access tokens. Classify
  invalid_grant separately from temporary provider/network failures.
- Cache short-lived access tokens in memory only and invalidate the cache on
  revoke.

**Exit:** overlapping refresh requests do not reuse rotated refresh tokens;
provider rejection is non-retryable and temporary failures are retryable without
looping; the access-token cache is memory-only; automated tests cover both
provider adapters, SQLite single-flight, and persist-before-return rotation.

### Slice 3 — Grant policy, permissions, and token issuance (complete)

- Implement user-owned grant read/revoke and service-only token issuance.
- Bind each grant to its client and verified caller subject; validate active
  status, expiry, provider, and approved scopes on every exchange.
- Invoke permission authorization for the corresponding operations and deny
  conditional results.
- Add stable safe error payloads that distinguish missing consent, revoked or
  expired grant, wrong caller, refresh rejection, and temporary provider
  failure.
- Implement the node client over discovery and AuthService so in-process
  consumers use the same checked contract as external HTTP callers.

**Exit:** users cannot access another user's grants; users cannot call the
service-only issue operation; an unlisted service cannot mint even with a valid
grantId; and a revoked or expired grant cannot produce a token.

### Slice 4 — Connect, consent, and provider connection lifecycle

- Implement PKCE and one-use connect sessions with hashed state and encrypted
  verifier.
- Validate the configured return URL at start and redirect time.
- Present client name, provider, requested scopes, and background-use purpose
  before the user approves.
- Write provider credentials and the approved grant atomically. A second grant
  for an existing provider connection may avoid repeating OAuth only when the
  provider can mint and confirm a token whose actual scopes match that grant.
  If the provider cannot downscope or verify scopes, fail closed rather than
  returning a broader bearer token.
- Denial creates no grant. Disconnect removes or revokes the local secret and
  its grants; upstream revoke is best-effort where supported.
- Ensure ordinary RHDH logout never triggers provider-token revocation.

**Exit:** state mismatch, replay, expiry, return URL rejection, consent denial,
and database failure do not create usable grants or leak OAuth secrets.

### Slice 5 — User page in the new plugin

- Add a standalone provider-token page to the new frontend plugin and sample
  app.
- Show the user's own providers and grants, requested scopes, caller/client,
  expiry, status, and grantId. Include connect, approval/rejection, revoke,
  disconnect, and actionable empty/error states.
- Keep tokens out of the frontend model and browser logs.
- Defer attachment to Settings > Authentication Providers until the singleton
  owner can compose the existing and new provider sections.

**Exit:** the page completes connect, explicit consent, grant display, revoke,
and disconnect against the new backend without requiring the existing
secure-token-storage frontend.

### Slice 6 — Orchestrator consumer and end-to-end example

- Add a provider-token backend module that registers the existing
  Orchestrator grant resolver. Load only one resolver implementation at a time.
- Keep grantId accepted from workflow input or header. If omitted, resolve the
  initiating user's eligible grant for the requested provider.
- Exchange the grant at workflow execution time and place only the short-lived
  provider access token on the outbound request, never in workflow state or
  persisted workflow metadata.
- Document the new plugin and workflow demo in its own workspace guide.
- Exercise queued execution, token refresh, user revoke, provider revoke,
  wrong caller, and temporary provider failure.

**Exit:** the demo works with grantId in input, grantId in a header, and
automatic grant lookup; expired provider tokens refresh at call time; revoked
grants fail with an actionable response.

### Slice 7 — Security review and release readiness

- Complete and track the server-held refresh-token security review, including
  the RHIDP-15381 concerns referenced by RHDHPLAN-1661.
- Review key storage/rotation, process memory, database backups, log redaction,
  permissions, client allow-lists, token lifetime, revoke semantics, and
  multi-instance refresh behavior.
- Update canonical Orchestrator authentication documentation and the new
  workspace README/local testing guide.
- Add package API reports and changesets; verify dynamic-plugin exports and
  deployment wiring for the intended RHDH release.

**Exit:** acceptance criteria are demonstrated from the new sample workspace;
the security review and documentation are recorded; publication can be
performed without changes to the existing secure-token-storage workspace.

## Acceptance coverage

The implementation is complete when:

1. Queued and long-running Orchestrator workflows can obtain fresh short-lived
   GitHub and Microsoft tokens at execution time.
2. The supported path uses OAuth refresh material rather than PATs.
3. Only an opaque grantId appears in workflow state; access tokens are fetched
   just in time and refresh/consent material stays in the plugin.
4. Users explicitly approve background access to a provider, client, and
   scope set.
5. Revocation and refresh failure stop token issue and return a clear error
   without retry loops.
6. A written architecture decision documents workspace placement, token
   ownership, Orchestrator/runtime responsibility, caller trust, and grantId
   semantics.
7. Orchestrator docs and the security review are complete and tracked.

## Open decisions for later slices

- Confirm that security review accepts a reusable grantId reference without a
  separate per-run delegation record.
- Decide whether GitHub upstream revoke is required for the initial release or
  local revoke is sufficient if upstream revoke fails.

## Source and repository evidence

- [RHDHPLAN-1661 Feature](https://issues.redhat.com/browse/RHDHPLAN-1661)
  supplies the user outcomes and acceptance criteria.
- [PLAN-RHIDP-1661.md](./PLAN-RHIDP-1661.md) supplies the provider-token
  package roles, security model, provider modules, and lifecycle design.
- [Authentication Providers integration plan](./rhidp-1661-authentication-providers-integration-plan.md)
  records the Settings singleton constraint and the prior integration work.
- The current repo's standalone workspace and package conventions were reviewed
  in workspaces/secure-token-storage and workspaces/cost-management.
