# Secure token storage local testing guide

This is the canonical guide for running the full-stack sample application in
`workspaces/secure-token-storage/packages`, creating a GitHub provider grant,
and using that grant from the provider-token-grant workflow.

The complete flow is:

1. A user signs in to Backstage and authorizes GitHub.
2. The secure-token-storage backend encrypts and stores the provider tokens.
3. The user approves an opaque, caller-bound grant.
4. Orchestrator passes the grant ID to a workflow in a request header. If the
   workflow form omits the grant ID, the backend can resolve an active grant
   for the initiating user.
5. The workflow presents the grant and its service credential to the broker.
6. The broker returns a usable provider access token to the trusted workflow,
   refreshing an expired provider token when possible.
7. The workflow uses the token immediately and returns only a sanitized GitHub
   profile.

The sample uses an in-memory SQLite database. Restarting the Backstage backend
removes all local connections, grants, and audit data.

## Prerequisites

Install or have access to:

- Node.js 22 or 24 and the repository's Yarn version;
- a GitHub OAuth application;
- `jq` for the filtered command-line checks;
- Podman for the sample Orchestrator development runtime; and
- Java 21 and Maven or `kn-workflow` for the standalone workflow test.

Configure the GitHub OAuth application with both callback URLs:

```text
http://localhost:7007/api/auth/github/handler/frame
http://localhost:7007/api/secure-token-storage/connections/github/callback
```

The first callback is for Backstage sign-in. The second is for the provider
connection whose token is stored by secure token storage.

The backend also has a Microsoft adapter. To test it, register this callback:

```text
http://localhost:7007/api/secure-token-storage/connections/microsoft/callback
```

Keep all OAuth credentials outside the repository.

## Install dependencies

From the repository root, install the workspace dependencies:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins
YARN_ENABLE_SCRIPTS=false yarn install --immutable
```

If a native dependency such as `better-sqlite3` has not been built for the
active Node.js version, rerun the workspace install with scripts enabled:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage
YARN_ENABLE_SCRIPTS=true yarn install
```

## Configure the environment

The current sample uses the same GitHub OAuth application for Backstage
sign-in and the secure-token-storage GitHub connection:

```bash
export GITHUB_CLIENT_ID='<client-id>'
export GITHUB_CLIENT_SECRET='<client-secret>'
```

Generate a base64-encoded 32-byte encryption key. Keep it stable for the
lifetime of the backend process:

```bash
export SECURE_TOKEN_STORAGE_ENCRYPTION_KEY="$(
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
)"
```

The sample contains this local-only Backstage service credential:

```bash
export BACKSTAGE_EXTERNAL_ACCESS_TOKEN='bXljdXJscGFzc3dkCg=='
```

Its configured subject is `sonataflow`, which matches
`secureTokenStorage.allowedCallerSubjects`. Do not use this credential in a
shared or production environment.

For Microsoft, the equivalent provider variables are:

```bash
export MICROSOFT_OAUTH_CLIENT_ID='<client-id>'
export MICROSOFT_OAUTH_CLIENT_SECRET='<client-secret>'
export MICROSOFT_OAUTH_TENANT='common'
```

## Start the sample application

Start the Podman machine before the backend so the Orchestrator plugin can
start its SonataFlow development container:

```bash
podman machine start
podman ps
```

