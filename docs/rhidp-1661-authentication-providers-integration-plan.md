# RHIDP-1661 Authentication Providers Integration Plan

Status: research and implementation plan  
Target repository: `rhdh-plugins`  
Target workspace: `workspaces/secure-token-storage`  
Reference plan: [PLAN-RHIDP-1661.md](./PLAN-RHIDP-1661.md)

## Decision summary

The secure-token-storage provider connection flow can be integrated into the
RHDH **Settings > Authentication Providers** experience. A user who established
their Backstage identity with provider A can separately authorize provider B for
workflow use.

This is already an explicit RHDH deployment pattern. RHDH documents configuring
a primary provider for the Developer Hub identity and an auxiliary provider,
such as GitHub with `disableIdentityResolution: true`, that the signed-in user
connects from **Settings > Authentication Providers**. Secure token storage can
join that surface without changing which provider established the user's RHDH
identity.

That integration must remain two distinct security flows:

1. A Backstage authentication-provider session signs the user into Backstage or
   gives browser code access to a third-party API.
2. A secure-token-storage connection obtains an offline credential, stores it in
   the backend, asks for explicit workflow consent, and later exchanges an opaque
   `grantId` for a current access token on behalf of an authenticated service.

The recommended target UX is one Authentication Providers page with two clearly
labeled sections:

- **Backstage authentication sessions**: the existing Backstage provider rows
  and their Sign in/Sign out actions.
- **Workflow provider connections**: secure-token-storage Connect, Disconnect,
  consent, grant, refresh, and revoke actions.

The native provider-row adapter was prototyped and rejected. Its fixed **Sign
in/Sign out** session semantics make an explicit workflow disconnect look like
ordinary logout and risk coupling RHDH authentication to destructive grant
revocation. The selected implementation is an opt-in New Frontend System module
that supplies an aggregate `providerSettings` element. The aggregate renders the
existing authentication-provider settings unchanged and adds a separately
labeled workflow-provider section with explicit Connect, Disconnect, Refresh,
and Revoke actions.

If the target RHDH distribution already has another owner for the singleton
`providerSettings` input, the safe fallback is a dedicated **Settings > Workflow
Provider Connections** subpage. It is not a `SessionApi` adapter.

Neither selected path replaces Backstage provider behavior with
secure-token-storage behavior. In particular, RHDH global logout and ordinary
provider logout never invoke a secure-token-storage disconnect or revoke
operation.

There is an important constraint: in the installed Backstage version, the
`providerSettings` input is optional but `singleton: true`. It replaces the
default provider list rather than appending to it. The exact-tab integration is
therefore safe only when RHDH controls the single aggregate and no other module
owns that slot. If that cannot be guaranteed, the fallback is a dedicated
**Settings > Workflow Provider Connections** subpage, not an unsafe competing
override.

No Orchestrator or SonataFlow contract changes are required. The existing
`grantId` forwarding and exchange remain unchanged.

## Research scope and source baseline

This plan was based on the exact packages installed in the secure-token-storage
workspace and the existing implementation:

- `@backstage/plugin-user-settings` 0.9.6
- `@backstage/frontend-plugin-api` 0.18.0
- `@backstage/core-app-api` 1.20.4
- `@backstage/core-plugin-api` 1.12.9
- The current secure-token-storage frontend, backend, sample application, and
  configuration in this repository

The direct dependencies are recorded in the sample app
[`package.json`](../workspaces/secure-token-storage/packages/app/package.json),
and exact resolved versions are recorded in the workspace
[`yarn.lock`](../workspaces/secure-token-storage/yarn.lock).

Primary sources:

