# Secure token storage full local example

This guide runs the secure-token-storage sample Backstage application, creates
a GitHub provider grant, and uses that grant from the experimental SonataFlow
workflow in the local `serverless-workflows` repository.

The sample uses an in-memory SQLite database. Restarting the Backstage backend
deletes all provider connections and grants.

## Current integration boundary

The experimental workflow validates the complete broker-to-workflow consumer:

1. The user authorizes GitHub.
2. The secure-token-storage backend encrypts and stores the provider token.
3. The user approves an opaque, caller-bound grant.
4. The workflow presents the grant to the broker using its Backstage service
   credential.
5. The workflow uses the returned short-lived access token immediately and
   returns only a sanitized GitHub profile.

The workflow currently accepts the grant ID directly as workflow input.
Automatic mapping from Orchestrator's `X-Provider-Token-Grants` header is not
implemented yet, so this workflow does not run end to end from the Orchestrator
UI.

The local workflow is located at:

```text
/Users/lholmqui/develop/rhdhorchestrator/serverless-workflows/workflows/experimentals/provider-token-grant
```

The workflow directory is currently untracked in the `serverless-workflows`
checkout. Preserve it before switching branches or cleaning that repository.

## 1. Configure GitHub OAuth

Configure the GitHub OAuth application to allow these callback URLs:

```text
http://localhost:7007/api/auth/github/handler/frame
http://localhost:7007/api/secure-token-storage/connections/github/callback
```

The current sample configuration uses the same variables for Backstage GitHub
sign-in and the secure-token-storage GitHub connection:

```bash
export GITHUB_CLIENT_ID='<client-id>'
export GITHUB_CLIENT_SECRET='<client-secret>'
```

The `GITHUB_OAUTH_*` variables mentioned in the older local-testing guide are
not used by the current `app-config.yaml`.

## 2. Install and configure the sample

Use Node.js 22 and install dependencies from the secure-token-storage
workspace:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage

export PATH="/Users/lholmqui/.nvm/versions/node/v22.23.2/bin:$PATH"

YARN_ENABLE_SCRIPTS=false yarn install --immutable
```

If `better-sqlite3` reports that it was built for a different Node ABI, rebuild
native dependencies with scripts enabled:

```bash
YARN_ENABLE_SCRIPTS=true yarn install
```

Generate a local encryption key and configure the sample Backstage service
credential:

```bash
export SECURE_TOKEN_STORAGE_ENCRYPTION_KEY="$(
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
)"

export BACKSTAGE_EXTERNAL_ACCESS_TOKEN='bXljdXJscGFzc3dkCg=='
```

The static token is for local development only. Its configured Backstage
service subject is `sonataflow`, which matches the secure-token-storage caller
allowlist.

## 3. Start Podman

The sample Orchestrator backend is configured to start its SonataFlow
development runtime through Podman on port `8899`:

```bash
podman machine start
podman ps
```

If the Podman machine is already running, continue to the next step.

## 4. Start the sample application

Start the backend in one terminal. Export the GitHub credentials, encryption
key, and external-access token in this terminal before running the command:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage

yarn workspace backend start --config ../../app-config.yaml
```

Start the frontend in another terminal:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage

yarn workspace app start
```

Open <http://localhost:3000>, sign in with GitHub, and use the catalog identity
`user:default/lholmquist`. The sample catalog contains the matching
`lholmquist` user entity.

Verify the broker health endpoint:

```bash
curl --fail http://localhost:7007/api/secure-token-storage/health
```

The expected response is:

```json
{ "enabled": true }
```

Do not restart the backend after creating a connection or grant. The in-memory
database will be reset.

## 5. Connect GitHub

The sample UI includes a **Connect GitHub** button. It calls the backend using
the signed-in Backstage user session, receives the one-time authorization URL,
and navigates to GitHub automatically. The SonataFlow service credential is
not exposed to the browser.

Open <http://localhost:3000/secure-token-storage> and select **Connect GitHub**.
Authenticate with GitHub and authorize the requested access. The GitHub
callback redirects to the provider-connections page.

The trusted-service request remains available for workflow integrations and can
also be used to reproduce the flow from a terminal:

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

Open the printed authorization URL in a browser and authorize GitHub access.
The GitHub callback redirects to the provider-connections page at
<http://localhost:3000/secure-token-storage>.

Select **Approve**. Copy the grant ID from the success message before
refreshing the page:

```text
Connected github. Grant <grant-id> is ready.
```

Set the copied value in the shell:

```bash
export GRANT_ID='<grant-id>'
```

## 6. Smoke-test the broker

Call the broker directly while filtering the secret access token from the
displayed response:

```bash
curl --fail --silent --show-error \
  -X POST \
  http://localhost:7007/api/secure-token-storage/token \
  -H "Authorization: Bearer ${BACKSTAGE_EXTERNAL_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"grantId\":\"${GRANT_ID}\",\"provider\":\"github\"}" \
  | jq '{expiresAt, scopes, hasAccessToken: (.accessToken != null)}'
```

The output should contain `"hasAccessToken": true`. Do not print, persist, or
copy the unfiltered token response.

## 7. Run the experimental workflow

The workflow directory does not contain a Maven wrapper. Use the installed
`mvn` command:

```bash
cd /Users/lholmqui/develop/rhdhorchestrator/serverless-workflows/workflows/experimentals/provider-token-grant

export SECURE_TOKEN_STORAGE_URL='http://localhost:7007/api/secure-token-storage/token'
export SECURE_TOKEN_STORAGE_SERVICE_TOKEN="${BACKSTAGE_EXTERNAL_ACCESS_TOKEN}"

mvn quarkus:dev
```

The workflow runs on the host on port `8080`, so it reaches the broker through
`localhost`. Use `host.containers.internal` only if the workflow itself is
running inside a Podman container.

Start the workflow from another terminal:

```bash
curl --fail --silent --show-error \
  -X POST \
  http://localhost:8080/provider-token-grant \
  -H 'Content-Type: application/json' \
  -d "{\"grantId\":\"${GRANT_ID}\",\"provider\":\"github\"}" \
  | jq
```

The completed workflow data should contain a `profile` object with the GitHub
user's `id`, `login`, and `name`. It must not contain an access token.

## 8. Verify grant enforcement

Revoke the grant from the provider-connections page and invoke the workflow
again. The broker should reject the grant and the workflow should fail without
logging or returning token material.

Selecting **Disconnect provider** revokes the provider connection and all its
grants.

## Troubleshooting

| Symptom                                    | Check                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `provider-not-configured`                  | Export `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` before starting the backend.          |
| `connect-session-consumed`                 | Generate and use a new authorization URL; OAuth connect state is intentionally single-use. |
| `caller-not-authorized`                    | Confirm the service token maps to the `sonataflow` subject.                                |
| Consent approval is unavailable            | Confirm the GitHub user maps to `user:default/lholmquist`.                                 |
| Workflow cannot reach the broker           | Use `localhost` for host Maven and `host.containers.internal` for a Podman container.      |
| Workflow says its service token is missing | Export `SECURE_TOKEN_STORAGE_SERVICE_TOKEN` in the workflow terminal.                      |
| Data disappears after restart              | The sample intentionally uses an in-memory SQLite database.                                |
