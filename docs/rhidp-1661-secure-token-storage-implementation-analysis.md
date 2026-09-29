# RHIDP-1661 Secure Token Storage Implementation Analysis

Status: implementation-readiness note  
Related plan: [PLAN-RHIDP-1661.md](./PLAN-RHIDP-1661.md)

## Purpose

This document compares the RHIDP-1661 plan with the secure token storage prototype already implemented for RHIDP-15907. It records how to evolve that prototype when implementation resumes.

The placement decision for this work is:

- Keep the implementation in the `rhdh-plugins` repository.
- Keep it in `workspaces/secure-token-storage`.
- Use the existing sample application under that workspace as the local integration host.
- Preserve the existing `secure-token-storage` plugin and package identity unless a product requirement makes a rename necessary.

The reference RHIDP-1661 plan is intentionally left unchanged. This analysis records the implementation decisions that differ from that original proposal, including repository placement and retaining the existing `grantId` workflow exchange.

## Executive summary

The existing implementation is a working vertical prototype of the capability described by RHIDP-1661. It already proves the main flow: a user connects a provider through a separate OAuth flow, approves access, and a workflow exchanges an opaque identifier for an access token at execution time.

RHIDP-1661 is primarily a hardening and domain-model refinement rather than an unrelated feature. The existing workflow-facing contract remains the target design:

- A **grant** records the user's consent for a named client to use a provider connection.
- The grant's opaque `grantId` is forwarded to the workflow.
- The workflow exchanges that `grantId`, together with its authenticated service identity, for a current provider access token whenever one is needed.

A separate delegation identifier and lifecycle are not required for this integration. The `grantId` is not sufficient authorization by itself: the token endpoint must also verify that the authenticated service subject is allowed for the client recorded on the grant. The user is resolved from the stored grant and is never accepted from the workflow's request.

The implementation should evolve incrementally in the existing workspace. New schemas and `/v1` APIs can be introduced alongside the prototype contracts, allowing the sample application and Orchestrator integration to continue working while each slice is migrated.

## Current implementation

The workspace currently contains:

- `plugins/secure-token-storage`: New Frontend System plugin for connecting providers and managing grants.
- `plugins/secure-token-storage-node`: shared backend extension point and service types.
- `plugins/secure-token-storage-backend`: OAuth, encrypted token persistence, consent, grant management, token retrieval, refresh, and audit behavior.
- `packages/app` and `packages/backend`: a local Backstage/RHDH test application.

The prototype currently provides:

- Separate OAuth connections for GitHub and Microsoft instead of capturing Backstage sign-in tokens.
- PKCE-based, single-use connection sessions.
- Encrypted storage of access and refresh tokens.
- Explicit user approval and revocation of provider grants.
- Caller-subject checks for service token retrieval.
- Automatic refresh when a stored access token has expired and a refresh token is available.
- A frontend page for connecting, disconnecting, approving, refreshing, and revoking grants.
- Orchestrator integration that carries an opaque grant identifier to SonataFlow.
- A SonataFlow prototype that retrieves the provider access token when the workflow needs it.
- An opt-in integration that leaves the existing Orchestrator `authTokens` flow available.

## How the RHIDP-1661 model maps to the prototype

| RHIDP-1661 concept | Current prototype concept      | Required change                                                                                                  |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Secret             | Provider connection            | Store the refresh credential as the durable secret; stop treating the access token as durable state.             |
| Grant              | Provider grant                 | Keep `grantId` as the workflow-facing handle; bind the grant to a named client, user, provider, scopes, and TTL. |
| Connect session    | Connect session                | Retain and strengthen redirect, transaction, reuse, and expiry behavior.                                         |
| Named client       | Global allowed caller subjects | Add client configuration with allowed service subjects and consent metadata.                                     |
| Access-token issue | Grant-token endpoint           | Keep grant exchange semantics while moving to a hardened, versioned `/v1/access-tokens` contract.                |
| Audit event        | Audit event                    | Retain and expand coverage for grant use, refresh, revocation, and denial reasons.                               |

The current `grantId` contract is retained. It should be opaque and unguessable, but it is an identifier rather than the sole caller credential. Token issuance requires both the `grantId` and an authenticated service principal authorized for the grant's named client.

## Intentional difference from the reference plan

The reference plan proposes separate Grant and Delegation records. Under that model, the workflow would receive a one-time delegation identifier instead of the existing `grantId`.

For the implementation in this repository, that additional seam is not needed. The existing interface already gives callers the required behavior with less lifecycle complexity:

