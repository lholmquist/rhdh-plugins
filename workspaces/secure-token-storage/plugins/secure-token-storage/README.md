# Secure token storage frontend plugin

This New Frontend System plugin provides the **Provider connections** page at
`/secure-token-storage`. The page lets signed-in users connect an OAuth
provider, approve or reject a connection request, and list, refresh, revoke,
or disconnect their provider grants.

The browser only handles opaque grant metadata. Provider access and refresh
tokens remain in the secure token storage backend.

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
