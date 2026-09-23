# Suggested PR title

`feat(orchestrator): add secure provider token grant prototype (RHIDP-15907)`

# PR description

## Summary

This PR adds an opt-in secure provider-token storage prototype for
RHIDP-15907 and integrates opaque provider grants with Orchestrator.

Users explicitly connect and authorize an OAuth provider, approve a grant for
a trusted service, and retain control over refreshing, revoking, or
disconnecting that access. Provider access and refresh tokens are encrypted in
the Backstage database. Orchestrator receives only opaque grant references;
the workflow exchanges a grant for a usable access token at provider-call
time.

The existing Orchestrator `authTokens` flow remains available and unchanged.
The grant-based path is additive and is used only by workflows that opt in.

## Why

Orchestrator currently captures provider tokens in the browser and forwards
them when a workflow starts. That token can expire while a workflow is queued
or before a long-running workflow reaches the provider call.

This prototype moves token storage and refresh into a broker and establishes a
call-time contract:

```text
User -> OAuth provider -> secure-token-storage broker -> encrypted database
                                      ^
                                      |
                        service credential + opaque grant
                                      |
                                  workflow
```

Refresh tokens remain inside the broker. Provider token material is not placed
in Orchestrator requests, workflow input, workflow state, browser storage, or
workflow output.

## What changed

### Secure token storage workspace

- Adds `workspaces/secure-token-storage` with publishable frontend, node, and
  backend plugin packages plus a full-stack Backstage sample application.
- Defines a root-scoped `SecureTokenStorageService` contract with stable,
  secret-safe error codes.
- Keeps the feature disabled unless `secureTokenStorage.enabled` is set.
- Adds configuration for allowed service subjects, OAuth providers, exact
  redirect URI allowlists, user connection defaults, consent redirects, and
  encryption keys.
- Adds database migrations and repositories for provider connections,
  single-use OAuth sessions, caller-bound grants, and audit events.

### Encrypted persistence and provider refresh

- Encrypts access and refresh tokens with AES-256-GCM.
- Binds encrypted values to record metadata through authenticated associated
  data.
- Supports an active encryption key and previous keys for key rotation.
- Adds GitHub and Microsoft OAuth authorization-code adapters with PKCE.
- Configures the GitHub sample to request `read:user`, `repo`, and `read:org`
  for profile, private repository, and organization discovery. The
  documentation calls out that the classic OAuth App `repo` scope also grants
  write access because GitHub does not provide a read-only private repository
  scope.
- Refreshes expired provider access tokens inside the broker and persists
  rotated access and refresh tokens atomically.
- Never returns refresh tokens through the public service or HTTP routes.

### OAuth connection, consent, and grant lifecycle

- Persists short-lived, single-use OAuth connection state and PKCE verifiers.
- Adds authenticated routes to:
  - start provider connections as a service or signed-in user;
  - process provider callbacks;
  - approve or reject consent;
  - list, refresh, and revoke grants;
  - disconnect a provider and revoke its grants; and
  - exchange an opaque grant for a provider access token as an authenticated
    service.
- Derives caller and user identities from verified Backstage credentials
  instead of caller-supplied identity fields.
- Binds grants to the user, service subject, provider, scopes, expiry, and
  optional workflow instance.
- Adds safe audit events for connection, consent, token use, refresh,
  revocation, denial, and disconnect operations.
- Adds secret-safe INFO logs for each access-token endpoint request and for
  expired provider-token refresh attempts.
- Clears the connection revocation state when a user reconnects a provider.

### Provider connections frontend plugin and sample host

- Adds a New Frontend System plugin that provides the provider connections and
  consent page.
- Registers the frontend plugin as a workspace dependency of the sample
  application so the existing route and navigation remain available.
- Starts the GitHub OAuth flow in the browser without exposing the trusted
  service credential.
- Displays active grant IDs, providers, scopes, and expiration times.
- Supports grant refresh, revocation, and provider disconnect actions.
- Removes revoked grants from the active list and hides the connection action
  after a successful connection.
- Adds a secure-token-storage navigation item alongside the sample's existing
  RHDH navigation.
- Configures GitHub sign-in and local catalog entities for the test user.
- Includes the Orchestrator frontend/backend plugins and local Podman
  SonataFlow configuration.
- Adds a combined `yarn dev` command for local development.

### Additive Orchestrator integration

- Adds an optional `providerTokenGrants` field to workflow execute and
  retrigger requests while preserving `authTokens`.
- Regenerates the Orchestrator OpenAPI clients, documentation, and API reports.
- Adds `providerTokenGrantExtensionPoint` so a backend module can register the
  provider-grant resolver.
- Registers secure token storage as Orchestrator's provider-grant resolver.
- Extracts explicit top-level `grantId` and `provider` workflow form values
  into the grant contract without removing them from normal workflow input.