1. The user approves a provider grant.
2. Orchestrator accepts a supplied `grantId` or resolves the user's active grant before starting the workflow.
3. Orchestrator forwards `grantId` in the workflow input and/or header.
4. SonataFlow presents `grantId` with its authenticated service credentials.
5. Secure token storage resolves the user and provider from the grant and returns a current valid access token, refreshing it transparently when necessary.

The implementation must preserve the security properties that motivated the proposed delegation model:

- The issue request cannot select or override `userEntityRef`.
- The grant is bound to a named client, provider, scopes, expiry, and revocation state.
- The authenticated service subject must be allowed for that named client.
- An active `grantId` alone is not enough to retrieve a token.
- Grant use and token refresh are audited without logging provider credentials.

This is a deliberate divergence recorded in this analysis; it does not rewrite the reference plan.

## Gap analysis

| Area                  | Already implemented                                                                        | Remaining work                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Repository placement  | Working workspace and sample app exist in this repository.                                 | Keep all new packages and migration work in `workspaces/secure-token-storage`.                                                         |
| OAuth isolation       | Provider connection is separate from Backstage login.                                      | Formalize the model and avoid coupling future work to sign-in token capture.                                                           |
| Encryption            | AES-GCM storage and key-version concepts exist.                                            | Align the encrypted envelope and associated data with the final secret schema; persist refresh credentials only.                       |
| Domain model          | Connections, grants, connect sessions, and audit records exist.                            | Introduce secrets and harden grants with named-client binding, scopes, expiry, last use, and revocation.                               |
| Token lifetime        | Expired access tokens can be refreshed.                                                    | Add memory-only access-token caching, row locking or single-flight refresh, rotation-safe persistence, and retryable failure handling. |
| Provider support      | GitHub and Microsoft adapters exist inside the backend.                                    | Extract modular provider adapters and enforce each provider's token-lifetime requirements.                                             |
| Authorization         | Authenticated user and caller-subject checks exist.                                        | Require verified service principal, configured client, active grant, and permission-framework authorization.                           |
| API                   | Prototype connection, consent, grant, revoke, refresh, disconnect, and token routes exist. | Add the versioned `/v1` contract and structured Backstage errors with retryability metadata.                                           |
| Configuration         | Providers, global allowed callers, redirects, and user connection settings exist.          | Add named clients with allowed subjects and provider-specific module configuration.                                                    |
| Frontend              | Users can connect providers and manage active grants.                                      | Show named-client consent plus grant expiry, last-use, renewal, and revocation state.                                                  |
| Node API              | An extension point allows Orchestrator to resolve grants and tokens.                       | Preserve the grant-resolution interface and add a discovery/AuthService-based client where needed.                                     |
| Orchestrator          | Resolves or accepts a `grantId` and forwards it to the workflow.                           | Keep this behavior; adapt only route/client details needed by the hardened backend contract.                                           |
| SonataFlow            | Exchanges the forwarded `grantId` for an access token at call time.                        | Keep this behavior; authenticate the exchange as an allowed service subject and never supply a user identity.                          |
| Operational hardening | Basic logging, audit behavior, and tests exist.                                            | Add cleanup jobs, concurrency tests, PostgreSQL coverage, metrics, and complete denial-path auditing.                                  |

## Proposed package layout

The existing packages should remain the foundation:

```text
workspaces/secure-token-storage/
├── plugins/
│   ├── secure-token-storage/
│   ├── secure-token-storage-node/
│   └── secure-token-storage-backend/
├── packages/
│   ├── app/
│   └── backend/
└── ...
```

Add packages only where they create a meaningful boundary:

```text
plugins/
├── secure-token-storage-common/                       # Shared wire/domain types, if needed by multiple packages
├── secure-token-storage-backend-module-github/       # GitHub OAuth and refresh adapter
└── secure-token-storage-backend-module-microsoft/    # Microsoft OAuth and refresh adapter
```

The core backend should own storage, grants, authorization, refresh coordination, auditing, and the `/v1` HTTP contract. Provider modules should own provider-specific authorization URLs, token exchange, refresh, revocation, and response validation.

Do not add `secure-token-storage-common` merely to hold a few shallow types. Keep types in the node or backend package until they genuinely need to be shared with the frontend or provider modules.

## Compatibility strategy

Implementation should be additive until the replacement flow is proven:

1. Add new tables and repositories without destructively changing the current connection and grant tables.
2. Introduce `/v1` routes alongside the prototype routes.
3. Keep the current UI and workflow path functioning while individual operations move to `/v1`.
4. Continue supporting the Orchestrator's existing `authTokens` behavior; secure token storage remains opt-in.
5. Preserve the current `providerTokenGrants` input and the grant header as supported ways to forward `grantId`.
6. Decide explicitly whether prototype data needs migration. For local-only prototype data, reconnecting providers may be safer than attempting to transform encrypted records.
7. Remove compatibility routes only after the sample app, Orchestrator, and SonataFlow demo use the versioned grant-exchange contract.

