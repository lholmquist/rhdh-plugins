# Provider Token frontend plugin

New Frontend System plugin for the isolated provider-token prototype. It
registers a standalone **Provider connections** page at `/provider-token` in the
sample app. Signed-in users can connect a configured provider, review and
approve/reject a workflow client's requested scopes, inspect their own grants
and provider connections, revoke a grant, or disconnect a provider.

The page obtains safe provider/client choices from the backend and never
requests, stores, logs, or renders access or refresh tokens. It remains
independent of the existing secure-token-storage UI and does not add a section
to Settings > Authentication Providers.