- Resolves an active grant for the initiating Backstage user when the form
  omits `grantId`. Provider-less resolution succeeds only when the user's
  active grant is unambiguous.
- Sends opaque references to normal workflow execution in both:
  - `X-Provider-Token-Grant-<Provider>`; and
  - the aggregate `X-Provider-Token-Grants` header.
- Includes grant references in event-triggered CloudEvent data and forwards
  them during workflow retriggering.
- Does not resolve or transmit provider access tokens from the Orchestrator
  backend.

### Documentation

- Records why this prototype uses an additive broker and separate OAuth
  connect flow instead of overriding `coreServices.auth`.
- Documents the implementation plan, current status, trust boundaries, and
  component/sequence flows.
- Adds a consolidated local testing guide covering:
  - dependency and OAuth application setup;
  - GitHub connection and consent;
  - grant lifecycle operations;
  - direct broker validation;
  - expired access-token refresh testing;
  - the standalone provider-token workflow; and
  - running that workflow through the Orchestrator UI without using `curl`.

## Security and trust boundary

- The browser and Orchestrator handle opaque grant references only.
- The broker derives the caller subject from an authenticated Backstage
  service credential.
- Grant authorization is checked before provider token material is decrypted.
- Access and refresh tokens are encrypted at rest.
- Refresh tokens never leave the broker.
- Access tokens are returned only to an authorized service and are intended to
  exist only in memory at the provider-call boundary.
- Token values, authorization codes, OAuth response bodies, and ciphertext are
  excluded from application logs and audit records.
- Redirect URIs and service subjects are controlled by explicit allowlists.

## Compatibility and rollout

- Secure token storage is opt-in and disabled unless configured.
- Existing Backstage authentication providers and sign-in flows are not
  replaced.
- Existing Orchestrator `authTokens` request and forwarding behavior remains
  supported.
- The provider-grant fields are optional, so workflows that do not use secure
  token storage continue to run as before.
- This implementation intentionally does not override `coreServices.auth`.
  Backstage's current auth service handles Backstage request and
  service-to-service credentials; it does not expose a provider-token
  persistence seam. The decision and proposed upstream extension are
  documented in `docs/rhidp-15907-extension-seam.md`.

## Test coverage added

- AES-GCM encryption/decryption, integrity checks, and key selection.
- Database mapping and provider connection, session, grant, revocation,
  refresh, reconnect, and audit behavior.
- GitHub and Microsoft authorization-code and refresh adapters.
- Route authentication, validation, safe errors, callback redirects, consent,
  grant management, and token retrieval.
- Browser API client and provider connections page behavior.
- Orchestrator API serialization, frontend grant extraction, explicit grant
  forwarding, automatic grant resolution, provider-specific headers, event
  data, and retriggering.

## Validation before opening the PR

Record the final results here after the branch is ready for review:

- [ ] Secure-token-storage TypeScript and full unit test suites pass.
- [ ] Secure-token-storage Prettier, lint, build, and API-report checks pass.
- [ ] Orchestrator TypeScript and affected unit test suites pass.
- [ ] Orchestrator Prettier, lint, build, and API-report checks pass.
- [ ] The local GitHub connect, approve, retrieve, refresh, revoke, reconnect,
      and disconnect flow passes.
- [ ] The provider-token-grant workflow succeeds through the Orchestrator UI
      with an explicit grant ID.
- [ ] The same workflow succeeds with backend grant auto-resolution when the
      form omits the grant ID.
- [ ] Revoked and expired grants are rejected without leaking token material.
- [ ] Legacy Orchestrator workflows that use `authTokens` still execute.

## Known limitations and follow-up work

- The separate OAuth connect flow does not transparently capture tokens from
  an existing Backstage provider sign-in session. That requires a future
  upstream provider-token storage extension in Backstage auth.
- The local sample uses an in-memory SQLite database. PostgreSQL,
  multi-replica, and migration-upgrade validation remain follow-up work.
- Dynamic-plugin export, production RHDH wiring, deployment-secret guidance,
  and package publication still need release validation.
- Formal threat-model review and security-team sign-off are still required.
- Cleanup and retention policies for expired sessions, unused connections,
  grants, and audit events remain to be defined.
- End-to-end Playwright coverage and delayed/queued workflow tests remain to be
  added.
- The SonataFlow `10_provider_token_grant` demo is maintained in the companion
  `orchestrator-demo` repository and is not included in this PR.

## Issue

- [RHIDP-15907](https://redhat.atlassian.net/browse/RHIDP-15907)

#### :heavy_check_mark: Checklist

- [x] Changesets describe the affected published packages.
- [x] Documentation is added or updated.
- [x] Unit and regression coverage is added for the new behavior.
- [ ] Screenshots of the provider connections page and successful
      Orchestrator workflow run are attached.
