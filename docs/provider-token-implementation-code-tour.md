# Provider Token implementation: code tour

This guide explains the Provider Token implementation added in
`workspaces/provider-token` (Slices 1–6): what each production area does, why
it is structured that way, and where its tests exercise the behavior. Links use
repository-relative paths with GitHub-style line anchors, so they open the
referenced source location when viewed in the repository.

This is a code tour, not a claim that every generated file or static asset has
independent runtime behavior. Package manifests, API reports, lockfiles, icons,
and the Backstage scaffolder example are supporting workspace material; the
runtime wiring and configuration that matter are included below.

## The end-to-end shape

1. A signed-in user chooses a configured provider and trusted workflow client
   in the frontend. The UI displays the scope policy configured for that
   client/provider in app-config; the backend creates a short-lived OAuth/PKCE
   session using that policy rather than browser-provided scopes.
2. The provider redirects to the backend callback. The backend validates and
   consumes the OAuth state, exchanges the code, and stages only the encrypted
   refresh credential until the user decides whether to approve the local
   grant.
3. Approval persists the provider secret and owner/client/caller-bound grant.
   Denial leaves no persistent connection. The UI sees only grant and
   connection metadata, never provider tokens.
4. A trusted workflow supplies its grant ID, or an Orchestrator integration
   resolves one. The backend authenticates the service, checks permissions and
   grant bindings, refreshes provider credentials when needed, and returns a
   short-lived access token to that service.

The OAuth provider login used to connect GitHub or Microsoft is independent of
the user's RHDH sign-in. The checked-in sample uses guest sign-in and an
in-memory SQLite database; it is for local prototyping, not durable deployment.

## Workspace and runtime wiring

