# Secure token storage

This workspace contains the secure token storage plugins and a full-stack
Backstage test host for Red Hat Developer Hub.

Secure token storage is opt-in. When enabled, it lets a user connect an OAuth
provider and approve an opaque, caller-bound grant that a trusted service or
workflow can exchange for a usable provider access token. Provider tokens are
encrypted at rest and are never placed in workflow input or sent to the
browser.

## Capabilities

The workspace currently provides:

- a root-scoped service contract in `secure-token-storage-node`;
- a feature-gated backend plugin and service factory;
- an unauthenticated health endpoint at
  `/api/secure-token-storage/health`;
- AES-256-GCM encrypted provider connection persistence with key-version
  rotation support;
- GitHub and Microsoft OAuth adapters with PKCE authorization-code exchange
  and access-token refresh;
- persistent, single-use OAuth connection sessions with exact redirect URI
  allowlists;
- user-approved, caller-bound grants with listing, refresh, revocation, and
  provider disconnect operations;
- service-authenticated token retrieval at
  `/api/secure-token-storage/token`;
- safe audit events for connection, consent, grant, token-use, refresh,
  denial, and disconnect activity;
- a publishable New Frontend System plugin with a provider connections and
  consent page; and
- an Orchestrator backend module that forwards explicit grants or resolves an
  active grant for the initiating user before invoking a workflow.

The backend deliberately does not expose raw token intake over HTTP. Provider
adapters exchange one-time authorization codes and store the resulting
credentials through the internal service boundary.

## Configuration essentials

An enabled deployment must configure:

- `secureTokenStorage.enabled: true`;
- one or more secret-backed OAuth providers;
- `secureTokenStorage.allowedCallerSubjects`;
- an exact `secureTokenStorage.oauth.allowedRedirectUris` allowlist; and
- a secret-backed, base64-encoded 32-byte
  `secureTokenStorage.encryption.activeKey`.

For example:

```yaml
secureTokenStorage:
  enabled: true
  allowedCallerSubjects:
    - sonataflow
  oauth:
    userConnection:
      callerSubject: sonataflow
      redirectUri: https://backstage.example.com/api/secure-token-storage/connections/github/callback
      scopes:
        - read:user
        - repo
        - read:org
    providers:
      github:
        clientId: ${GITHUB_CLIENT_ID}
        clientSecret: ${GITHUB_CLIENT_SECRET}
      microsoft:
        clientId: ${MICROSOFT_OAUTH_CLIENT_ID}
        clientSecret: ${MICROSOFT_OAUTH_CLIENT_SECRET}
        tenant: ${MICROSOFT_OAUTH_TENANT}
    allowedRedirectUris:
      - https://backstage.example.com/api/secure-token-storage/connections/github/callback
      - https://backstage.example.com/api/secure-token-storage/connections/microsoft/callback
  encryption:
    activeKey: ${SECURE_TOKEN_STORAGE_ENCRYPTION_KEY}
```

The caller subject resolved from a Backstage service credential must appear in
`allowedCallerSubjects`. Use a persistent production database and a managed
secret for the encryption key outside local development.

The GitHub scopes in this example allow the service to read the authenticated
user profile (`read:user`), list repositories available to the user including
private repositories (`repo`), and read organization and team membership
(`read:org`). GitHub OAuth Apps do not offer a read-only private repository
scope: `repo` also grants write access to public and private repositories. Use
a GitHub App with fine-grained permissions when that broader access is not
acceptable.

## Local test host

The `packages/` directory contains a Backstage frontend and backend configured
with secure token storage, GitHub sign-in, the local catalog entities, and the
Orchestrator plugins. The sample database is in-memory, so restarting the
backend removes its connections and grants.

After installing repository dependencies, the shortest startup path is:

```bash
cd /Users/lholmqui/develop/redhat-developer/rhdh-plugins/workspaces/secure-token-storage

export GITHUB_CLIENT_ID='<client-id>'
export GITHUB_CLIENT_SECRET='<client-secret>'
export SECURE_TOKEN_STORAGE_ENCRYPTION_KEY="$(
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
)"

podman machine start
PORT=3001 yarn dev
```

The frontend runs at [http://localhost:3001](http://localhost:3001), the
backend at [http://localhost:7008](http://localhost:7008), and the Provider
connections page at
[http://localhost:3001/secure-token-storage](http://localhost:3001/secure-token-storage).

For dependency installation, OAuth callback setup, GitHub connection and
consent, grant testing, automatic token refresh, and both direct and
Orchestrator UI workflow tests, follow the
[local testing guide](./LOCAL_TESTING.md).

The local `app-config.yaml` and its static service credential are for
development only and must not be reused in a shared or production deployment.
