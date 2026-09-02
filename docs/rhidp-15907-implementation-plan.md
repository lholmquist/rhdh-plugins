# RHIDP-15907: Provider Token Storage Implementation Plan

## Status and scope

RHIDP-15907 is a Size-S, time-boxed spike under RHDHPLAN-1661. Its immediate
deliverable is architectural evidence and a follow-on Epic breakdown, not the
complete production implementation.

The spike must answer:

1. Whether to adopt and harden the upstream provider-token proof of concept or
   choose another approach.
2. Whether SonataFlow or the Orchestrator backend owns call-time token
   retrieval.
3. Which gaps must be addressed for GitHub and Microsoft.
4. What security and trust model is required.
5. How the production work should be divided into implementation Epics or
   Stories.

## Current state

Orchestrator currently obtains provider access tokens in the browser and sends
the raw values through each layer when starting or retriggering a workflow:

1. [`useOrchestratorAuth`](../workspaces/orchestrator/plugins/orchestrator/src/hooks/useOrchestratorAuth.ts)
   calls the frontend provider's `getAccessToken` or `getIdToken` method.
2. [`OrchestratorClient`](../workspaces/orchestrator/plugins/orchestrator/src/api/OrchestratorClient.ts)
   includes those tokens in `ExecuteWorkflowRequestDTO.authTokens`.
3. [`SonataFlowService`](../workspaces/orchestrator/plugins/orchestrator-backend/src/service/SonataFlowService.ts)
   forwards them to SonataFlow as `X-Authorization-*` headers.
4. The public contract is defined in
   [`openapi.yaml`](../workspaces/orchestrator/plugins/orchestrator-common/src/openapi/openapi.yaml).

This only provides the token available at workflow-start time. It cannot
guarantee a valid token after queueing or during a long-running workflow.

The existing
[`custom-authentication-provider-module-backend`](../workspaces/orchestrator/plugins/custom-authentication-provider-module-backend)
is a development-only example. It demonstrates provider registration through
`authProvidersExtensionPoint`, but it is not a production storage mechanism.

## Recommended target architecture

```text
Browser -- OAuth + consent --> Provider Token Broker -- encrypted --> Database
                                  ^
                                  |
                                  | service identity + opaque grant
                                  |
                              SonataFlow
                        fetches at actual call time
```

The recommended call-time boundary is SonataFlow:

- Orchestrator initiates connection and consent, then supplies an opaque grant
  reference to the workflow rather than a provider token.
- The SonataFlow deployment authenticates to the broker using a Backstage
  external-access service identity.
- The workflow presents the opaque grant when it needs a provider token.
- The broker verifies the service identity and grant, refreshes internally if
  necessary, and returns only a short-lived access token.
- Refresh tokens never leave the broker.

This boundary works when a workflow is queued or continues after the original
browser session and access token have expired.

## Proposed repository structure

Create an independent `workspaces/secure-token-storage` workspace so the generic
token capability is not owned by Orchestrator and can later move upstream.

Proposed packages:

```text
workspaces/secure-token-storage/
  packages/backend/                       # Local integration host
  plugins/secure-token-storage-node/      # Public interface and service ref
  plugins/secure-token-storage-backend/   # Broker implementation and routes
  plugins/auth-backend-module-provider-token/ # Optional auth integration
```

The canonical root-scoped interface should live in `secure-token-storage-node`.
The factory and implementation should live in `secure-token-storage-backend`, following
the existing pattern in
[`x2a-node`](../workspaces/x2a/plugins/x2a-node/src/services/serviceRefs.ts) and
[`x2a-backend`](../workspaces/x2a/plugins/x2a-backend/src/services/X2ADatabaseService/index.ts).

Orchestrator consumes the published interface; it does not own provider-token
storage, encryption, or refresh behavior.

## Interface design

The broker should be a deep module: callers learn a small interface while
consent checks, encryption, refresh, concurrency, provider differences, and
revocation stay inside the implementation.

An initial in-process interface could be shaped like this:

```ts
interface ProviderTokenBroker {
  getAccessToken(options: {
    grantId: string;
    provider: string;
    caller: BackstageCredentials<BackstageServicePrincipal>;
  }): Promise<{
    accessToken: string;
    expiresAt?: Date;
    scopes: string[];
  }>;
}
```

The final types may differ, but the following invariants should not:

- Never return refresh tokens.
- Derive caller identity from verified Backstage credentials rather than a
  caller-supplied plugin ID.
- Check the caller-specific user grant before decrypting token material.
- Bind each grant to the user, caller, provider, approved scopes, and lifecycle.
- Consider binding workflow grants to a workflow or instance identifier.
- Keep provider refresh and token rotation internal.
- Return stable, typed error modes for missing consent, revoked grants,
  reauthentication requirements, and provider failures.