- [`app-config.yaml` lines 1–33](../workspaces/provider-token/app-config.yaml#L1)
  sets the sample app/backend URLs, guest sign-in, in-memory SQLite, a
  local-only workflow service credential, and `providerToken.enabled: false`.
  Keeping the feature opt-in avoids turning on encryption or OAuth behavior
  accidentally; local values belong in the ignored `app-config.local.yaml`.
- [`packages/app/src/App.tsx` lines 1–24](../workspaces/provider-token/packages/app/src/App.tsx#L1)
  creates the minimal frontend with the Provider Token plugin and guest sign-in.
  It intentionally does not bundle the Orchestrator UI.
- [`packages/backend/src/index.ts` lines 1–22](../workspaces/provider-token/packages/backend/src/index.ts#L1)
  registers the app/auth backends, Provider Token backend, and the GitHub and
  Microsoft adapter modules. The optional Orchestrator module is not loaded in
  this sample backend.
- [`provider-token-backend/src/plugin.ts` lines 18–70](../workspaces/provider-token/plugins/provider-token-backend/src/plugin.ts#L18)
  registers permissions, mounts the HTTP router when enabled, and allows the
  OAuth callback without Backstage request credentials. A browser redirect
  from an OAuth provider cannot carry a Backstage bearer token; state and PKCE
  validate that callback instead.
- [`provider-token-backend/src/service.ts` lines 67–170](../workspaces/provider-token/plugins/provider-token-backend/src/service.ts#L67)
  reads and validates configured clients and their provider-specific scope
  policy, initializes the database migration
  and encryption key ring, sets the callback URL, and schedules cleanup of
  expired connect sessions. The disabled service fails closed so consumers do
  not silently get partially working token operations.
- [`provider-token-backend/config.d.ts` lines 8–54](../workspaces/provider-token/plugins/provider-token-backend/config.d.ts#L8)
  defines the supported config shape: encryption keys, provider OAuth clients,
  trusted workflow clients, their per-provider `providerScopes`, allow-listed
  service subjects, safe return
  URLs, and grant lifetime.

## Shared contracts and service boundaries

- [`provider-token-common/src/types.ts` lines 8–118](../workspaces/provider-token/plugins/provider-token-common/src/types.ts#L8)
  defines the shared client, connection, consent, grant, and token result
  shapes. Grant and connection summaries deliberately omit credential fields;
  the owner identifier is optional in token results because it is only useful
  to trusted in-process consumers and is omitted from the HTTP response.
- [`provider-token-common/src/errors.ts` lines 6–57](../workspaces/provider-token/plugins/provider-token-common/src/errors.ts#L6)
  provides stable machine-readable errors and a retryability flag. Keeping
  provider response bodies and secrets out of error messages prevents upstream
  diagnostics from leaking through API or workflow errors.
- [`provider-token-common/src/permissions.ts` lines 4–40](../workspaces/provider-token/plugins/provider-token-common/src/permissions.ts#L4)
  defines separate permissions for token issuance, metadata reads, grant
  revocation, connection/consent, and provider disconnect. Separating actions
  lets a Backstage permission policy grant only the operations a caller needs.
- [`provider-token-node/src/index.ts` lines 30–185](../workspaces/provider-token/plugins/provider-token-node/src/index.ts#L30)
  is the backend-facing contract: adapter interface, operations service,
  adapter extension point, and token API for trusted plugins. This prevents
  callers from depending directly on routes or database details.
- [`provider-token-node/src/ProviderTokenClient.ts` lines 65–264](../workspaces/provider-token/plugins/provider-token-node/src/ProviderTokenClient.ts#L65)
  implements that API for backend consumers. It discovers the Provider Token
  base URL, obtains a fresh plugin request token for each call, validates
  responses, and maps failures to safe stable errors. The Orchestrator module
  therefore does not hand-roll authentication headers or route construction.

## Backend request boundary

- [`provider-token-backend/src/router.ts` lines 27–197](../workspaces/provider-token/plugins/provider-token-backend/src/router.ts#L27)
  contains safe error conversion, strict input validators, verified-credential
  acquisition, and permission checks. Invalid shapes and conditional/denied
  permission decisions fail before service operations run.
- [`router.ts` lines 205–492](../workspaces/provider-token/plugins/provider-token-backend/src/router.ts#L205)
  implements user-facing reads, connect start/callback, consent-session reads
  and decisions, grant revoke, and provider disconnect. User identity is
  derived from the verified Backstage user principal rather than trusting an
  owner ID supplied by the browser.
- [`router.ts` lines 493–606](../workspaces/provider-token/plugins/provider-token-backend/src/router.ts#L493)
  implements grant resolution and token issuance for service principals only.
  The resolver returns only an opaque grant ID/provider. Token issuance checks
  the configured permission and authenticated service subject; the request
  cannot choose or impersonate the grant owner.
- [`router.ts` lines 607–659](../workspaces/provider-token/plugins/provider-token-backend/src/router.ts#L607)
  binds those handlers to the versioned `/v1` routes. Token and connect
  responses use no-store headers so browsers and intermediaries should not
  retain credential-related responses.

## Domain lifecycle and refresh logic

[`provider-token-backend/src/token-service.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts#L135)
is the domain layer: the router handles identity/HTTP policy; this service
enforces the provider connection, consent, grant, and token rules.

- [`startConnect` lines 201–330](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts#L201)
  selects scopes from the trusted client's provider-specific app-config policy
  (never from browser input) and checks the allow-listed return URL,
  creates random OAuth state and a PKCE verifier, stores only a hash of state
  and encrypted verifier, and returns the provider authorization URL. Hashing
  state limits damage from a session-table read; encrypting the verifier
  preserves PKCE without storing it as plaintext.
- [`completeConnectCallback` lines 331–509](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts#L331)
  validates provider/state/session expiry, consumes the state once, exchanges
  the code, and checks that the provider issued usable refreshable credentials
  with acceptable expiry and scopes. The access token is transient; the
  refresh token is staged encrypted until the local grant decision.
- [`getConnectSession` and `decideConnectSession` lines 510–685](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts#L510)
  restrict consent details and decisions to the session owner. Approval
  persists the provider secret and grant together; denial does not create a
  persistent connection. The transaction boundary prevents a grant from
  existing without its secret, or vice versa.
- [`disconnectProvider` and `revokeGrant` lines 686–756](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts#L686)
  enforce owner-scoped revocation and invalidate any cached access token.
  Disconnect removes local usability first and then asks an adapter to revoke
  upstream credentials when that provider supports it.
- [`issueAccessToken` lines 757–846](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts#L757)
  rechecks grant existence, owner/client/caller binding, provider assertion,
  grant expiry/revocation, secret ownership, and approved scopes on every issue.
  A grant ID is a reference, not a bearer credential by itself.
- [`getAccessToken` and `refresh` lines 848–1091](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts#L848)
  cache access tokens only in process memory, keyed by secret and scope set;
  coalesce concurrent refreshes; and persist rotated refresh credentials before
  returning a fresh access token. The safety window avoids returning a token
  that is about to expire during a queued workflow step. Revocation invalidates
  caches, including when it races with refresh.

## Persistence and cryptography

- [`20261002120000_provider_token.js` lines 8–72](../workspaces/provider-token/plugins/provider-token-backend/migrations/20261002120000_provider_token.js#L8)
  creates three plugin-owned tables: provider secrets (encrypted refresh
  material only), grants (owner/client/caller/provider/scopes/lifetime), and
  short-lived connect sessions (hashed state, encrypted PKCE verifier, and
  encrypted pending refresh material). No access-token database column exists.
- [`crypto.ts` lines 8–55](../workspaces/provider-token/plugins/provider-token-backend/src/crypto.ts#L8)
  defines encrypted-secret metadata and validates key encodings and key-version
  labels. [`TokenCipher` lines 57–146](../workspaces/provider-token/plugins/provider-token-backend/src/crypto.ts#L57)
  uses authenticated encryption and records the key version with ciphertext,
  allowing old values to be decrypted during rotation while new writes use the
  active key. [`secretAssociatedData` lines 189–206](../workspaces/provider-token/plugins/provider-token-backend/src/crypto.ts#L189)
  binds ciphertext to owner, provider, and secret purpose so it cannot be
  swapped between records or uses without authentication failure.
- [`database/repository.ts` lines 13–209](../workspaces/provider-token/plugins/provider-token-backend/src/database/repository.ts#L13)
  defines the persistence types and maps database rows into domain objects.
  [`ProviderTokenRepository` lines 210–678](../workspaces/provider-token/plugins/provider-token-backend/src/database/repository.ts#L210)
  owns storage queries, transactions, refresh locking, one-use session
  consumption, owner-scoped grant queries, and cleanup. Keeping SQL here makes
  the service layer testable without making it responsible for database shape.
- [`database/migration.ts` lines 11–22](../workspaces/provider-token/plugins/provider-token-backend/src/database/migration.ts#L11)
  locates and runs the plugin migration using Backstage's database service.

## Provider adapters

[`provider-token-backend/src/adapters.ts` lines 1–22](../workspaces/provider-token/plugins/provider-token-backend/src/adapters.ts#L1)
is the process-local adapter registry. It rejects malformed or duplicate IDs so
only one module can claim a configured provider name. The public adapter
contract is in [`provider-token-node/src/index.ts` lines 57–94](../workspaces/provider-token/plugins/provider-token-node/src/index.ts#L57).

- [`provider-token-backend-module-github/src/adapter.ts` lines 101–282](../workspaces/provider-token/plugins/provider-token-backend-module-github/src/adapter.ts#L101)
  creates GitHub PKCE URLs, exchanges authorization codes, refreshes and
  rotates credentials, parses actual scopes/expiries, and supports best-effort
  upstream revocation. Failures are normalized instead of returning raw GitHub
  response details. [`module.ts` lines 11–41](../workspaces/provider-token/plugins/provider-token-backend-module-github/src/module.ts#L11)
  reads provider secrets from config and registers the adapter with the
  Provider Token extension point.
- [`provider-token-backend-module-microsoft/src/adapter.ts` lines 95–252](../workspaces/provider-token/plugins/provider-token-backend-module-microsoft/src/adapter.ts#L95)
  implements the same contract with tenant-specific Microsoft OAuth endpoints,
  scope/expiry validation, refresh rotation, and retryable versus rejected
  refresh classification. [`module.ts` lines 11–41](../workspaces/provider-token/plugins/provider-token-backend-module-microsoft/src/module.ts#L11)
  supplies its tenant/client configuration and registers it independently.

Keeping provider-specific protocol code in separate backend modules means the
core backend owns grants and refresh policy, while each adapter owns provider
wire formats and quirks. An absent module fails closed rather than redirecting
the user to a provider that cannot complete the flow.

## Frontend plugin

- [`provider-token/src/plugin.tsx` lines 8–43](../workspaces/provider-token/plugins/provider-token/src/plugin.tsx#L8)
  creates the New Frontend System plugin and page extension; [`routes.ts`](../workspaces/provider-token/plugins/provider-token/src/routes.ts#L1)
  supplies its route reference; [`index.ts`](../workspaces/provider-token/plugins/provider-token/src/index.ts#L1)
  exposes the default plugin entry point.
- [`provider-token/src/api/ProviderTokenClient.ts` lines 15–168](../workspaces/provider-token/plugins/provider-token/src/api/ProviderTokenClient.ts#L15)
  defines UI-safe types and validates JSON responses before the component uses
  them. [`ProviderTokenClient` lines 170–298](../workspaces/provider-token/plugins/provider-token/src/api/ProviderTokenClient.ts#L170)
  centralizes authenticated frontend requests and maps errors to stable codes.
  This boundary keeps malformed or unexpected backend data out of rendering
  code.
- [`ProviderTokenPage.tsx` lines 38–95](../workspaces/provider-token/plugins/provider-token/src/components/ProviderTokenPage.tsx#L38)
  parses callback state and builds safe labels/status messages. [`ProviderTokenPage` lines 96–297](../workspaces/provider-token/plugins/provider-token/src/components/ProviderTokenPage.tsx#L96)
  loads metadata, starts provider connections, retrieves the pending consent
  session, submits approve/deny, and performs grant revoke/provider disconnect.
  [`render` lines 298–635](../workspaces/provider-token/plugins/provider-token/src/components/ProviderTokenPage.tsx#L298)
  presents loading, error, empty, consent, connection, and grant states. The
  browser receives metadata and the opaque grant ID, never an access token.

## Optional Orchestrator integration

- [`orchestrator-contract.ts` lines 13–48](../workspaces/provider-token/plugins/provider-token-backend-module-orchestrator/src/orchestrator-contract.ts#L13)
  describes the resolver and extension-point shape. It currently keeps a
  structural copy keyed by `orchestrator.provider-token-grants` because the
  workspace's pinned published `orchestrator-node` package does not yet export
  the contract present in Orchestrator source. This is a compatibility seam to
  replace when that package is updated.
- [`resolver.ts` lines 11–38](../workspaces/provider-token/plugins/provider-token-backend-module-orchestrator/src/resolver.ts#L11)
  resolves a safe grant reference using Orchestrator's own service credentials
  and requests the short-lived token using the workflow's verified caller
  credentials. This keeps grant discovery and token use on their intended
  service identities.
- [`module.ts` lines 19–41](../workspaces/provider-token/plugins/provider-token-backend-module-orchestrator/src/module.ts#L19)
  registers those functions with Orchestrator. It is optional and is not loaded
  by the Provider Token sample app. The sample workflow can still receive
  `grantId` as input/header and call the token endpoint directly.

## Why the tests are divided this way

Tests target the layer that owns each guarantee instead of relying only on a
single end-to-end test:

| Test file                                                                                                                                                                                                                                                             | What it proves                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`crypto.test.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/crypto.test.ts#L15)                                                                                                                                                                | Encryption round-trip, owner/provider binding, key rotation, tamper rejection, and invalid key configuration.                       |
| [`database/repository.test.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/database/repository.test.ts#L76)                                                                                                                                      | Refresh-only persistence, safe grant summaries, one-use/expired sessions, and cleanup behavior.                                     |
| [`connect-service.test.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/connect-service.test.ts#L16)                                                                                                                                              | Full OAuth/consent lifecycle, callback state and scope validation, rejection cleanup, ownership, and transaction rollback.          |
| [`token-service.test.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.test.ts#L21)                                                                                                                                                  | Grant/caller validation, cache behavior, refresh rejection, invalidation races, single-flight, and persist-before-return rotation.  |
| [`router.test.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/router.test.ts#L24)                                                                                                                                                                | HTTP identity, permission boundaries, redacted errors, service-only issuance, grant resolution, and malformed-input rejection.      |
| [`adapters.test.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/adapters.test.ts#L9)                                                                                                                                                             | Invalid and duplicate adapter IDs cannot overwrite another provider module's registration.                                          |
| [`plugin.test.ts`](../workspaces/provider-token/plugins/provider-token-backend/src/plugin.test.ts#L33)                                                                                                                                                                | Only the OAuth callback is allowed without Backstage credentials.                                                                   |
| [`GitHub adapter tests`](../workspaces/provider-token/plugins/provider-token-backend-module-github/src/adapter.test.ts#L22) and [`Microsoft adapter tests`](../workspaces/provider-token/plugins/provider-token-backend-module-microsoft/src/adapter.test.ts#L21)     | Provider URL construction, exchange/refresh parsing, rotation, scope/expiry behavior, error classification, and sanitized failures. |
| [`ProviderTokenClient.test.ts`](../workspaces/provider-token/plugins/provider-token-node/src/ProviderTokenClient.test.ts#L18)                                                                                                                                         | Plugin request-token acquisition, API discovery, response/error parsing, and no-grant/ambiguous resolution.                         |
| [`ProviderTokenPage.test.tsx`](../workspaces/provider-token/plugins/provider-token/src/components/ProviderTokenPage.test.tsx#L52)                                                                                                                                     | User-visible connect/consent/reject/revoke/disconnect and loading, empty, error, and token-free display behavior.                   |
| [`Orchestrator resolver tests`](../workspaces/provider-token/plugins/provider-token-backend-module-orchestrator/src/resolver.test.ts#L15) and [`module test`](../workspaces/provider-token/plugins/provider-token-backend-module-orchestrator/src/module.test.ts#L14) | Caller identity forwarding, resolver results, token acquisition, and binding by the extension-point ID.                             |

The sample run instructions are in
[`workspaces/provider-token/LOCAL_TESTING.md`](../workspaces/provider-token/LOCAL_TESTING.md).