The alternative described in `rhidp-15907-login-integrated-github-option.md`—capturing or extending the Backstage sign-in flow—is not the selected design. RHIDP-1661 retains a separate provider connection and consent flow.

## Orchestrator and SonataFlow integration

The existing integration is the intended design: Orchestrator sends an opaque `grantId` rather than a provider token, and SonataFlow retrieves the access token only when it is needed. No additional delegation creation step is required.

```text
User starts workflow
        │
        ▼
Orchestrator resolves or accepts the user's
active grantId for the selected provider
        │
        ▼
Workflow receives/stores the opaque grantId
        │
        ▼
SonataFlow authenticates as its service principal
and presents grantId to /v1/access-tokens
        │
        ▼
Secure token storage validates client, subject,
grant, permission, and provider secret
        │
        ▼
Fresh access token is returned in memory
```

Important consequences:

- The user is present when provider consent creates or renews the grant, but not when the workflow later requests a token.
- The token-issuance request must not accept a user identity supplied by the workflow.
- The grant is bound to the user, named client, provider, scopes, expiry, and revocation state.
- `grantId` is opaque and unguessable, but it is not authorization by itself; the authenticated SonataFlow subject must be allowed for the grant's client.
- Orchestrator may resolve the user's active grant when the form does not supply one, using the authenticated user's identity before workflow launch.
- The current header and workflow-input transports remain valid ways to deliver `grantId`.
- The current Orchestrator extension point remains useful because it hides grant lookup and header construction behind a small interface.

## Incremental implementation plan

### Phase 0: Lock contracts and compatibility decisions

- Confirm that the public plugin ID remains `secure-token-storage` even if the product capability is described as provider token storage.
- Define the Secret, Grant, ConnectSession, and Client types.
- Define `/v1` request, response, and error contracts while preserving `grantId` exchange semantics.
- Decide how long prototype route paths remain supported alongside `/v1`.
- Decide whether existing encrypted local records will be migrated or discarded through documented reconnect steps.

Deliverable: accepted domain and compatibility design with no runtime behavior change.

### Phase 1: Add the durable domain core

- Add additive migrations for secrets, hardened grants, connect sessions, and expanded audit fields.
- Add repositories and service interfaces behind the existing backend plugin.
- Reuse and adapt the AES-GCM implementation for refresh-secret storage.
- Generate opaque, unguessable grant identifiers and treat them as references that still require service authentication.
- Add unit and database tests for lifecycle, expiry, revocation, and uniqueness rules.

Deliverable: the new domain can be exercised internally without changing the current UI or Orchestrator flow.

### Phase 2: Harden token refresh

- Move durable access tokens out of the database and into a bounded memory cache.
- Add per-secret single-flight coordination and database row locking.
- Persist rotated refresh credentials before returning a new access token.
- Distinguish retryable provider failures from credentials requiring reconnection.
- Add refresh-attempt, refresh-success, refresh-failure, and cache behavior logs and metrics.

Deliverable: concurrent requests return a valid token without duplicate or unsafe refresh operations.

### Phase 3: Harden named clients and grant exchange

- Add named-client configuration and allowed service subjects.
- Add user-authenticated grant creation, renewal, listing, and revocation.
- Add service-authenticated `/v1/access-tokens` issuance.
- Enforce configured client, verified subject, active grant, scope, expiry, revocation, and permission checks.
- Audit successful and denied issuance without logging provider credentials.

Deliverable: a service can exchange a valid `grantId` for an access token without supplying a user identity.

### Phase 4: Migrate connection and consent behavior

- Adapt PKCE connect sessions to the `/v1` model.
- Bind consent to a named client and requested scopes.
- Validate redirect and return URLs consistently.
- Make callback consumption transactional and safely single-use.
- Allow an existing compatible provider secret to be reused without unnecessary reconnection.

Deliverable: a user can connect once and grant explicitly scoped access to a configured client.

### Phase 5: Extract provider modules

- Define the provider-adapter extension point in the node package.
- Move Microsoft behavior into its backend module.
- Move GitHub behavior into its backend module.
- Enforce GitHub's required expiring-token and refresh-token response properties for this feature.
- Implement provider revocation where supported and distinguish local revocation from upstream revocation.

Deliverable: the core backend has no provider-specific OAuth implementation.

### Phase 6: Update the frontend plugin

