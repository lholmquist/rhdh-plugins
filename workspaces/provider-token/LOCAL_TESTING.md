# Provider Token local setup and testing

This guide runs the isolated Provider Token sample app and backend in the
`rhdh-plugins` repository, then exercises the multi-step provider-token workflow
demo from the separate `rhdhorchestrator` checkout. It covers connecting a
provider, reviewing and approving consent, inspecting and revoking grants, and
exchanging an opaque grant ID for a fresh access token immediately before each
GitHub API call.

The sample is not a full RHDH deployment. Its sign-in is configured for the
Backstage guest provider, and its database is in-memory SQLite. Grants and
connections are therefore for local testing only and are lost when the backend
restarts.

## Prerequisites

- Node.js 22 or 24 and Yarn 4.17.1 (the workspace's `package.json` declares
  these versions).
- OpenSSL, for generating a local encryption key.
- A GitHub OAuth App configured to issue expiring user access tokens with
  refresh tokens. The GitHub adapter rejects OAuth responses that do not
  include refreshable, expiring credentials.
- An available local port 3000 for the frontend and 7007 for the backend. Do
  not run another sample workspace on those ports at the same time.

From the repository root, enter the isolated workspace:

```sh
cd workspaces/provider-token
```

On a fresh checkout, install the workspace dependencies and build native
dependencies such as SQLite:

```sh
YARN_ENABLE_SCRIPTS=true yarn install --immutable
```

## Create a GitHub OAuth App

In GitHub, create an OAuth App for local development and set:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL:
  `http://localhost:7007/api/provider-token/v1/connect/callback`

Copy its client ID and client secret for the next step. Keep the secret out of
source control. This backend specifically requires expiring access credentials
and a refresh-token pair; a credential response without those fields cannot be
approved as a provider connection.

## Opt in to the feature locally

The checked-in `app-config.yaml` intentionally has
`providerToken.enabled: false`. Keep it unchanged. In the same terminal you
will use to start the servers, generate a fresh 32-byte key and export the
OAuth App credentials:

```sh
export PROVIDER_TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export PROVIDER_TOKEN_GITHUB_CLIENT_ID="<your-oauth-app-client-id>"
export PROVIDER_TOKEN_GITHUB_CLIENT_SECRET="<your-oauth-app-client-secret>"
```

Create `app-config.local.yaml` in `workspaces/provider-token/` with this local
configuration:

```yaml
providerToken:
  enabled: true
  encryption:
    activeKey: ${PROVIDER_TOKEN_ENCRYPTION_KEY}
    activeKeyVersion: local-v1
  providers:
    github:
      clientId: ${PROVIDER_TOKEN_GITHUB_CLIENT_ID}
      clientSecret: ${PROVIDER_TOKEN_GITHUB_CLIENT_SECRET}
  clients:
    - id: workflow-service
      title: Workflow Service
      purpose: Run queued workflows using the provider scopes you approve.
      allowedSubjects:
        - sonataflow
      providerScopes:
        github:
          - read:user
          - repo
          - read:org
  returnUrlAllowlist:
    - origin: http://localhost:3000
      pathPrefix: /provider-token
```

`app-config.local.yaml` is ignored by Git. Keep `sonataflow` in
`allowedSubjects` for the workflow demo below; it matches the local-only static
service credential in the checked-in `app-config.yaml`. If you choose another
subject, update the local Backstage `externalAccess` credential and the
workflow's service token together with this allow-list entry.

The sample also registers a Microsoft adapter, but the walkthrough below uses
GitHub. To enable Microsoft locally, add its client ID, secret, and optional
tenant under `providerToken.providers.microsoft`; see the backend plugin's
configuration documentation for the shape and behavior.

## Start the app and backend

From the `workspaces/provider-token` directory, run:

```sh
yarn dev
```

This starts the frontend and backend together. Keep this terminal open; both
processes inherit the exported environment variables. The app is at
`http://localhost:3000`, and the backend listens at `http://localhost:7007`.
Stop both with Ctrl-C in this terminal.

The conventional `app-config.local.yaml` is loaded alongside the checked-in
`app-config.yaml`. On startup, verify that the backend reports the feature is
enabled and that it initialized the provider-token storage and encryption.

## Exercise the UI

