# Local testing guide

This guide explains how to exercise the secure token storage functionality with
the full-stack sample application in `workspaces/secure-token-storage/packages`.
The sample includes:

- a Backstage frontend with the provider connection and consent page;
- a Backstage backend with the secure token storage broker;
- the Orchestrator frontend and backend plugins; and
- optional Podman-backed SonataFlow development mode.

The sample uses an in-memory SQLite database. Restarting the backend removes
all local connections, grants, and audit data.

## Prerequisites

Install or have access to:

- Node.js and Yarn versions supported by this repository;
- a GitHub or Microsoft OAuth application, if testing a real provider
  connection; and
- Podman, if testing the Orchestrator integration.

For GitHub, register this callback URL:

```text
http://localhost:7007/api/secure-token-storage/connections/github/callback
```

Backstage GitHub sign-in uses this callback URL:

```text
http://localhost:7007/api/auth/github/handler/frame
```

For Microsoft, register this callback URL:

```text
http://localhost:7007/api/secure-token-storage/connections/microsoft/callback
```

Keep the OAuth client ID and secret outside the repository. The sample reads
them from environment variables through `app-config.yaml`.

## One-time dependency setup

From the repository root, install the workspace dependencies:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins
YARN_ENABLE_SCRIPTS=false yarn install --immutable
```

If native dependencies such as `better-sqlite3` have not been built in the
local checkout, rerun the workspace install with build scripts enabled:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage
YARN_ENABLE_SCRIPTS=true yarn install
```

## Configure the local caller identity

The sample configuration contains a local-only static Backstage service
credential whose subject is `my-external-feed`. Secure token storage currently
allows only the `sonataflow` caller subject:

```yaml
backend:
  auth:
    externalAccess:
      - type: static
        options:
          token: bXljdXJscGFzc3dkCg==
          subject: my-external-feed

secureTokenStorage:
  allowedCallerSubjects:
    - sonataflow
```

Before testing the service-to-broker calls, make these values agree in the
local `app-config.yaml`. The simplest local-only option is to change the
external access subject to `sonataflow`. Do not use this sample credential in a
shared or production environment.

Set the credential in the shell used for the request:

```bash
export BACKSTAGE_EXTERNAL_ACCESS_TOKEN='bXljdXJscGFzc3dkCg=='
```

If you do not configure a secure-token-storage OAuth provider, the health
endpoint and the sample UI can still be tested, but the provider connection
flow will return `provider-not-configured`.

## Configure an OAuth provider

Export the credentials for the provider you want to test before starting the
backend. The sample now supports GitHub sign-in and GitHub provider-token
connections. GitHub is the shortest path through the sample:

```bash
export GITHUB_OAUTH_CLIENT_ID='your-local-client-id'
export GITHUB_OAUTH_CLIENT_SECRET='your-local-client-secret'
```

These are two separate GitHub OAuth uses:

- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` configure Backstage user
  sign-in.
- `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` configure the
  secure-token-storage provider connection.

They may use the same GitHub OAuth application only if its callback URLs and
permissions are configured for both flows. The Backstage sign-in callback is
handled by the auth backend; the secure-token-storage callback is the
`/api/secure-token-storage/connections/github/callback` URL above.

For Backstage GitHub sign-in, export:

```bash
export GITHUB_CLIENT_ID='your-local-client-id'
export GITHUB_CLIENT_SECRET='your-local-client-secret'
```

For Microsoft, use:

```bash
export MICROSOFT_OAUTH_CLIENT_ID='your-local-client-id'
export MICROSOFT_OAUTH_CLIENT_SECRET='your-local-client-secret'
export MICROSOFT_OAUTH_TENANT='common'
```

The configured provider must use one of the exact callback URLs in
`secureTokenStorage.oauth.allowedRedirectUris`.

## Start the sample application

Use two terminals. In the first terminal, start the backend from the sample
workspace directory:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage
export SECURE_TOKEN_STORAGE_ENCRYPTION_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
yarn workspace backend start --config ../../app-config.yaml
```

The encryption key must be a base64-encoded 32-byte value. Keep it stable for
the lifetime of the backend process. Starting the backend again with the same
in-memory database is not required; all data is intentionally discarded on
restart.

In the second terminal, start the frontend:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage
yarn workspace app start
```

Open the sample at [http://localhost:3000](http://localhost:3000). The sign-in
page now offers **Guest** and **GitHub**. Select GitHub to validate the
Backstage auth provider, or select Guest to continue with the local guest
identity. Then open the **Provider connections** page at
[http://localhost:3000/secure-token-storage](http://localhost:3000/secure-token-storage).

The sample catalog includes a local `User` entity named `lholmquist`, which
matches the GitHub username used by the configured
`usernameMatchingUserEntityName` resolver. If you use a different GitHub
account, update the `User` entity name in `catalog-info.yaml` to match your
GitHub username and restart the backend.

## Smoke test the broker

The health endpoint does not require authentication:

```bash
curl --fail http://localhost:7007/api/secure-token-storage/health
```

Expected response:

```json
{ "enabled": true }
```

The frontend should also load the active-grants list. With a new in-memory
database it should display `No grants found.`.

## Test the OAuth connect and consent flow

The sample UI intentionally does not initiate OAuth connections. A trusted
service starts a connection, and the user reviews the resulting consent
request in the UI.

### 1. Start a provider connection

The following example starts a GitHub connection for the local guest user. The
response contains a one-time `authorizationUrl` and `sessionId`:

```bash
curl --fail --silent --show-error \
  -X POST \
  http://localhost:7007/api/secure-token-storage/connections/github/start \
  -H "Authorization: Bearer ${BACKSTAGE_EXTERNAL_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{
    "userEntityRef": "user:default/guest",
    "scopes": ["read:user"],
    "redirectUri": "http://localhost:7007/api/secure-token-storage/connections/github/callback"
  }'
