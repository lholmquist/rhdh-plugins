# Provider Token Microsoft backend module

Optional provider-token adapter for the Microsoft identity platform. It uses
PKCE, tenant-specific OAuth v2 endpoints, `offline_access`, space-delimited
scope parsing, and refresh-token rotation when Microsoft returns a replacement.
The tenant, OAuth client ID, and client secret are configured under
`providerToken.providers.microsoft`; optional endpoint overrides support
controlled development/test environments.