1. Open [`http://localhost:3000/provider-token`](http://localhost:3000/provider-token).
   Sign in with the sample guest provider if prompted. The RHDH login identity
   and the GitHub provider connection are separate.
2. In **Connect a provider**, choose **GitHub** and **Workflow Service**. The
   UI displays the scopes configured for that client and provider; it does not
   accept a browser-entered scope list. To change requested scopes, edit
   `providerToken.clients[].providerScopes.github` in `app-config.local.yaml`
   and restart the backend. The GitHub adapter adds its refresh scope as
   needed; do not add `offline_access` yourself.
3. Complete GitHub's authorization. GitHub returns to the backend callback,
   which redirects back to the Provider Token page with a pending consent
   request.
4. Review **Approve provider access**: provider, client, intended caller,
   purpose, requested scopes, and request expiry. Select **Reject** to verify
   that denial creates no grant, or repeat the connect flow and select
   **Approve**.
5. After approval, confirm that **Connected providers** shows GitHub and its
   scopes, and **Provider grants** shows the grant ID, client, caller, scopes,
   expiry, and active status. The UI does not display access or refresh tokens.
6. Select **Revoke grant** and confirm its status changes to revoked. To test
   full disconnect, select **Disconnect GitHub**; the connection is removed and
   its grants are revoked. You can start a new connection afterward.
7. Use **Refresh** to reload the connection and grant lists from the backend.

The connect session is one-use and short-lived. If you revisit an old callback,
see a consumed/expired-session error, or the browser is left at an old callback
URL, start a new connection from the page instead of replaying that URL.

## Run the multi-step workflow demo

The Provider Token endpoint accepts the demo's existing broker request shape,
`{ "grantId": "…", "provider": "github" }`, and returns `accessToken`,
`expiresAt`, and `scopes`. No edits to the workflow source are needed. The demo
repository is not part of this workspace, so its files remain unchanged.

The sample backend config includes a local-only static service credential with
subject `sonataflow`. The same subject is listed in the `workflow-service`
client's `allowedSubjects` in `app-config.local.yaml`. Never reuse this sample
credential outside local development.

In a second terminal, point the workflow at the Provider Token route and use
the configured local service credential:

```sh
export SECURE_TOKEN_STORAGE_URL='http://localhost:7007/api/provider-token/v1/access-tokens'
export SECURE_TOKEN_STORAGE_SERVICE_TOKEN='bXljdXJscGFzc3dkCg=='
cd /Users/lholmqui/develop/rhdhorchestrator/orchestrator-demo/11_provider_token_grant_multi_step
kn-workflow quarkus run
```

If that workflow is already running on port 8080 with the old broker URL, stop
and restart it with the updated environment variables above. Environment
changes do not affect an already-running workflow process. The demo should be
available at
[`http://localhost:8080/provider-token-grant-multi-step`](http://localhost:8080/provider-token-grant-multi-step).

Copy the active `grantId` from **Provider grants** in the Provider Token page.
For all four demo operations, authorize the GitHub connection with `read:user`,
`repo`, and `read:org`. Start a run with the grant ID in workflow input:

```sh
curl --fail --silent --show-error \
  -X POST \
  http://localhost:8080/provider-token-grant-multi-step \
  -H 'Content-Type: application/json' \
  -d '{"grantId":"<active-grant-id>","provider":"github","page":1,"perPage":100}'
```

The workflow also accepts the grant reference in the Orchestrator-style header
instead of the input field:

```sh
curl --fail --silent --show-error \
  -X POST \
  http://localhost:8080/provider-token-grant-multi-step \
  -H 'Content-Type: application/json' \
  -H 'X-Provider-Token-Grant-Github: <active-grant-id>' \
  -d '{"page":1,"perPage":100}'
```

Each profile, private repository, organization, and starred-repository
operation requests a current token from Provider Token immediately before its
GitHub API call. The workflow keeps that token in a local variable and sends
it only to GitHub; it does not put the token in workflow state or logs. A
provider `401` triggers one reacquisition attempt. Provider Token refreshes an
expired access token using its encrypted refresh credential before returning
the response.

To use automatic grant selection when `grantId` is absent, install the optional
Provider Token Orchestrator backend module in the RHDH backend that already
loads the Orchestrator and Provider Token backends. Add this to that backend's
feature registration:

```ts
backend.add(
  import(
    '@red-hat-developer-hub/backstage-plugin-provider-token-backend-module-orchestrator'
  ),
);
```

Do not load the secure-token-storage Orchestrator module at the same time;
Orchestrator accepts one grant resolver. Automatic selection returns no grant
when the owner has multiple provider choices or active grants tied to different
service subjects. The workflow's broker service credential must still match
the selected grant's allowed caller. In a host with a permission policy, allow
the Orchestrator backend service to use the Provider Token grant-read
permission; grant lookup returns only the opaque grant reference, and the
token endpoint independently checks the workflow service subject.

## What this verifies—and what it does not

This walkthrough verifies the user-facing connect/consent and grant lifecycle,
safe grant metadata, the authenticated service-to-service token endpoint, and
the multi-step workflow's grantId input/header paths. It does not exercise the
Orchestrator automatic lookup module unless that optional module is loaded in
an Orchestrator backend. Do not put a provider access token into workflow input
or use the browser UI to retrieve one.

Because the sample uses in-memory SQLite, restarting the backend clears its
local provider connections and grants. This is expected for the prototype and
does not indicate that the OAuth connection failed to save during the current
backend run.

## Troubleshooting

- **The page says the feature or provider is not configured:** confirm that
  `app-config.local.yaml` is in the workspace root, `providerToken.enabled` is
  `true`, and the three GitHub environment variables were exported in the same
  terminal before `yarn dev`.
- **GitHub reports a redirect/callback URL mismatch:** make the OAuth App
  callback exactly
  `http://localhost:7007/api/provider-token/v1/connect/callback`.
- **The OAuth callback cannot be completed or GitHub credentials are rejected:**
  verify that the GitHub OAuth App issues expiring access tokens and refresh
  tokens, and start a fresh connection rather than reusing an old callback URL.
- **The frontend or backend cannot bind its port:** stop the other local sample
  app using port 3000 or 7007, then restart `yarn dev`.
- **The grant/connection disappears after a backend restart:** this sample uses
  `:memory:` SQLite. Its data is intentionally ephemeral.
- **The workflow reports that the token broker rejected the grant:** check
  `SECURE_TOKEN_STORAGE_URL` points to
  `http://localhost:7007/api/provider-token/v1/access-tokens`, the service
  token is configured by `backend.auth.externalAccess`, and its subject is
  `sonataflow` in both the backend config and the grant's allowed caller list.
- **The workflow has no access token in the broker response:** verify it calls
  the Provider Token route above; the route responds with `accessToken` and
  rejects a provider assertion that does not match the grant.
- **A grant works in the UI but is rejected by the workflow:** check that the
  grant is active, unexpired, and bound to the same service subject as the
  workflow's Backstage credential. The OAuth connection also needs the scopes
  used by the workflow.

For API routes, encryption behavior, and the provider configuration model, see
the [Provider Token backend documentation](./plugins/provider-token-backend/README.md).
