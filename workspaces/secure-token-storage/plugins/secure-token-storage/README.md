# Secure token storage frontend plugin

This New Frontend System plugin provides the **Provider connections** page at
`/secure-token-storage`. The page lets signed-in users connect an OAuth
provider, approve or reject a connection request, and list, refresh, revoke,
or disconnect their provider grants.

The browser only handles opaque grant metadata. Provider access and refresh
tokens remain in the secure token storage backend.

Set `secureTokenStorage.oauth.consentUrl` to the standalone
`/secure-token-storage` route so the OAuth callback returns there for grant
approval and grant management.

Authentication sessions and workflow grants intentionally have independent
lifecycles:

- A user can sign in to RHDH with provider A and connect provider B for trusted
  background workflows.
- Signing out of RHDH, or signing out of an ordinary authentication provider,
  does not disconnect providers or revoke workflow grants.
- The same Backstage user sees their stored workflow connections and grants the
  next time they sign in, regardless of which login provider resolved that
  session to the same `userEntityRef`.
- Only the **Disconnect provider** and **Revoke** actions on the Provider
  connections page alter stored workflow access.

The backend database must be durable if connections and grants also need to
survive a backend restart. The sample's in-memory database is intended only for
local development.

Install the package and add its default export to the app's frontend features:

```tsx
import secureTokenStoragePlugin from '@red-hat-developer-hub/backstage-plugin-secure-token-storage';

export default createApp({
  features: [secureTokenStoragePlugin],
});
```

The plugin expects the
`@red-hat-developer-hub/backstage-plugin-secure-token-storage-backend` plugin
to be installed and configured. See the workspace
[local testing guide](../../LOCAL_TESTING.md) for a complete example.
