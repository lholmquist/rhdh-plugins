# Secure Token Storage and Provider Token: Implementation Comparison

This document compares the two implementations currently in this repository.
They address the same basic workflow—connect an OAuth provider, approve a grant,
and let an authorized workflow obtain a short-lived access token—but Provider
Token is a separate, more modular implementation. It is not an add-on to Secure
Token Storage, and there is no automatic migration between them.

## What they have in common

Both implementations keep provider connection separate from RHDH sign-in,
require user approval for a workflow grant, bind token issuance to the grant's
authorized service caller, support grant revocation and expiration, and refresh
provider credentials on the backend. Ordinary RHDH logout does not revoke a
provider connection or its grants.

## Main differences

| Area                                       | Secure Token Storage                                                                                                                                                                | Provider Token                                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace and packaging**                | The existing prototype packages its frontend, node API, and backend under `workspaces/secure-token-storage`.                                                                        | A separate workspace under `workspaces/provider-token`, split into common, node, frontend, backend, provider adapter modules, and an optional Orchestrator module.                                                                                |
| **Grant/client model**                     | Grants are associated with a user, provider, caller subject, scopes, and optional workflow instance. Caller subjects are allowed through backend configuration.                     | Grants also record a configured client ID. Each client can have its own allowed service subjects and consent purpose, which is shown in the approval flow.                                                                                        |
| **When credentials become persistent**     | After the provider callback exchanges the authorization code, both access and refresh credentials are stored encrypted; the user then approves or rejects the local workflow grant. | The callback keeps the access token transient and stages the encrypted refresh token in the short-lived consent session. Approval promotes it to the persistent provider secret; rejection does not create a persistent connection.               |
| **Access-token persistence and refresh**   | Both access and refresh tokens are encrypted at rest. A valid stored access token is reused; an expired one is refreshed and the updated access and refresh credentials are stored. | Only the refresh token is persisted encrypted. Access tokens stay in process memory, are reused from a short-lived cache, and are refreshed before their safety window. Refresh coordination uses in-process single-flight plus database locking. |
| **Provider adapters**                      | GitHub and Microsoft adapters are implemented together in the Secure Token Storage backend.                                                                                         | GitHub and Microsoft are separate backend modules registered through a provider-adapter extension point.                                                                                                                                          |
| **Orchestrator integration and sample UI** | The Secure Token Storage backend feature loader includes its Orchestrator module, and its sample app includes the Orchestrator frontend.                                            | Orchestrator integration is a separate optional module. The Provider Token sample app only includes the Provider Token UI; it does not include the Orchestrator frontend or load the optional module.                                             |
| **Permissions and audit**                  | The backend validates user ownership and the configured service caller. It also persists audit events such as grant use, denial, refresh, and revocation.                           | The backend uses explicit Backstage permission checks and a versioned API. It does not currently have an equivalent persisted audit-event model.                                                                                                  |
| **API and data compatibility**             | Uses the Secure Token Storage plugin's API routes and database schema.                                                                                                              | Uses a separate versioned API and Provider Token schema. Existing Secure Token Storage grants and encrypted credentials are not automatically visible or usable here.                                                                             |

## Orchestrator behavior

Automatic grant lookup is not unique to Provider Token: Secure Token Storage
already supplies a resolver through its Orchestrator module. Provider Token
implements its resolver in a separate backend module and uses the Provider Token
API to look up a grant. The sample workflow can also continue to receive an
explicit `grantId` as input or a header and call the Provider Token token
endpoint itself.

Both modules register the same Orchestrator grant-resolver extension point, so
only one should be enabled in a given backend. The Provider Token sample app
does not include the Orchestrator UI; to run a workflow visually, use an
Orchestrator-enabled RHDH app configured with the Provider Token backend and,
when needed, its optional Orchestrator module.

## Practical implication

Provider Token is best understood as a parallel implementation with a more
explicit client model, separately installable provider adapters, permission
checks, and a refresh design that avoids persisting access tokens. Secure Token
Storage remains the more directly integrated sample for launching workflows
from its bundled Orchestrator UI and currently has persisted audit events.

Because the two implementations have separate schemas, APIs, and encryption
contexts, switching between them requires reconnecting providers and issuing
new grants. Migrating existing grants or credentials is not implemented. Do
not load both Orchestrator resolver modules in the same backend.

## Source references

- [Secure Token Storage backend service](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/service.ts)
- [Secure Token Storage Orchestrator module](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/orchestrator-module.ts)
- [Secure Token Storage sample frontend](../workspaces/secure-token-storage/packages/app/src/App.tsx)
- [Provider Token backend service](../workspaces/provider-token/plugins/provider-token-backend/src/token-service.ts)
- [Provider Token Orchestrator module](../workspaces/provider-token/plugins/provider-token-backend-module-orchestrator/src/module.ts)
- [Provider Token sample frontend](../workspaces/provider-token/packages/app/src/App.tsx)
