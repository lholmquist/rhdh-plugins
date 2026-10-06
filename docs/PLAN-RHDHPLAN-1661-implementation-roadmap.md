# Implementation roadmap for RHDHPLAN-1661

Status: superseded by [the new provider-token workspace plan](./PLAN-RHDHPLAN-1661-provider-token-workspace.md). This draft targeted the existing secure-token-storage workspace and should not guide implementation.  
Prepared: 2026-10-02  
Target: rhdh-plugins/workspaces/secure-token-storage  
Feature: [RHDHPLAN-1661 — Secure short-lived user tokens for queued and long-running Orchestrator workflows](https://issues.redhat.com/browse/RHDHPLAN-1661)  
Source document: [PLAN-RHIDP-1661.md](./PLAN-RHIDP-1661.md)

## Why this roadmap is separate

The source document is an early provider-token POC proposal. It says to create a
separate repository, names the plugin provider-token, and proposes a delegation
record distinct from a grant. Since then, the implementation has been built in
this repository and workspace, and product decisions have been made about the
Orchestrator contract. This roadmap translates the feature goals into work
against the current code. It preserves the source document for historical
design context.

There is also a Jira key mismatch in the source document: RHIDP-1661 is a
documentation sub-task about EKS support. The token-storage feature is
RHDHPLAN-1661, a Feature currently marked In Progress. Use RHDHPLAN-1661 when
mapping implementation progress to acceptance criteria.

## Product and architecture decisions carried forward

| Topic                              | Direction for this implementation                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placement                          | Keep the feature in this repository under workspaces/secure-token-storage, as previously requested.                                                                                                                                    |
| Plugin identity                    | Keep the existing secure-token-storage package and plugin ID.                                                                                                                                                                          |
| Workflow reference                 | Keep the approved opaque grantId as the workflow reference. Orchestrator may receive it in input or in the header and exchange it at call time. Do not add a separate delegation table unless a later requirement demonstrates a need. |
| User identity and provider consent | RHDH login and provider connection remain independent. Logging out does not revoke provider connections or grants. Consent remains explicit and user-owned.                                                                            |
| Token handling in workflows        | Pass only the opaque grant reference through workflow state. Retrieve the short-lived access token at execution time; do not put refresh tokens or consent-session material in workflow state.                                         |
| Admin grant screen                 | Keep cross-user administration in its own future plan. It is not needed to complete the user and Orchestrator flow in this roadmap.                                                                                                    |
| Existing contracts                 | Preserve the current /token and root-scoped SecureTokenStorageService contracts while closing gaps. Any incompatible change needs an explicit consumer migration plan.                                                                 |

The source document's refresh-only persistence proposal differs from the current
implementation, which encrypts both access and refresh tokens at rest. Do not
change this storage model as part of routine hardening. First record a security
and product decision about whether encrypted access-token persistence remains
acceptable for the deployment and its threat model.

## Current implementation baseline

The current workspace already provides:

- AES-256-GCM encryption for provider credentials, versioned encryption keys,
  and associated data bound to the connection and token kind.
- PKCE-based provider connection, single-use state, explicit approval, and
  owner-scoped connection and grant management.
- GitHub and Microsoft OAuth adapters and refresh paths.
- Opaque, caller-bound grants with expiry, refresh, and revoke operations.
- A service-authenticated POST /token endpoint that checks the grant, provider,
  caller subject, expiry, and revocation before returning an access token.
- A root-scoped backend interface consumed by the Orchestrator integration,
  plus grant resolution when the workflow does not supply a grant ID.
- Audit events, local sample application, Settings integration, and local
  testing documentation.

These are existing capabilities to preserve and verify during the remaining
work, not phases to rebuild from scratch.

## Acceptance-criteria trace

| RHDHPLAN-1661 acceptance criterion                                                                    | Current assessment                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Queued/long-running Orchestrator workflows obtain fresh GitHub and Microsoft user tokens at call time | The call-time exchange and refresh path exist. Refresh rotation and concurrent requests need hardening before relying on long-running queued workloads.                                                                              |
| No PAT or other long-lived personal token is the product path                                         | Needs work: OAuth exchange currently permits responses without a refresh token or expiry. Reject non-refreshable/non-expiring credentials before they can be approved for workflow use.                                              |
| Refresh/consent material stays out of SonataFlow state                                                | The grant reference is the call-time reference. Preserve input/header compatibility and verify no access or refresh token is written into workflow state.                                                                            |
| Users explicitly consent to background use                                                            | The connect and approval flow exists. Keep provider, caller, and requested scopes visible to the user.                                                                                                                               |
| Revocation or refresh failure gives a clear actionable error without retry loops                      | Grant and provider errors have machine-readable codes. Provider refresh failures currently collapse to a generic failure and do not locally revoke grants on a provider-reported invalid grant; improve classification and handling. |
| Architecture spike records storage, responsibility, and trust decisions                               | The source plan records an earlier design. This roadmap updates the decision for the implemented workspace and grantId contract; attach it to the Feature's implementation record.                                                   |
| Implementation delivers platform consumption and runtime integration                                  | The secure-token-storage backend and Orchestrator module are present. Confirm dynamic-plugin exports and runtime wiring remain aligned with the current Orchestrator consumer.                                                       |
| Orchestrator authentication documentation is updated                                                  | Local testing guidance exists. Audit the Orchestrator AuthRequester/long-running workflow docs and update the canonical docs if they do not cover this flow.                                                                         |
| Security review of server-held refresh tokens is completed and tracked                                | Not established by this repository inspection. Treat the review, including the RHIDP-15381 concerns named by the Feature, as a release gate and record its outcome.                                                                  |

## Proposed implementation slices

### Slice 1 — Make OAuth credentials refreshable by construction

The feature promises short-lived access tokens that can be renewed after a queued
wait. The current OAuth exchange accepts optional refresh tokens and optional
expiry times, so an identity-provider response can create a connection that
cannot satisfy that promise.

- Require a refresh token and a valid expiry for provider connections that will
  issue workflow grants. Fail the connect before storing credentials when the
  provider cannot supply both.
- Keep provider-specific validation in the provider adapter; return a safe,
  actionable error code without including provider response bodies or secrets.
- Cover GitHub's expiring-user-token configuration and Microsoft offline access
  in the setup guide.
- Preserve the no-PAT product path and explain which OAuth app configuration is
  required.

**Exit criteria:** a connection without refresh material or expiry cannot be
approved for workflow use; a successful connection can be refreshed through
the existing grantId exchange.

### Slice 2 — Make refresh rotation safe under load and provider revocation

The refresh path currently calls the provider and then updates the connection
row without a cross-request row lock or single-flight mechanism. Rotating
refresh tokens can fail when multiple queued workflow tasks request a token at
the same time.

- Serialize refresh for a connection. Use a database transaction and row lock
  where supported, with an in-process single-flight path for SQLite/local use.
- Persist a rotated refresh token and its new access token/expiry before
  returning the access token to the caller.
- If persistence fails after rotation, do not return the newly issued access
  token as though the connection were safely reusable.
- Preserve provider error codes internally long enough to identify
  invalid_grant or equivalent revocation. Revoke the local connection and its
  grants, record a safe audit event, and return a non-retryable, actionable
  error. Do not retry in a loop.
- Ensure refresh and revocation cannot race in a way that returns a token after
  the grant or connection was revoked.

**Exit criteria:** simultaneous refresh requests do not reuse a rotated refresh
token; a failed persistence write never returns a token; provider revocation
prevents subsequent token retrieval and is visible to the user.

### Slice 3 — Enforce the permission contract for token issuance

The source plan calls for Backstage permission authorization so deployment
restrictions on an external service credential can limit access to token
issuance. The current route authenticates a service principal and validates
the grant's bound caller subject, but it does not call the permission service.

- Define and register secure-token-storage permissions for token issuance and
  owner-scoped grant read/revoke operations.
- Call permissions.authorize with the verified request credentials on the
  corresponding routes. A deny or conditional result must fail closed.
- Keep local checks even when permission authorization is unavailable or
  returns allow: service principal type, configured caller allowlist, grant
  owner, grant caller subject, provider, expiry, and revocation.
- Configure the sample app with a policy that demonstrates an allowed caller
  and a denied caller. Do not rely on an allow-all development policy as proof
  of enforcement.

**Exit criteria:** an unauthenticated request, user principal on the service
route, unlisted service, permission-denied service, wrong grant owner, wrong
provider, expired grant, and revoked grant cannot retrieve a token.

### Slice 4 — Add provider-module registration at a stable seam

The current GitHub and Microsoft adapters are instantiated directly by the
secure-token-storage service factory. The source plan proposes independently
registered provider modules so provider-specific OAuth behavior stays out of
the storage and grant logic.

- Move the provider adapter contract to a package/interface that backend
  modules can implement.
- Add a secure-token-storage provider extension point and register GitHub and
  Microsoft modules through it.
- Reject duplicate provider IDs at startup and fail closed when a configured
  provider has no installed adapter.
- Keep storage, consent, grant enforcement, refresh serialization, and audit in
  the core secure-token-storage implementation.
- Defer a generic OAuth2 adapter and additional providers until a named
  provider is required. Keep this slice focused on the two providers in the
  Feature acceptance criteria.

**Exit criteria:** GitHub and Microsoft can be enabled or disabled as modules
without editing the token-storage service, and duplicate or missing adapters
produce clear startup or connect errors.

### Slice 5 — Close the consumer, documentation, and security-review loop

- Keep Orchestrator's current grantId behavior: accept the reference from
  supported input/header paths, resolve it for the initiating user when absent,
  and exchange it at execution time.
- Exercise the workflow with the grant ID in input and in the header, then
  with no grant ID supplied; confirm backend lookup and call-time exchange.
- Update the canonical Orchestrator AuthRequester documentation for queued and
  long-running execution, required provider scopes, consent, and refresh
  failure behavior.
- Keep the local testing guide aligned with the sample config and workflow
  demo; document provider token expiry and invalidation tests.
- Complete and track the server-held refresh-token security review. Record
  required mitigations and owners before release.
- Review exported plugin packages, configuration schemas, changesets, and
  deployment wiring for the target RHDH release.

**Exit criteria:** a fresh local setup can demonstrate the full provider
connection, explicit approval, queued execution, call-time token refresh,
revocation, and actionable failure path without using curl as the normal
workflow path; docs and security review are complete.

## Recommended order and first coding slice

Start with Slice 1, then Slice 2. They close the most direct mismatch with the
Feature's short-lived-token and no-PAT acceptance criteria. Implement Slice 3
before making the token endpoint available to additional consumers. Add provider
module registration after the token lifecycle and permission behavior are
stable. Finish with Slice 5 and the security review.

The first code change should be Slice 1: reject OAuth connect results without a
refresh token and expiry, return a stable safe error to the UI, and document
the provider setup prerequisites. Keep the current storage and grantId
interfaces stable in that slice.

## Deferred work

- Cross-user grant administration; tracked in its own plan.
- A generic OAuth provider module and providers beyond GitHub and Microsoft.
- Scaffolder or other consumers.
- A new delegation table or replacement of the current grant ID.
- Azure OBO exchange.
- Replacing the current encrypted access-token persistence model before a
  separate threat-model decision.
- Upstream Backstage core changes or migration of this plugin into
  @backstage/plugin-auth-node.

## Sources and evidence

- [RHDHPLAN-1661 Feature](https://issues.redhat.com/browse/RHDHPLAN-1661) —
  current acceptance criteria and status.
- [Original POC design](./PLAN-RHIDP-1661.md) — retained as the design-history
  reference.
- [Authentication Providers integration plan](./rhidp-1661-authentication-providers-integration-plan.md) —
  Settings integration findings and implementation phases.
- Current implementation inspected in workspaces/secure-token-storage,
  including the backend service, OAuth adapters, repository, plugin route,
  Orchestrator module, sample app, and local testing guide.