From the sample workspace, start the frontend and backend together:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage
yarn dev
```

The environment variables from the previous section must be exported in this
terminal. The frontend runs on port `3000`, the Backstage backend on `7007`,
and the configured Podman-backed SonataFlow development runtime on `8080`.

For separate logs or backend debugging, use two terminals instead:

```bash
# Terminal 1
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage
yarn workspace backend start --config ../../app-config.yaml
```

```bash
# Terminal 2
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage
yarn workspace app start
```

Open [http://localhost:3000](http://localhost:3000) and sign in with GitHub.
The sample catalog contains `user:default/lholmquist`, which matches the
configured `usernameMatchingUserEntityName` resolver. If a different GitHub
account is used, update the local user entity in `examples/org.yaml` so its
name matches the GitHub username, then restart the backend.

Guest sign-in remains available for basic UI testing, but the GitHub identity
is the intended end-to-end path.

## Smoke-test the broker

The health endpoint does not require authentication:

```bash
curl --fail http://localhost:7007/api/secure-token-storage/health
```

Expected response:

```json
{ "enabled": true }
```

Open the **Provider connections** page at
[http://localhost:3000/secure-token-storage](http://localhost:3000/secure-token-storage).
With a new in-memory database, the active-grants section should display
`No grants found.`

## Connect GitHub and approve a grant

### Recommended UI flow

Select **Connect GitHub** on the Provider connections page. The frontend asks
the backend to create a one-time connection session and then navigates to
GitHub automatically. The `sonataflow` service credential is never exposed to
the browser.

After authorizing GitHub, the callback returns to the Provider connections
page. Select **Approve** to create a caller-bound grant, or **Reject** to
discard the connection request.

After approval, the active-grants section shows the provider, scopes, grant
ID, and expiration time. Copy the grant ID when running the direct broker or
standalone workflow tests below:

```bash
export GRANT_ID='<grant-id-from-active-grants>'
```

The page supports these operations:

- **Refresh** extends an expired or expiring grant while preserving its grant
  ID.
- **Revoke** invalidates one grant and removes it from the active list.
- **Disconnect provider** revokes the provider's grants and removes its stored
  connection.

### Optional trusted-service flow

The service-authenticated endpoint remains available for integrations and
low-level testing:

```bash
CONNECTION_RESPONSE="$(
  curl --fail --silent --show-error \
    -X POST \
    http://localhost:7007/api/secure-token-storage/connections/github/start \
    -H "Authorization: Bearer ${BACKSTAGE_EXTERNAL_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{
      "userEntityRef": "user:default/lholmquist",
      "scopes": ["read:user"],
      "redirectUri": "http://localhost:7007/api/secure-token-storage/connections/github/callback"
    }'
)"

printf '%s' "$CONNECTION_RESPONSE" | jq -r .authorizationUrl
```

Open the printed authorization URL once. OAuth connection state is
single-use, so generate a new URL if the callback returns
`connect-session-consumed`.

## Test service-authenticated token retrieval

Only a trusted service may call the token endpoint. The following command
filters the secret from the displayed response:

```bash
curl --fail --silent --show-error \
  -X POST \
  http://localhost:7007/api/secure-token-storage/token \
  -H "Authorization: Bearer ${BACKSTAGE_EXTERNAL_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"grantId\":\"${GRANT_ID}\",\"provider\":\"github\"}" \
  | jq '{expiresAt, scopes, hasAccessToken: (.accessToken != null)}'
```

The output should contain `"hasAccessToken": true`. The raw response contains
the provider access token. Never put it in workflow input, source control,
shell history, screenshots, or application logs.

Verify caller binding by using a service credential with a different subject.
The broker should return `caller-not-authorized`. After revoking the grant in
the UI, repeating the token request should return `grant-revoked` or another
appropriate denial.

## Run the provider-token-grant workflow

The current workflow consumer is located at:

```text
/Users/lholmqui/develop/rhdhorchestrator/orchestrator-demo/10_provider_token_grant
```

It accepts a grant in either of these forms:

- normal workflow input: `{ "grantId": "...", "provider": "github" }`; or
- the `X-Provider-Token-Grant-Github` request header.

The workflow exchanges the opaque grant through the broker, calls GitHub's
`/user` endpoint, and returns only the profile's `id`, `login`, and `name`.
Provider token material is not added to workflow state.

The sample's Podman dev runtime already uses port `8080`, so use `18080` for a
standalone workflow consumer test:

```bash
cd /Users/lholmqui/develop/rhdhorchestrator/orchestrator-demo/10_provider_token_grant

export SECURE_TOKEN_STORAGE_URL='http://localhost:7007/api/secure-token-storage/token'
export SECURE_TOKEN_STORAGE_SERVICE_TOKEN="${BACKSTAGE_EXTERNAL_ACCESS_TOKEN}"

mvn -q quarkus:dev -Dquarkus.http.port=18080
```

Run it with the grant as workflow input:

```bash
curl --fail --silent --show-error \
  -X POST \
  http://localhost:18080/provider-token-grant \
  -H 'Content-Type: application/json' \
  -d "{\"grantId\":\"${GRANT_ID}\",\"provider\":\"github\"}" \
  | jq
```

Or validate the Orchestrator header contract directly:

```bash
curl --fail --silent --show-error \
  -X POST \
  http://localhost:18080/provider-token-grant \
  -H 'Content-Type: application/json' \
  -H "X-Provider-Token-Grant-Github: ${GRANT_ID}" \
  -d '{}' \
  | jq