- Show provider connections separately from client grants.
- Present named-client consent details and requested scopes.
- Show grant ID, expiry, last use, renewal, and revocation controls without exposing provider credentials.
- Keep current connection-management behavior available during migration.

Deliverable: users can understand and manage who can use their provider credentials and for which work.

### Phase 7: Validate Orchestrator and the workflow demo

- Preserve active-grant resolution when the workflow form does not provide `grantId`.
- Send `grantId` through the existing header and/or workflow input transport.
- Keep the `10_provider_token_grant` demo able to accept `grantId` through either transport.
- Have SonataFlow exchange `grantId` at call time using its service identity.
- Adapt route paths or node-client calls only where the versioned backend contract requires it.
- Retain legacy `authTokens` behavior when secure token storage is not selected.

Deliverable: the existing end-to-end grant exchange passes against the hardened backend while opt-out flows continue to work.

### Phase 8: Operational hardening and release readiness

- Add cleanup for expired connect sessions, grants, cache entries, and obsolete records.
- Add end-to-end tests covering restart, token expiry, concurrent refresh, rotation, revocation, reconnect, and denied callers.
- Run database coverage against PostgreSQL in addition to lightweight test databases.
- Validate logs and audit records contain no access tokens, refresh tokens, authorization codes, or other provider credentials.
- Document configuration, provider prerequisites, migration, troubleshooting, and the full local demo.

Deliverable: production-readiness evidence for the supported providers and integration path.

## Reuse versus replacement

### Reuse and evolve

- Workspace structure and sample application.
- Separate provider OAuth flow.
- PKCE connect-session handling.
- AES-GCM encryption and key-version approach.
- GitHub and Microsoft exchange/refresh knowledge.
- Authentication split between user-facing and service-facing endpoints.
- Audit and INFO-level observability patterns.
- New Frontend System plugin scaffolding and current connection UI components.
- Orchestrator's `grantId` resolution and transport.
- SonataFlow's call-time token retrieval pattern.

### Replace or substantially reshape

- Connection-plus-grant persistence model.
- Durable encrypted access-token storage.
- Global `allowedCallerSubjects` authorization model.
- Provider implementations embedded in the core backend.
- Non-versioned prototype HTTP contracts and string-only errors.
- Refresh logic without locking, single-flight behavior, or bounded caching.
- Grant UI that does not clearly expose client binding, expiry, last use, renewal, and revocation state.

## Security requirements to preserve during implementation

- Never derive provider authorization from a user identity supplied by a workflow.
- Require a verified Backstage service principal for token issuance.
- Match that principal to the grant's configured named client.
- Store refresh credentials encrypted and use opaque, unguessable grant identifiers.
- Keep access tokens in memory only and for the shortest useful period.
- Serialize refresh for a secret across both process-local and database-concurrent requests.
- Never log tokens, OAuth authorization codes, PKCE verifiers, or provider credentials.
- Revoke access locally immediately even if upstream provider revocation fails.
- Preserve the previous non-storage and legacy `authTokens` flows when secure token storage is not configured or selected.

## Decisions still needed

1. Should public package names and the plugin ID remain `secure-token-storage`, or must they become `provider-token`? The default recommendation is to avoid a rename.
2. Are existing prototype database records disposable, or is an automated connection/grant migration required?
3. Should both the grant header and `providerTokenGrants` workflow input remain permanent supported transports?
4. What named clients and service subjects represent Orchestrator and SonataFlow in local and deployed environments?
5. Which GitHub application configuration guarantees expiring access tokens and refresh tokens for supported installations?
6. Which permission policy and permission names should guard grant and token issuance operations?
7. What PostgreSQL versions and deployment topologies must the refresh-concurrency tests cover?

## Recommended first coding slice

After the decisions in Phase 0 are recorded, begin with an additive domain-core slice inside `workspaces/secure-token-storage`:

1. Define the new Secret, Grant, and Client contracts while preserving the external `grantId` semantics.
2. Add new secret storage and hardening fields through additive migrations without breaking current tables or routes.
3. Implement hardened grant lookup, client binding, expiry, renewal, last-use tracking, and revocation behind the existing interface.
4. Add focused repository and service tests.
5. Leave the current sample application and Orchestrator integration unchanged until the new model is stable.

This is the lowest-risk starting point because it establishes the security boundary needed by every later phase while preserving the working prototype as a regression harness.

## Related documents

- [RHIDP-1661 plan](./PLAN-RHIDP-1661.md)
- [RHIDP-15907 implementation plan](./rhidp-15907-implementation-plan.md)
- [Secure token storage local testing guide](../workspaces/secure-token-storage/LOCAL_TESTING.md)
- [Login-integrated GitHub alternative](./rhidp-15907-login-integrated-github-option.md)