## Spike execution plan

### 1. Prove the Backstage extension seam

The installed Backstage auth interface can register providers, but it does not
expose the `providerTokenStore` hook proposed by the upstream proof of concept.
Overriding `coreServices.auth` does not solve this: that core service owns
Backstage request credentials and service-to-service authentication, not OAuth
provider-token persistence.

Build a minimal compile-time and runtime experiment for each option:

| Option                                  | Benefit                                                          | Cost or limitation                                                                |
| --------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Separate OAuth connect flow             | Can be implemented in this repository without patching Backstage | Does not transparently capture existing provider sessions                         |
| Wrapped/replacement provider factories  | Can reuse familiar provider login flows                          | Provider-specific, risks duplicate registration, and may duplicate upstream logic |
| Upstream `providerTokenStore` extension | Cleanest transparent integration                                 | Requires changes in Backstage `auth-node` and `auth-backend`                      |

Recommended spike choice: implement the separate connect flow locally and use
the evidence to define the upstream extension needed for transparent provider
integration.

Deliverables:

- A decision record describing the tested seams.
- A small runtime proof showing that the selected module can register and use
  its database and HTTP routes in the RHDH backend.
- A list of upstream interface changes required.

### 2. Scaffold the provider-token workspace

- Create the workspace using the repository workspace tooling.
- Scaffold the node library, backend plugin, optional auth module, and test
  backend.
- Register a root-scoped service reference and factory.
- Add feature-gated configuration; disabled must remain the default.
- Add package ownership, catalog metadata, Renovate preset, labels, and CI
  coverage configuration expected for a new workspace.

### 3. Implement secure persistence

Use separate tables because provider connections and caller grants have
different lifecycles.

Provider connection fields should include:

- User entity reference and provider ID.
- Encrypted access and refresh tokens.
- Access-token expiry and granted scopes.
- Encryption key ID/version.
- Creation, update, last-use, and revocation timestamps.

Grant fields should include:

- Opaque grant ID.
- User entity reference.
- Verified service subject.
- Provider and approved scopes.
- Optional workflow/instance binding.
- Creation, expiry, and revocation timestamps.

OAuth connect state must also be persisted with a short TTL and one-time-use
semantics. In-memory connect state is not acceptable because requests in a
multi-replica RHDH deployment may reach different instances.

Encryption requirements:

- Use authenticated encryption such as AES-256-GCM with a unique random nonce.
- Bind user, provider, record ID, and key version as authenticated associated
  data.
- Load keys from secret-backed configuration, never repository configuration.
- Support an active key plus previous keys so rotation can be performed without
  invalidating all stored tokens.
- Never log plaintext, ciphertext, authorization codes, or token endpoint
  response bodies.
- Perform token replacement and refresh-token rotation atomically.

### 4. Add provider adapters

Introduce a provider adapter seam only after implementing two real adapters.
The common behavior belongs inside the broker; provider-specific differences
belong in GitHub and Microsoft adapters.

Microsoft checks:

- `offline_access` scope and refresh-token issuance.
- Rotating refresh tokens.
- Tenant/audience configuration.
- Incremental scope consent and re-consent.
- Revocation and interaction-required errors.

GitHub checks:

- OAuth App versus GitHub App behavior.
- Flows where the returned credential has no conventional refresh token.
- Scope changes that require a new authorization flow.
- Expiring user tokens where enabled.
- Revoked installation or user authorization.

The broker should delete or quarantine irrecoverably revoked credentials and
return a reauthentication-required result. Transient provider failures should
not destroy valid stored credentials.

### 5. Add consent and grant routes

Minimum route families:

- Initiate a provider connection: service credentials only; caller identity is
  derived from the credential.
- Approve or reject consent: user credentials only.
- Get a fresh access token: service credentials plus opaque grant.
- List and revoke grants: owning user only.
- Disconnect a provider: owning user only, with clear impact on all grants.

Security properties:

- Do not accept a self-declared caller/plugin identity.
- Do not expose refresh tokens through any route.
- Validate redirect destinations against an allowlist.
- Apply short expiry and single-use behavior to consent/connect state.
- Enforce provider and scope restrictions stored with the grant.
- Audit grant creation, use, denial, revocation, refresh, and disconnection
  without recording credentials.

### 6. Integrate Orchestrator additively

Keep `authTokens` temporarily for compatibility. Add a grant-based execution
path rather than changing existing request semantics immediately.

- Replace frontend token collection for opted-in workflows with a broker
  connect/consent operation.
- Pass an opaque grant reference and broker metadata instead of raw provider
  credentials.
