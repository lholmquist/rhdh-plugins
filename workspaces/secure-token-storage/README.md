# Secure token storage

This workspace contains the standalone secure token storage foundation for
Red Hat Developer Hub.

The first implementation slice provides:

- a root-scoped service contract in `secure-token-storage-node`;
- a feature-gated backend plugin and service factory;
- a local backend host with an unauthenticated health endpoint at
  `/api/secure-token-storage/health`;
- AES-256-GCM encrypted provider connection persistence with key-version
  rotation support;
- persistent PKCE OAuth connect sessions with exact redirect allowlists; and
- user-approved caller-bound grants, grant listing and revocation, provider
  disconnect, and service-authenticated access token retrieval at
  `/api/secure-token-storage/token`; and
- safe audit events for grant lifecycle, token use and refresh, consent
  decisions, denials, and provider disconnects.

The implementation deliberately does not expose raw token intake over HTTP:
GitHub and Microsoft adapters exchange one-time authorization codes and the
callback stores the resulting credentials through the service boundary. Enabled
deployments must configure
`secureTokenStorage.allowedCallerSubjects`, an exact
`secureTokenStorage.oauth.allowedRedirectUris` allowlist, and a secret-backed
`secureTokenStorage.encryption.activeKey`.

Configure provider credentials only through secret-backed configuration:

```yaml
secureTokenStorage:
  oauth:
    providers:
      github:
        clientId: ${GITHUB_OAUTH_CLIENT_ID}
        clientSecret: ${GITHUB_OAUTH_CLIENT_SECRET}
      microsoft:
        clientId: ${MICROSOFT_OAUTH_CLIENT_ID}
        clientSecret: ${MICROSOFT_OAUTH_CLIENT_SECRET}
        tenant: ${MICROSOFT_OAUTH_TENANT}
```

## Local test host

The workspace includes a small full-stack Backstage host under `packages/`.
Install dependencies with native build scripts enabled, then start the backend
and frontend in separate terminals:

```bash
YARN_ENABLE_SCRIPTS=true yarn install
export SECURE_TOKEN_STORAGE_ENCRYPTION_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
yarn workspace backend start --config ../../app-config.yaml
yarn workspace app start
```

The backend exposes the broker at `/api/secure-token-storage`; the main OAuth
route families are `/connections/:provider/start`,
`/connections/:provider/callback`, and `/connections/:sessionId/consent`.
Authenticated users can inspect `/grants`, revoke an individual grant, or
disconnect a provider. The unauthenticated health check is
`/api/secure-token-storage/health`. The local configuration uses an in-memory
SQLite database and must not be reused as a production configuration. The
local host does not register a provider adapter unless these provider settings
are supplied.
