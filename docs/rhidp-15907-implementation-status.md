# RHIDP-15907 implementation status

Status reviewed on 2026-09-07 against [RHIDP-15907](https://redhat.atlassian.net/browse/RHIDP-15907), the implementation plan, and the current repository state.

## Summary

The secure-token-storage foundation is largely implemented. The remaining work
is primarily end-to-end Orchestrator/SonataFlow integration, validation, and
security/release completion.

## Jira acceptance criteria

| Jira criterion                               | Status                                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend plugin in `rhdh-plugins`             | Partially met. A working standalone backend plugin exists, but it does not override `coreServices.auth`.                                                                                        |
| Encrypted database token storage             | Mostly met for the new OAuth connect flow. AES-GCM storage, key versions, migrations, and refresh logic exist. Existing browser auth sessions are not transparently captured.                   |
| REST retrieval/refresh using grants          | Implemented at `/api/secure-token-storage/token`; end-to-end workflow usage is not complete.                                                                                                    |
| Existing auth APIs/plugins remain compatible | Additive APIs preserve the legacy `authTokens` path. Full compatibility regression testing remains.                                                                                             |
| Core auth extension points verified          | The investigation is complete, but it showed that the current Backstage auth service is not the correct provider-token persistence seam. This criterion conflicts with the chosen architecture. |
| Security documented and validated            | Threat model and security rules are documented, but formal security-team review/sign-off is still missing.                                                                                      |

## Completed work

- Secure-token-storage workspace, node contract, backend plugin, and sample
  Backstage host.
- AES-256-GCM encrypted access and refresh-token persistence.
- Key-version support and authenticated associated data.
- Persistent PKCE connect sessions.
- GitHub and Microsoft OAuth adapters.
- Consent, grants, revocation, disconnect, refresh, and audit routes.
- Provider connections UI.
- Orchestrator `providerTokenGrants` API contract.
- Opaque grant forwarding for normal execution, event execution, and
  retriggering.
- Orchestrator extension point and secure-token-storage module registration.
- SonataFlow prototype workflow that retrieves a token at provider-call time.

## Remaining implementation

### 1. Complete the SonataFlow consumer

The workflow runtime must consume `X-Provider-Token-Grants`, call the broker
with its Backstage service credential, and inject the short-lived token directly
into the provider request. The current prototype accepts the grant as workflow
input, so the header-to-runtime mapping is still missing.

### 2. Finish the Orchestrator user flow

The Orchestrator UI/API still needs to initiate provider connection, direct the
user through consent, select or associate the resulting grant with a workflow,
and pass that grant reference during execution.

### 3. Add end-to-end integration tests

- Queued execution after the original token expires.
- Refresh during provider access.
- Revoked grant rejection.
- Caller-subject spoofing prevention.
- Real Backstage user/service credentials.
- PostgreSQL and multi-replica behavior.
- Legacy raw-token compatibility.

### 4. Complete security validation

The existing documentation needs formal threat-model review and security-team
sign-off, especially around server-held refresh tokens, key management, grant
lifetime, revocation, and audit retention.

### 5. Finish production hardening and release work

- Dynamic-plugin export and RHDH wiring.
- Package publication.
- API reports and changesets.
- Playwright coverage.
- Deployment-secret documentation.
- Cleanup policies for connections, grants, and expired sessions.
- Upstream Backstage extension proposal.

## Immediate next coding slice

Implement and test the SonataFlow runtime adapter that converts the forwarded
opaque grant reference into a call-time broker request without placing token
material in workflow state or logs.

## Architecture decision requiring Jira alignment

The Jira acceptance criteria require a `coreServices.auth` override, while the
implementation decision record concludes that the current Backstage auth service
does not provide the appropriate provider-token persistence seam. This criterion
should either be revised to describe the additive broker architecture or treated
as future upstream work.

## Source documents

- [Implementation plan](./rhidp-15907-implementation-plan.md)
- [Extension-seam decision](./rhidp-15907-extension-seam.md)
- [Secure-token-storage and Orchestrator flow](./rhidp-15907-secure-token-storage-flow.md)
- [RHIDP-15907 in Jira](https://redhat.atlassian.net/browse/RHIDP-15907)
