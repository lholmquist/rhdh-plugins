# Provider Token backend plugin

Backend for provider-token grants. The plugin owns its database schema,
encryption key ring, permissions, provider adapter extension point, refresh-token
coordination, owner-scoped grant routes, and service-only access-token issue
route. `providerToken.enabled` defaults to `false`.

## Encryption configuration

When enabled, configure an active base64-encoded 32-byte AES key and a stable
version label:

```yaml
providerToken:
  enabled: true
  grantTtlDays: 30
  encryption:
    activeKey: ${PROVIDER_TOKEN_ENCRYPTION_KEY}
    activeKeyVersion: v1
    previousKeys: {}
```

Keep the key outside source control. During key rotation, move the former
active key into `previousKeys` under its existing version, then configure a new
active key and version. Existing ciphertext can be decrypted with its recorded
version; new writes use only the active version. The AES-GCM additional
authenticated data is bound to the owner, provider, and secret purpose.

## Provider modules

GitHub and Microsoft are optional backend modules. Configure only the provider
modules that should be available, and provide their OAuth client secrets via
environment variables:

```yaml
providerToken:
  enabled: true
  encryption:
    activeKey: ${PROVIDER_TOKEN_ENCRYPTION_KEY}
    activeKeyVersion: v1
  providers:
    github:
      clientId: ${PROVIDER_TOKEN_GITHUB_CLIENT_ID}
      clientSecret: ${PROVIDER_TOKEN_GITHUB_CLIENT_SECRET}
    microsoft:
      clientId: ${PROVIDER_TOKEN_MICROSOFT_CLIENT_ID}
      clientSecret: ${PROVIDER_TOKEN_MICROSOFT_CLIENT_SECRET}
      tenant: organizations
  clients:
    - id: workflow-service
      title: Workflow Service
      purpose: Run queued workflows using the user's approved provider scopes.
      allowedSubjects:
        - sonataflow
      providerScopes:
        github:
          - read:user
          - repo
          - read:org
        microsoft:
          - User.Read
  returnUrlAllowlist:
    - origin: http://localhost:3000
      pathPrefix: /provider-token
```

Register this callback URL with each provider OAuth application:
`{backend.baseUrl}/api/provider-token/v1/connect/callback`. The OAuth callback
is fixed by the backend; the browser's post-callback `returnUrl` is supplied to
`POST /v1/connect/sessions` and must match a configured origin and path prefix.
Only HTTPS return targets are accepted except for localhost development.
`grantTtlDays` defaults to 30 and must be an integer from 1 through 365.

When enabled, configure at least one client. Every client must include a
non-empty `providerScopes` mapping for each provider it should be able to
connect; a missing or invalid map prevents startup. Each grant records its
client and verified caller subject. Token issuance requires the authenticated service
subject to match the grant and to appear in that client's `allowedSubjects`.
The issue request cannot select a user, client, or provider; those values are
derived from the stored grant. User grant-list and revoke routes similarly
derive the owner from the verified Backstage user principal. Permission checks
are applied in addition to these ownership and caller checks; conditional
permission decisions are denied.

The user routes are `GET /v1/connect/options` (configured provider IDs, safe
client title/purpose metadata, and provider scope policy), `GET /v1/connections`, `GET /v1/grants`,
`DELETE /v1/grants/:grantId`, and `DELETE /v1/providers/:providerId`. Connect
uses `POST /v1/connect/sessions` with `{ provider, clientId, returnUrl }`;
the backend selects OAuth scopes from the matching client's
`providerScopes.<provider>` application configuration. Browser-supplied scopes
are rejected so a client cannot broaden the configured policy. Adapters add any
provider-specific refresh scope they require, such as `offline_access`; do not
put that scope in `providerScopes`. The endpoint returns a short-lived session
ID and provider authorization URL. The browser
returns through `GET /v1/connect/callback`, then loads
`GET /v1/connect/sessions/:sessionId` and submits an explicit
`POST /v1/connect/sessions/:sessionId/decision` with `{ decision: "approve" }`
or `{ decision: "deny" }`. Session reads and decisions are restricted to the
user who started the flow. The consent response contains the client title,
verified caller subject, purpose, provider, requested scopes, expiry, status,
and—after approval—the grant ID; it never contains OAuth credentials.

OAuth state is stored only as a hash and consumed once. PKCE verifiers and
temporary pending refresh credentials are encrypted. The authorization-code
exchange's access token stays in memory and is discarded; only the pending
refresh token is encrypted until the user's decision. Approval atomically
stores the provider refresh credential and grant. Denial clears pending
credentials and creates no grant. Expired connect sessions are periodically
removed. The connect/consent flow is independent of RHDH sign-in and logout;
ordinary logout does not revoke grants.

`POST /v1/access-tokens` accepts `{ grantId, provider?, context? }`, where
`provider` is an optional assertion checked against the grant, and `context` is
optional and has no effect on authorization or token scope; do not put
credentials or secrets in it. The route returns
`{ accessToken, expiresAt, scopes }` only to the authenticated, authorized
service caller. The `accessToken` field matches the broker contract
used by the Provider Token multi-step workflow demo; the workflow response
contains no user identity. Responses are marked `Cache-Control: no-store` and
`Pragma: no-cache`. No token is included in the grant list. Issuance is denied
if the provider cannot confirm that the returned token's actual scopes exactly
match the approved grant. Backend consumers should use
`ProviderTokenClient` from the node package instead of constructing these paths
or credentials themselves.

GitHub must be an OAuth App configured to issue expiring user access tokens.
Its authorization request asks for `offline_access`, and the adapter refuses a
response without an access-token expiry, refresh token, and refresh-token
expiry. Microsoft also requests `offline_access`; tenant-specific endpoints can
be selected with `tenant`. A configured provider without its backend module
fails closed when its connection or token operation is requested; connection
routes must check adapter registration before redirecting to a provider.
Disconnect always deletes the local provider credential and revokes its grants
first. GitHub then attempts best-effort upstream revocation using a newly
exchanged short-lived token; Microsoft has no provider-scoped revoke operation
in this prototype, so disconnect stops future local token issuance but cannot
invalidate a Microsoft access token already handed to a workflow before that
token expires.

## Persistence model

The plugin migrates three plugin-owned tables: encrypted provider refresh
secrets, owner/client-bound grants, and one-use connect sessions. Access tokens
are never represented by a database column. OAuth state is stored as a hash;
PKCE verifiers and refresh tokens use authenticated encryption. Grant list
responses are projected to safe metadata and do not contain secret fields.

The schema uses Knex operations supported by SQLite and PostgreSQL. Refreshes
hold a PostgreSQL row lock while reading, calling the provider, and persisting
rotated material. The SQLite sample uses process-local single-flight
coordination. Access tokens are cached in memory until their safety window and
are never persisted. Provider rejection is non-retryable; temporary provider
failures are retryable and do not cause an automatic retry loop.