```

The completed workflow data should contain a sanitized `profile` object and
must not contain an access token.

### Orchestrator behavior

The sample backend registers the secure-token-storage Orchestrator module.
When a workflow is run through Orchestrator:

- an explicit top-level `grantId` and `provider` from the workflow form are
  forwarded as `providerTokenGrants`;
- Orchestrator sends `X-Provider-Token-Grant-Github` plus the aggregate
  `X-Provider-Token-Grants` header to SonataFlow;
- if the form omits `grantId`, the backend queries secure token storage for an
  active grant belonging to the initiating user and provider; and
- if both provider and grant ID are omitted, automatic resolution occurs only
  when the user has exactly one unambiguous active provider grant.

The local `10_provider_token_grant` workflow must be run or deployed in the
SonataFlow/Data Index environment configured for Orchestrator before it appears
in the Orchestrator UI. Starting it standalone on port `18080` validates the
workflow-to-broker contract but does not register it in the sample's separate
Podman dev runtime.

## Test automatic GitHub access-token refresh

The broker refreshes an expired provider access token when the workflow or
another trusted service requests it. It uses the refresh token server-side,
encrypts the new access token and any rotated refresh token back into the
connection, and returns only the usable access token. The grant ID does not
change.

GitHub expiring user tokens are normally valid for eight hours, so the fastest
local test is to simulate expiration in the debugger. GitHub must issue a
refresh token for this test. The adapter requests `offline_access`; reconnect
the provider after enabling expiring user tokens for the GitHub application if
the existing connection does not have a refresh token.

1. Start the backend with the **Launch Secure Token Storage Workspace** VS Code
   configuration and the environment variables described above.
2. Set a breakpoint at the expiration check in
   `plugins/secure-token-storage-backend/src/service.ts`, around line 647.
3. Trigger the direct token request above or run the workflow.
4. When execution stops, enter this in the VS Code Debug Console:

   ```js
   connection.accessTokenExpiresAt = new Date(0);
   ```

5. Continue execution. The code should enter the refresh path and reach the
   GitHub refresher in
   `plugins/secure-token-storage-backend/src/providers.ts`, around line 202.

The request should still report `hasAccessToken: true`, and the backend should
update the encrypted connection data. Do not print the raw token.

`provider-refresh-required` means that the connection has no usable refresh
token or no refresher is configured. `grant-expired` means the grant itself,
not the provider access token, has expired; refresh or reapprove the grant.

## Verify grant enforcement

Revoke the grant from the Provider connections page and invoke the direct
broker request or workflow again. The broker should reject the grant, and the
workflow should fail without logging or returning token material.

Select **Disconnect provider** to remove the stored connection and revoke all
of its grants. Reconnect and approve again to create a new active connection
and grant.

## Troubleshooting

| Symptom                                  | Check                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `provider-not-configured`                | Export `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` before starting the backend.                                         |
| `connect-session-consumed`               | Generate and use a new authorization URL; connection state is intentionally single-use.                                   |
| `invalid-redirect-uri`                   | Use the exact callback URL in `app-config.yaml` and registered with GitHub.                                               |
| GitHub sign-in cannot resolve the user   | Confirm the GitHub username matches the `User` entity name in `examples/org.yaml`.                                        |
| `caller-not-authorized`                  | Confirm the service token maps to `sonataflow`, which must remain in `allowedCallerSubjects`.                             |
| Provider connections cannot load grants  | Confirm the frontend is on port `3000`, the backend is on `7007`, and the browser has an authenticated Backstage session. |
| `provider-refresh-required`              | Reconnect after enabling GitHub expiring user tokens so the stored connection includes a refresh token.                   |
| Standalone workflow cannot reach broker  | Use `localhost` for a host process and `host.containers.internal` for a Podman container.                                 |
| Workflow service token is missing        | Export `SECURE_TOKEN_STORAGE_SERVICE_TOKEN` in the workflow terminal.                                                     |
| Podman runtime startup fails             | Check `podman ps`, image availability, port `8080`, and `packages/backend/.devModeTemp`.                                  |
| Data disappears after restarting backend | The sample intentionally uses an in-memory SQLite database.                                                               |

## Reset the local test state

Stop the application and workflow with `Ctrl-C`. Restarting the Backstage
backend resets all grants and connections because the database is in memory.
If the SonataFlow development container remains, identify it with `podman ps`
and stop only that container before the next run.
