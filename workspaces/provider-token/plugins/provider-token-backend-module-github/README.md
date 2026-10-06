# Provider Token GitHub backend module

Optional provider-token adapter for GitHub OAuth Apps. It uses PKCE and
`offline_access`, parses comma-separated granted scopes, exchanges authorization
codes, and rotates GitHub's refresh-token pair. The adapter requires expiring
access-token and refresh-token lifetimes; classic OAuth credentials without a
refresh token and PATs are not accepted by this flow.

Configure `providerToken.providers.github.clientId` and `clientSecret` as
secrets. `authorizationUrl` and `tokenUrl` may be overridden for controlled
development/test environments; production defaults use GitHub.com.