- Backstage documents authentication as having two distinct purposes: user
  sign-in/identity and delegated access to third-party resources. It also states
  that an app can configure multiple providers, typically using one for sign-in
  and the others for external-resource access. See the official
  [Authentication in Backstage](https://backstage.io/docs/auth/) documentation.
- RHDH documents the exact primary-provider/auxiliary-provider use case,
  including `disableIdentityResolution: true` for an auxiliary GitHub provider
  and connecting it from Settings:
  [Enable authentication with external services](https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.10/html/authentication_in_red_hat_developer_hub/enable-authentication-with-external-services_authentication-in-rhdh).
- RHDH also documents an additive dynamic-plugin `providerSettings`
  configuration whose `provider` value resolves an API reference and produces a
  row in the Authentication Providers tab:
  [Adding custom authentication provider settings](https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.10/html/installing_and_viewing_plugins_in_red_hat_developer_hub/front-end-plugin-wiring_plugins-in-rhdh#adding-custom-authentication-provider-settings_front-end-plugin-wiring).
- The installed Authentication Providers implementation discovers configured
  providers from `auth.providers`, then renders either its default provider list
  or a supplied replacement:
  [`UserSettingsAuthProviders.tsx`](https://github.com/backstage/backstage/blob/master/plugins/user-settings/src/components/AuthProviders/UserSettingsAuthProviders.tsx).
- Each default provider row independently observes its provider API's session
  state and invokes that API's `signIn()` or `signOut()`:
  [`ProviderSettingsItem.tsx`](https://github.com/backstage/backstage/blob/master/plugins/user-settings/src/components/AuthProviders/ProviderSettingsItem.tsx).
- The New Frontend System Authentication Providers subpage exposes one optional,
  singleton `providerSettings` React-element input:
  [`plugins/user-settings/src/alpha.tsx`](https://github.com/backstage/backstage/blob/master/plugins/user-settings/src/alpha.tsx).
- The legacy frontend accepts a `providerSettings` prop, which likewise replaces
  the default list. It also supports additional tabs through
  `SettingsLayout.Route`:
  [`plugin-user-settings/README.md`](https://github.com/backstage/backstage/blob/master/plugins/user-settings/README.md).
- Backstage describes subpages as tabbed children of a parent page. See
  [Common Extension Blueprints](https://backstage.io/docs/frontend-system/building-plugins/common-extension-blueprints/).
- Backstage frontend modules are the supported way to add or override extensions
  for an existing plugin. See
  [Frontend Extension Overrides](https://backstage.io/docs/frontend-system/architecture/extension-overrides/)
  and the installed type declarations in
  `workspaces/secure-token-storage/node_modules/@backstage/frontend-plugin-api`.
- This repository already uses a default-exported frontend module for dynamic
  RHDH loading in
  [`appAuthModule.tsx`](../workspaces/app-defaults/plugins/app-auth/src/appAuthModule.tsx)
  and documents that pattern in the
  [`app-auth` README](../workspaces/app-defaults/plugins/app-auth/README.md).

## Current-state findings

### RHDH auxiliary authentication providers

RHDH already supports the user journey described in the feedback:

1. Provider A establishes the RHDH user session and Backstage identity.
2. Provider B is configured as an auxiliary provider without identity
   resolution.
3. The signed-in user connects provider B from Settings > Authentication
   Providers.

That auxiliary connection is suitable for interactive Backstage plugins that
use the provider's frontend auth API. It does not give an external queued
workflow access to the browser's provider session. The secure-token-storage
connection remains necessary when SonataFlow must retrieve a token after the
browser session is gone.

The two provider configurations are independent. A provider may be configured
only under `auth.providers`, only under `secureTokenStorage.oauth.providers`, or
under both when the deployment needs both interactive and background-workflow
access.

### Ordinary Backstage provider connections

The Authentication Providers tab is not the Backstage sign-in page. It renders
one independent `ProfileInfoApi & SessionApi` per configured provider. Each row
can establish or remove that provider's browser-facing Backstage auth session
without changing the component used for another provider.

For the installed OAuth implementation:

- `signIn()` requests an access token through that provider's session manager.
- `signOut()` removes that provider's session.
- `getProfile()` and `sessionState$()` report that provider's profile and session
  state.
- Refresh calls the auth backend's provider-specific `/refresh` endpoint with
  browser credentials.

Sources:

- [`OAuth2.ts`](https://github.com/backstage/backstage/blob/master/packages/core-app-api/src/apis/implementations/auth/oauth2/OAuth2.ts)
- [`DefaultAuthConnector.ts`](https://github.com/backstage/backstage/blob/master/packages/core-app-api/src/lib/AuthConnector/DefaultAuthConnector.ts)
- [`RefreshingAuthSessionManager.ts`](https://github.com/backstage/backstage/blob/master/packages/core-app-api/src/lib/AuthSessionManager/RefreshingAuthSessionManager.ts)

This means a user may sign into RHDH with provider A and then select **Sign in**
for provider B in Settings. That second provider session does not, by itself,
change the Backstage identity that admitted the user to the application.

### Secure-token-storage provider connections

The secure-token-storage flow serves a different runtime:

1. `POST /connections/:provider/start-user` requires a Backstage user principal
   and binds the connect session to that principal's `userEntityRef`.
2. The user is redirected through a separate provider OAuth flow using PKCE and
   a single-use state value.
3. The callback completes the provider exchange and redirects to a configured
   consent URL.
4. Approve or reject requires an authenticated Backstage user again. Approval is
   accepted only for the user bound to the connect session.
5. Provider credentials stay in the secure-token-storage backend.
6. A service later presents `grantId` with its own Backstage service credentials
   to retrieve a usable access token.

Sources:

- [`router.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/router.ts)
- [`service.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/service.ts)
- [`providers.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/providers.ts)
- [`SecureTokenStorageClient.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage/src/api/SecureTokenStorageClient.ts)
- [`SecureTokenStoragePage.tsx`](../workspaces/secure-token-storage/plugins/secure-token-storage/src/components/SecureTokenStoragePage.tsx)

The current `start-user` route already enables the provider-A/provider-B use
case. Provider A establishes the current Backstage user. Provider B is the
separate account whose provider credentials are connected for workflow use. The
provider-B account does not need a Backstage sign-in resolver and must not be
treated as a second Backstage identity.

### What cannot be reused directly

The built-in `ProviderSettingsItem` cannot replace the secure connection flow:

- It calls a Backstage `SessionApi`; it does not create a secure-token-storage
  connect session or grant.
- Its signed-in state describes the Backstage auth provider session, not whether
  an encrypted offline credential and active workflow grant exist.
- Signing out from that row removes the Backstage provider session. It does not
  revoke secure-token-storage grants or disconnect the stored provider secret.
- Its token is intended for browser/user-to-server Backstage API use. The
  workflow flow requires backend custody, service authorization, audit, and
  explicit grant consent.

The integration should therefore reuse the page location and visual language,
not the token or session state.

## Extension seams

### Rejected: native RHDH provider-row adapter

RHDH's dynamic `providerSettings` wiring resolves a provider API and renders a
standard `ProviderSettingsItem`. That component models a browser authentication
session through `ProfileInfoApi & SessionApi` and exposes fixed **Sign in** and
**Sign out** actions.

The prototype mapped `signOut()` to secure-token-storage disconnect, which also
revokes workflow grants. That is the wrong lifecycle: ordinary provider logout
and RHDH global logout must not destroy persistent workflow authorization. The
binary session model also hides pending consent, grant scope, expiry, refresh,
and revocation state.

The implementation therefore does not expose a secure-token-storage
`ProfileInfoApi & SessionApi`, API reference, or dynamic provider row. The
integration reuses the Authentication Providers page location but presents a
separate workflow section with domain-specific verbs and state.

### New Frontend System

The installed `user-settings` plugin defines:

- Parent page extension: `page:user-settings`
- Authentication Providers subpage:
  `sub-page:user-settings/auth-providers`
- Public input on that subpage: `providerSettings`
- Input cardinality: optional singleton React element

Supplying the NFS input is another exact-tab seam, but it replaces the default provider
list. The custom element must deliberately render
`DefaultProviderSettings` before or beside the secure-token-storage section.

A frontend module with `pluginId: 'user-settings'` is preferred over changing the
sample app's page directly. Backstage ignores a frontend module when its target
plugin is absent, which keeps the dependency explicit.

The NFS implementation has two deployment modes:

1. **Aggregate mode (recommended when the singleton is available):** supply the
   complete Authentication Providers content, preserving default provider rows
   and adding workflow connection controls.
2. **Subpage mode (safe fallback):** add a `SubPageBlueprint` named
   `provider-connections` under the user-settings page. Use this when another
   module already owns `providerSettings` or RHDH cannot guarantee ownership.

### Legacy frontend system

The legacy `UserSettingsPage`/`SettingsPage` accepts a `providerSettings` JSX
prop. Like the NFS input, it is replacement content and expects children suitable
for a Material UI v4 `List`. A legacy app can render both
`DefaultProviderSettings` and secure-token-storage controls in that prop.

The legacy page also supports a separate `SettingsLayout.Route`, which is the
fallback when replacing the provider list is undesirable.

The current secure-token-storage sample app uses the New Frontend System, so NFS
is the implementation target. Legacy support should be limited to reusable
components and documented wiring unless a supported RHDH version still requires
an OFS bundle.

## Recommended UX

### First releasable integration

Install the aggregate user-settings module in deployments where the
Authentication Providers `providerSettings` singleton is available. It renders
Backstage's ordinary provider rows first, then a separate **Workflow provider
connections** section. Keep the existing `/secure-token-storage` page as a
compatibility route while the same reusable component is embedded in Settings.

Do not add workflow access as a standard Sign in/Sign out row. A workflow
connection is persistent backend authorization and is changed only by explicit
workflow Connect, Disconnect, Refresh, Revoke, Approve, or Reject actions.

### Authentication Providers page

Render two visually distinct sections and explain the difference in one sentence
at the top of each:

#### Backstage authentication sessions

Preserve the existing rows and behavior. Do not rename their actions. These rows
continue to show **Sign in** and **Sign out**.

#### Workflow provider connections

For each provider enabled under `secureTokenStorage.oauth.providers`, show:

- Provider display name and icon
- Connection state: Not connected, Pending consent, Connected, Needs
  reconnection, or Disconnected
- Granted scopes
- Grant ID, expiry, and last-used time when available
- Actions appropriate to state: Connect, Review consent, Refresh, Revoke grant,
  and Disconnect
- A statement that credentials are stored by the backend for trusted workflows
  and are not the user's Backstage login session

Use **Connect for workflows** and **Disconnect workflows** rather than Sign in
and Sign out. This prevents users from assuming that disconnecting workflow
access will sign them out of RHDH.

### OAuth and consent navigation

- Start the existing secure-token-storage `start-user` operation from the
  workflow section.
- Continue using the provider's full-page OAuth redirect unless a separately
  tested popup flow is added later.
- Set the secure-token-storage consent URL to
  `/settings/auth-providers` for aggregate mode or
  `/settings/provider-connections` for subpage mode.
- Preserve the `sessionId`, provider, and scopes in query parameters during the
  first slice, as the current page does.
- Render the explicit Approve/Reject consent panel in the workflow section after
  callback. Do not interpret provider OAuth approval as workflow grant approval.
- Remove consumed consent query parameters with `history.replaceState` after a
  successful decision, preserving the current behavior.

### Provider A to provider B example

1. The user signs into RHDH with OIDC, GitHub, or another configured provider A.
2. The current Backstage identity opens Settings > Authentication Providers.
3. Under Workflow provider connections, the user chooses **Connect for
   workflows** for provider B.
4. The secure-token-storage backend binds the connect session to the existing
   Backstage `userEntityRef`.
5. Provider B authenticates and authorizes the requested offline scopes.
6. The user returns to Settings and explicitly approves the named workflow
   client and scopes.
7. The resulting `grantId` remains associated with the original Backstage user
   and provider-B connection.
8. Orchestrator forwards `grantId`; SonataFlow exchanges it using its service
   identity exactly as it does today.
9. The user can sign out of RHDH without altering the provider-B connection or
   grant.
10. When a later login resolves to the same Backstage `userEntityRef`, the
    stored connection and grants are shown again, even if a different login
    provider established that RHDH session.

## Architecture

```text
Settings > Authentication Providers
                  |
          +-------+------------------+
          |                          |
          v                          v
Backstage auth sessions      Workflow provider connections
(existing SessionApi)        (secure-token-storage client)
          |                          |
          v                          v
 /api/auth/<provider>        /api/secure-token-storage/connections/...
          |                          |
 Browser/session use          Encrypted backend credential + grantId
                                     |
                                     v
                              Orchestrator -> SonataFlow
                                     |
                                     v
                              grantId token exchange
```

The two columns share only the current Backstage user identity and the Settings
surface. They do not share provider tokens, refresh state, logout behavior, or
grant state.

## Frontend design

### Rejected native RHDH row adapter

No provider-specific API references or `SecureTokenStorageProviderSession`
factory are part of the selected design. In particular, the frontend must not
map an ordinary `SessionApi.signOut()` call to workflow disconnect or grant
revocation. This keeps authentication logout and persistent workflow access
separate in both the UI and the code.

### Rich aggregate component

Refactor the existing page into three layers:

1. `useSecureTokenStorageConnections` owns API calls, loading, error, consent,
   grant, refresh, revoke, and disconnect state.
2. `WorkflowProviderConnections` is an embeddable component with no assumption
   that it owns a full page.
3. `SecureTokenStoragePage` remains a compatibility wrapper around the same
   component during migration.

Add an NFS user-settings module that lazy-loads the aggregate settings component.
The module should be opt-in until singleton ownership is verified in the target
RHDH distribution.

The aggregate component should:

- Read the ordinary configured provider names from `auth.providers`, matching the
  installed user-settings behavior.
- Render Backstage's public `DefaultProviderSettings` for ordinary sessions.
- Render `WorkflowProviderConnections` separately.
- Avoid using ordinary provider session state to infer workflow connection state.
- Ensure RHDH global logout and provider-row Sign out have no reference to the
  secure-token-storage client.
- Avoid nested full-page headers, duplicate Settings tabs, and duplicate side-nav
  entries.

If aggregate mode proves incompatible with another provider-settings override,
install the same embeddable component through a user-settings subpage module.

## Backend and API design

The current OAuth, consent, grant, and token-exchange contracts remain the source
of truth. Do not route secure connection actions through `/api/auth`.

### Workflow token endpoint remains required

The Settings integration changes where users connect and manage providers. It
does not replace or remove the workflow-facing token interface. After the user
connects a provider and approves a grant, SonataFlow must still be able to
exchange that opaque grant for a usable provider access token:

```http
POST /api/secure-token-storage/token
Authorization: Bearer <Backstage service credential>
Content-Type: application/json

{
  "grantId": "opaque-id",
  "provider": "github"
}
```

The response remains the current `AccessTokenResult`:

```json
{
  "accessToken": "short-lived-provider-token",
  "expiresAt": "2026-10-01T12:00:00.000Z",
  "scopes": ["read:user", "repo", "read:org"]
}
```

This endpoint is a backend-to-backend boundary and must preserve these rules:

- Accept only an authenticated Backstage service principal; never accept a
  browser user token as a substitute.
- Resolve the owning user and provider connection from the stored grant.
  SonataFlow must not send `userEntityRef`.
- Confirm that the requested provider matches the grant and that the grant is
  active, unexpired, and bound to the calling service subject.
- Return the stored access token when it is still usable.
- When the access token has expired, use the encrypted refresh token and the
  configured provider refresher to obtain and persist a replacement before
  returning it. This refresh requires no user interaction.
- Never return the provider refresh token to the workflow.
- Continue auditing successful exchanges, denied exchanges, refresh attempts,
  refresh success, and refresh failure.

The existing implementation already provides this contract through
[`router.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/router.ts),
[`service.ts`](../workspaces/secure-token-storage/plugins/secure-token-storage-backend/src/service.ts),
and the public `SecureTokenStorageService` in
[`secure-token-storage-node`](../workspaces/secure-token-storage/plugins/secure-token-storage-node/src/index.ts).
The Settings work must preserve it as a compatibility requirement. If a future
versioned endpoint replaces `/token`, keep `/token` available until all workflow
consumers have migrated.

Add one user-authenticated read model endpoint so the frontend does not hardcode
GitHub or infer a provider connection from grants:

```http
GET /api/secure-token-storage/providers
```

Proposed response:

```json
[
  {
    "provider": "github",
    "displayName": "GitHub",
    "configured": true,
    "connectionState": "connected",
    "scopes": ["read:user", "repo", "read:org"],
    "grants": [
      {
        "grantId": "opaque-id",
        "expiresAt": "2026-10-01T12:00:00.000Z",
        "revokedAt": null
      }
    ]
  }
]
```

Rules for this endpoint:

- Derive the user only from the authenticated Backstage principal.
- Return safe metadata only; never return access tokens, refresh tokens,
  authorization codes, PKCE verifiers, client secrets, or encrypted envelopes.
- Derive configured providers from the secure-token-storage backend registry,
  not
  `auth.providers`.
- Keep ordinary auth-provider availability and secure workflow-provider
  availability independent.
- Return stable machine states so the UI does not derive security state from
  button labels or timestamps.

No database migration is required for the first integration slice. A later UX
slice may store non-secret provider account metadata, such as GitHub login and
provider subject, so users can distinguish multiple external accounts. That
metadata must not be used to replace the Backstage `userEntityRef` binding.

## Authentication, authorization, and data considerations

### Identity binding

- The Backstage principal that starts the flow owns the connection and grant.
- The provider-B identity authorizes access to provider-B resources; it does not
  become the Backstage principal.
- Connections and grants remain stored when the browser or RHDH authentication
  session ends. The next session sees them when its identity resolver produces
  the same `userEntityRef`.
- Login providers A and C may both recover the same workflow grants when they
  resolve to the same Backstage user. A session resolving to a different
  `userEntityRef` remains isolated, even if it represents the same human.
- Consent approval must continue checking that the authenticated Backstage user
  matches the connect-session owner.
- Token exchange must continue deriving the user and provider from the stored
  grant. SonataFlow must not provide `userEntityRef`.

### Separate OAuth clients

Prefer separate provider OAuth applications for Backstage auth sessions and
secure workflow connections. Their callback URLs, scopes, token lifetimes,
offline-access requirements, revocation expectations, and operators differ.
Sharing a provider OAuth application would couple sign-in and workflow access and
make consent text less clear.

### Scope and consent

- Show the exact workflow scopes before leaving RHDH and again before grant
  approval.
- Do not silently reuse or escalate scopes from an ordinary Backstage provider
  session.
- Do not auto-create a workflow grant merely because the user signed into an
  ordinary provider row.
- Keep workflow consent explicit even if provider B is also the user's RHDH
  sign-in provider.
- Preserve named-client/caller binding from the RHIDP-1661 implementation
  analysis.

### Session and disconnect semantics

- Ordinary Sign out must not revoke workflow grants or delete stored workflow
  credentials.
- Workflow Disconnect must not remove the ordinary Backstage auth-provider
  session or sign the user out of RHDH.
- RHDH global sign-out should not silently destroy offline workflow access;
  users must revoke or disconnect it explicitly. Product policy may add a
  separate administrative cleanup operation.
- Neither ordinary provider Sign out nor global RHDH logout should import or call
  `SecureTokenStorageClient`.
- If the Backstage session expires during provider OAuth, preserve the pending
  connect session but require the same user to reauthenticate before consent.

### Browser and backend boundaries

- Continue using `FetchApi` for authenticated user operations.
- Keep provider tokens out of React state, URLs, browser storage, and frontend
  logs.
- Keep callback state single-use and PKCE-protected.
- Keep callback routes unauthenticated only where required by the provider, then
  require an authenticated user for consent.
- Allow-list callback and consent return locations; never accept arbitrary return
  URLs from the browser.
- Continue redacting token and authorization-code values from logs and audit
  records.

## Compatibility strategy

- Keep secure token storage opt-in. Installing ordinary Backstage auth providers
  must not enable offline storage.
- Keep the current `/secure-token-storage` page during the first migration slice.
- Make both the old page and Settings integration render the same extracted
  component so behavior cannot diverge.
- Change `secureTokenStorage.oauth.consentUrl` only after the Settings route is
  installed and tested.
- Preserve existing backend routes and response shapes while relocating the UI.
- Preserve the current `grantId` transport and the service-authenticated
  `POST /api/secure-token-storage/token` exchange.
- Do not proxy workflow token exchange through the Settings frontend or expose
  the returned access token to the browser.
- Preserve Orchestrator's legacy non-secure-token flow.
- Do not change `docs/PLAN-RHIDP-1661.md`; this plan is an integration addendum.

For NFS dynamic loading, follow the default-exported frontend-module pattern
already used by RHDH's app-defaults packages. Before changing the existing
package's default export, verify how the target RHDH release discovers multiple
features from one dynamic package. If only one default feature is loaded, choose
one of these compatibility-safe arrangements:

1. Keep the current standalone plugin as one exposed module and expose the
   user-settings module as a second explicitly configured module; or
2. Publish a small companion frontend-module package in the same workspace,
   leaving the current package's default export unchanged.

Do not silently change the current default export and break existing dynamic
configuration.

The rejected native provider-row path must not be restored as a workaround for
singleton ownership. If the aggregate cannot safely own `providerSettings`, use
the dedicated Settings subpage fallback.

## Exact affected packages and files

### Required

#### `plugins/secure-token-storage`

- Extract the stateful connection/grant logic from
  `src/components/SecureTokenStoragePage.tsx`.
- Add an embeddable workflow-provider-connections component.
- Add the Authentication Providers aggregate and NFS module, with a dedicated
  user-settings subpage as the fallback when the singleton is occupied.
- Do not add a `ProfileInfoApi & SessionApi` adapter for workflow grants.
- Extend `SecureTokenStorageClient` with the safe provider read model.
- Add component, client, callback/consent, and extension-wiring tests.
- Update package exports, dependencies, API report, and Scalprum exposed modules
  as selected by the dynamic-loading spike.

#### `plugins/secure-token-storage-backend`

- Add the authenticated provider-status/read-model route.
- Compose configured backend-provider metadata with the current user's connection and
  grants.
- Add route/service tests proving user isolation and secret redaction.

#### `packages/app`

- Install the user-settings integration feature in the sample NFS app.
- Keep the standalone page temporarily for compatibility testing.
- Add a sample-app integration test if the workspace test setup supports one.

#### Workspace configuration

- Update `app-config.yaml` consent URL after the target Settings route exists.
- Keep `auth.providers` and `secureTokenStorage.oauth.providers` independently
  configured to demonstrate provider A and provider B.
- Document separate OAuth callback URLs and client credentials.

### Conditionally affected

#### `plugins/secure-token-storage-node`

Change this package only if provider status types become part of the public
cross-package contract. Do not move frontend-only view models into the node
package merely for convenience.

#### New companion frontend-module package

Create a companion package only if dynamic feature loading cannot install both
the existing plugin and a named user-settings module from the current package.
If created, it belongs under `workspaces/secure-token-storage/plugins` and should
contain only user-settings extension wiring; reusable UI and client behavior
remain in the existing frontend package.

### Explicitly unaffected

- `workspaces/orchestrator`
- The SonataFlow workflow demo
- The `grantId` header/input contract
- The service-authenticated `POST /api/secure-token-storage/token` endpoint and
  its transparent provider-token refresh behavior
- Backstage auth-backend provider modules
- `docs/PLAN-RHIDP-1661.md`

## Phased implementation

### Phase 0: Extension and dynamic-loading spike

- Record the provider-row adapter as rejected: fixed Sign in/Sign out labels and
  `SessionApi` state do not model persistent workflow access safely.
- Build a minimal user-settings frontend module against the installed
  `@backstage/plugin-user-settings` 0.9.6.
- Verify that aggregate content receives the singleton `providerSettings` slot.
- Verify that `DefaultProviderSettings` preserves GitHub, Microsoft, and other
  configured built-in rows.
- Verify how the target RHDH dynamic feature loader installs a plugin plus a
  module from this package.
- Detect whether RHDH already supplies another `providerSettings` override.
- Use aggregate mode when the slot is available; otherwise select the dedicated
  subpage fallback.

Exit criterion: the rejected adapter decision, packaging, and any singleton
ownership are recorded, and ordinary provider rows still work without any
secure-token-storage logout coupling.

### Phase 1: Extract reusable frontend behavior

- Extract the API/state hook and embeddable workflow component from the current
  full page.
- Keep all existing connect, consent, list, refresh, revoke, and disconnect
  behavior passing through the same code.
- Keep `/secure-token-storage` working.
- Add accessibility labels and terms that distinguish sessions from workflow
  connections.

Exit criterion: the old page is behaviorally unchanged but no longer owns the
business state directly.

### Phase 2: Add the safe provider read model

- Add `GET /providers` for the authenticated user.
- Return configured-provider, connection, grant, scope, expiry, and reconnect
  metadata only.
- Update the frontend client and tests.
- Remove hardcoded GitHub-only rendering from the embeddable component.

Exit criterion: the UI is driven by backend-supported secure providers and does
not infer secure state from `auth.providers` or ordinary sessions.

### Phase 3: Install the Settings integration

- Implement the selected aggregate user-settings extension mode.
- In aggregate mode, render ordinary provider settings unchanged and add the
  workflow section.
- In subpage mode, add **Workflow Provider Connections** as a Settings tab.
- Install the feature in the sample app.
- Keep the integration hidden or disabled when secure token storage is disabled.

Exit criterion: a user signed in with provider A can connect provider B from
Settings without losing or altering the provider-A session, and signing out of
RHDH does not revoke or disconnect provider B.

### Phase 4: Move callback consent into Settings

- Update the sample consent URL to the selected Settings route.
- Render pending consent in the embedded section.
- Handle refresh/reload, expired session, consumed session, rejection, and
  successful approval.
- Keep a compatibility path for old consent links during the transition.

Exit criterion: the entire browser interaction starts and finishes in Settings,
apart from the provider-hosted OAuth pages.

### Phase 5: Compatibility cleanup

- Decide whether `/secure-token-storage` remains as an alias, redirects to
  Settings, or is removed in a later major release.
- Remove duplicate side navigation only after the Settings entry is verified in
  RHDH.
- Document legacy app wiring if it is still supported.
- Add release notes describing that ordinary provider sign-in and workflow
  provider connections remain independent.

Exit criterion: there is one preferred navigation path, with documented behavior
for old bookmarks and dynamic configuration.

### Phase 6: Upstream composability follow-up

- Propose an additive, non-singleton provider-settings item or section blueprint
  to Backstage if exact-tab aggregation is valuable beyond this plugin.
- After an adopted Backstage/RHDH version exposes that seam, replace the
  singleton aggregate with additive extensions.

Exit criterion: multiple plugins can contribute provider-related settings
without one package owning the entire list.

## Test plan

### Frontend unit tests

- Ordinary configured providers remain visible when the secure section is
  installed.
- The secure section is absent when the feature is disabled or no workflow
  provider is configured.
- Secure providers are sourced from the secure backend, not `auth.providers`.
- Connect, callback consent, approve, reject, refresh, revoke, and disconnect
  call the existing secure client operations.
- Ordinary Sign out does not invoke secure disconnect.
- Global RHDH logout does not invoke secure disconnect or revoke.
- Secure Disconnect does not invoke an ordinary provider API's `signOut()`.
- Consumed query parameters are removed after consent.
- Disabled backend, no providers, loading, and each error state render safely.
- Buttons, headings, focus order, and status messages are accessible.

### Backend tests

- `GET /providers` requires a user principal.
- User A cannot see user B's connection or grants.
- The response contains no token, code, verifier, secret, or encrypted-envelope
  fields.
- Configured but unconnected providers are returned in a stable state.
- Revoked, expired, and active grants are represented correctly.

### Integration and end-to-end tests

1. Sign in with provider A and connect provider B.
2. Connect provider B when provider B also happens to be the sign-in provider.
3. Reject workflow consent after provider OAuth succeeds.
4. Let the Backstage session expire between callback and consent; require the
   same user to resume.
5. Attempt consent as a different Backstage user; deny it.
6. Disconnect workflow access and confirm the RHDH session is unchanged.
7. Sign out of an ordinary provider session and confirm the workflow grant is
   unchanged.
8. Sign out of RHDH, sign back in as the same `userEntityRef`, and confirm the
   provider connection and grants are still present.
9. Sign in through a different login provider that resolves to the same
   `userEntityRef` and confirm the same grants are present.
10. Sign in as a different `userEntityRef` and confirm the grants are isolated.
11. Run the Orchestrator demo and exchange the same `grantId` through SonataFlow.
12. Call the token endpoint with the wrong service subject and confirm access is
    denied.
13. Revoke or expire the grant and confirm the token endpoint denies exchange.
14. Expire the provider access token and confirm the token endpoint refreshes it
    without user interaction, persists the replacement, and returns a current
    access token without exposing the refresh token.
15. Restart the backend and verify persisted secure state independently from
    browser auth-provider session state.
16. Install a second provider-settings override and verify the selected collision
    policy or subpage fallback.

## Risks and mitigations

| Risk                                       | Impact                                                                             | Mitigation                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Singleton `providerSettings` ownership     | Another module may replace this integration or be replaced by it.                  | Make integration opt-in, detect known owners during the spike, and use the dedicated subpage fallback.                       |
| Default provider list replacement          | Built-in providers can disappear if the aggregate omits them.                      | Always render `DefaultProviderSettings` and test every provider supported by the target RHDH release.                        |
| Custom RHDH provider APIs                  | Upstream `DefaultProviderSettings` may not know RHDH-specific auth API refs.       | Inventory RHDH app-auth providers in Phase 0; add them to a central aggregate or choose the subpage fallback.                |
| User confusion between two connections     | Users may believe workflow Disconnect signs them out of RHDH.                      | Separate sections, distinct verbs, explanatory text, and independent status models.                                          |
| Shared OAuth client configuration          | Sign-in and workflow scopes/lifetimes become coupled.                              | Prefer separate OAuth applications and callbacks.                                                                            |
| Duplicate navigation                       | Standalone and Settings pages may both appear.                                     | Keep both only during migration, then retain an alias/redirect and one visible entry.                                        |
| Dynamic loading incompatibility            | One package may not expose both the current plugin and new module as expected.     | Complete the Phase 0 loader spike before changing exports; use a companion module package if needed.                         |
| Authentication/workflow lifecycle coupling | Mapping logout to workflow disconnect could unexpectedly revoke persistent grants. | Do not expose a workflow `SessionApi`; use a separate section and explicit Connect, Disconnect, Refresh, and Revoke actions. |
| Provider-B account ambiguity               | Users may not know which external account was connected.                           | Add non-secret provider account metadata in a later slice; never use it as the Backstage identity binding.                   |
| Session expires during OAuth               | Consent cannot complete immediately.                                               | Preserve pending state and require the same Backstage user to reauthenticate.                                                |

## Open decisions

The native provider row is no longer an open decision. It was rejected because
its session and logout semantics conflict with persistent workflow grants. The
remaining decisions are:

1. Does the target RHDH distribution already own the singleton
   `providerSettings` input?
2. Must the first release appear on the exact Authentication Providers tab, or
   is a dedicated Settings subpage acceptable when the singleton is occupied?
3. Can the dynamic feature loader install two exposed frontend features from the
   current package, or is a companion module package required?
4. Which RHDH-specific ordinary auth providers must the aggregate preserve in
   addition to Backstage's `DefaultProviderSettings` list?
5. Should the old `/secure-token-storage` URL redirect permanently, remain an
   alias, or be removed in a major release?
6. Should the safe provider read model expose last-used and reconnect-required
   state in the first slice?
7. Should non-secret provider account identity be persisted so users can verify
   which GitHub or Microsoft account they connected?
8. Is a separate provider OAuth application mandatory in production policy or
   only strongly recommended?

## Recommended first coding slice

Continue the selected aggregate path and Phase 1 frontend extraction together:

1. Keep the native provider session adapter removed so ordinary logout cannot
   call workflow disconnect or revoke.
2. Prove the NFS aggregate preserves ordinary provider rows and adds a separate
   workflow section, with a subpage fallback if the singleton is occupied.
3. Prove the target RHDH dynamic loader can install the settings module without
   changing the existing package's default behavior.
4. Extract the current secure-token-storage page into an embeddable workflow
   connections component while keeping `/secure-token-storage` unchanged.
5. Verify logout/login persistence for the same `userEntityRef` before moving
   callback consent into Settings.

This slice preserves the required separation between authentication sessions and
workflow grants while resolving dynamic loading and singleton ownership. It does
not change stored credentials, OAuth behavior, grants, Orchestrator, SonataFlow,
or the reference RHIDP-1661 plan.