```

Copy the `authorizationUrl` from the response into a browser. Sign in to the
provider and authorize the requested scopes. The provider redirects the
browser to the backend callback, which then redirects to the sample consent
page.

If the guest user entity reference differs in the running host, use the value
shown by the backend authentication logs instead of
`user:default/guest`.

### 2. Approve or reject the request

The consent page displays the provider and requested scopes. Select **Approve**
to create a caller-bound grant, or **Reject** to discard the connection
request. The grant list should show the provider, scopes, grant ID, and expiry
time after approval.

The page supports these user operations:

- **Revoke** invalidates one grant.
- **Disconnect provider** revokes the provider's grants and removes the
  provider connection.
- Refreshing the page reloads grants from the backend.

To test rejection, repeat the connection flow and select **Reject**. The
session is consumed and no grant should be created.

## Test service-authenticated token retrieval

Only a trusted service may call the token endpoint. Use the grant ID shown in
the consent page or returned by the grant-list API. Do not print or save the
access token.

The grants endpoint is user-authenticated, so it is simplest to inspect grants
in the browser UI. The token endpoint itself requires a service credential:

```bash
export GRANT_ID='copy-the-grant-id-from-the-ui'

curl --fail --silent --show-error \
  -X POST \
  http://localhost:7007/api/secure-token-storage/token \
  -H "Authorization: Bearer ${BACKSTAGE_EXTERNAL_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"grantId\":\"${GRANT_ID}\",\"provider\":\"github\"}" \
  | jq '{expiresAt, scopes, hasAccessToken: (.accessToken != null)}'
```

The filtered output should show `hasAccessToken: true`. The raw response
contains the provider access token and must be treated as secret material.
Never put it in workflow input, source control, shell history, screenshots, or
application logs.

Verify caller binding by changing the configured caller subject or using a
different service credential. The request should be rejected with a
`caller-not-authorized` error. After revoking the grant in the UI, repeating
the token request should return `grant-revoked` or another appropriate
denial.

## Optional Orchestrator and Podman test

The sample backend registers both the Orchestrator backend and the secure token
storage Orchestrator module. Its `app-config.yaml` is configured to start
SonataFlow in Podman dev mode:

```yaml
orchestrator:
  sonataFlowService:
    runtime: podman
    port: 8899
    autoStart: true
```

Before starting the backend, verify that Podman is available:

```bash
podman --version
podman ps
```

Start the backend using the command above. The Orchestrator integration clones
the configured workflow repository into
`packages/backend/.devModeTemp/repository` and uses
`host.containers.internal` so the SonataFlow container can reach the host
backend. Kafka is not configured in this sample, so event-triggered workflow
execution is disabled.

This validates sample-host startup and the secure-token-storage module
registration. The current prototype workflow consumer still accepts the grant
reference as workflow input; it does not yet make the runtime
`X-Provider-Token-Grants` header-to-operation mapping an end-to-end workflow
contract. Treat direct broker testing above as the authoritative validation of
grant authorization and token retrieval until that runtime slice is completed.

## Useful failure checks

| Symptom                                            | Check                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `enabled` is `false` or the route is missing       | Confirm `secureTokenStorage.enabled: true` and that the backend loads the secure token storage plugin.                        |
| Backend fails during startup because of encryption | Confirm `SECURE_TOKEN_STORAGE_ENCRYPTION_KEY` is set and decodes to 32 bytes.                                                 |
| `provider-not-configured`                          | Export the provider client ID and secret before starting the backend.                                                         |
| `invalid-redirect-uri`                             | Use the exact callback URL listed in `app-config.yaml` and registered with the provider.                                      |
| `caller-not-authorized`                            | Make `backend.auth.externalAccess.options.subject` match an entry in `secureTokenStorage.allowedCallerSubjects`.              |
| Consent page cannot load grants                    | Confirm the frontend is using `http://localhost:3000`, the backend is on port `7007`, and the guest auth provider is running. |
| Podman workflow startup fails                      | Check `podman ps`, container image availability, port `8899`, and the generated `packages/backend/.devModeTemp` directory.    |

## Reset the local test state

Stop the frontend and backend with `Ctrl-C`. Because the sample uses an
in-memory database, restarting the backend resets all grants and connections.
If the SonataFlow container remains running, inspect it with `podman ps` and
stop that specific development container before starting another test run.