- Configure SonataFlow with its Backstage external-access service credential
  through deployment secrets, not workflow input.
- Teach the workflow to fetch an access token at the actual external-call
  boundary.
- Apply the same behavior to execution, event-triggered execution, and
  retriggering.
- Mark the raw-token flow deprecated only after the grant path is proven.

The additive path is required by the acceptance criterion that existing auth
interfaces and plugins continue to work without modification.

### 7. Verify behavior and security

Unit tests:

- Encryption/decryption, tamper detection, key selection, and rotation.
- Database mapping, uniqueness, transactions, revocation, and expiry.
- Grant enforcement before decryption.
- Provider refresh success, token rotation, transient failure, and permanent
  revocation.
- Secret-safe errors and logging.

Backend integration tests:

- Run routes with real Backstage user and service credentials.
- Prove that caller identity cannot be spoofed through request data.
- Prove that one caller cannot use another caller's grant.
- Prove that revoked and expired grants are rejected.
- Exercise two broker instances against one database.
- Run migration tests on SQLite and PostgreSQL.

Orchestrator integration tests:

- No raw provider token appears in browser-to-Orchestrator or
  Orchestrator-to-SonataFlow execution requests.
- A workflow queued beyond the original access-token lifetime succeeds by
  refreshing at call time.
- A grant revoked after execution but before provider access is denied.
- Existing raw-token execution continues to work while compatibility mode is
  enabled.

Release verification:

- Package-level tests for affected packages.
- Workspace TypeScript, Prettier, lint, API-report, and dedupe gates.
- Changesets for published packages.
- Dynamic-plugin export and RHDH wiring validation.
- Security-team review and recorded sign-off.

## Acceptance-criteria traceability

| Jira acceptance criterion                       | Planned evidence                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Working backend plugin in `rhdh-plugins`        | Dedicated provider-token backend package and runnable test backend                       |
| Provider tokens stored in an encrypted database | Migrations, authenticated encryption, key-rotation support, and database tests           |
| REST retrieval and refresh using user grants    | Service-authenticated routes using opaque caller-bound grants                            |
| Existing auth interfaces continue to work       | Disabled-by-default feature flag and additive Orchestrator contract                      |
| Core integration points verified                | Compile/runtime seam experiments and decision record                                     |
| Security concerns documented and validated      | Threat model, abuse cases, key-management design, audit design, and security sign-off    |
| Basic integration and unit tests                | Crypto, persistence, authorization, provider, multi-instance, and delayed-workflow tests |

## Proposed follow-on implementation breakdown

### Story 1: Provider-token module foundation

- Scaffold the workspace and packages.
- Define the service interface and configuration.
- Register the service factory and test backend.
- Record the selected Backstage extension strategy.

### Story 2: Encrypted connection storage

- Add migrations and database implementation.
- Add authenticated encryption and key rotation.
- Add GitHub and Microsoft provider adapters.
- Cover storage and refresh behavior with unit tests.

### Story 3: Consent and grant broker

- Add persistent connect sessions.
- Implement consent, grant, retrieval, revocation, and disconnect routes.
- Add service-identity and authorization tests.
- Add safe audit events.

### Story 4: Orchestrator and SonataFlow integration

- Add the grant-based Orchestrator contract.
- Remove raw-token transmission from the opted-in path.
- Configure SonataFlow call-time retrieval.
- Add delayed execution and revocation integration tests.

### Story 5: Hardening and upstream transition

- Complete threat-model and security reviews.
- Validate PostgreSQL and multi-replica behavior.
- Export and wire the dynamic plugin for RHDH.
- Prepare the upstream Backstage interface proposal and migration plan.
- Define deprecation criteria for the compatibility raw-token path.

## Open decisions

1. Confirm with Orchestrator and SonataFlow owners that SonataFlow owns
   call-time retrieval.
2. Confirm whether the first prototype uses an independent connect flow or
   replaces selected registered auth providers.
3. Decide whether grants are reusable per caller/provider or bound to a single
   workflow instance.
4. Select the production key-management and rotation mechanism.
5. Define the behavior for providers that cannot issue refreshable user
   credentials.
6. Decide how scope escalation triggers new consent.
7. Define retention and cleanup policies for unused connections, grants, and
   expired connect sessions.

## References

- [RHIDP-15907](https://redhat.atlassian.net/browse/RHIDP-15907)
- [Provider-token upstream proof of concept](https://github.com/sonjaer/backstage/pull/1)
- [Backstage #30066: Support long-lasting sessions issued by auth-backend](https://github.com/backstage/backstage/issues/30066)
- [Backstage service-to-service authentication](https://backstage.io/docs/auth/service-to-service-auth)
