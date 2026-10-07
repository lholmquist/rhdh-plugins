# Debugging Provider Token refresh behavior

This guide shows where to set breakpoints and how to make the access-token
cache take the refresh path quickly while debugging the local Provider Token
sample in Cursor. It does not shorten the lifetime of a token issued by GitHub;
it changes only when Provider Token considers its in-memory cached token safe to
reuse.

## Before you start

Complete the app and GitHub OAuth setup in [LOCAL_TESTING.md](./LOCAL_TESTING.md),
including `app-config.local.yaml` and its environment variables. Stop any other
sample currently using ports 3000 or 7007.

The sample uses in-memory SQLite. Start the debugger before connecting GitHub
and approving a grant; restarting the backend clears the sample's connections
and grants, so you would need to connect and approve again after a restart.

## Start the debugger

Open the repository root in Cursor, open **Run and Debug**, and select
**Launch Provider Token Workspace**. That local launch entry starts the app
and backend with child-process debugging and source maps. The encryption key
and GitHub OAuth credentials must be present in Cursor's environment when you
start the configuration.

## Set breakpoints

Set breakpoints at these locations:

1. [`token-service.ts`](./plugins/provider-token-backend/src/token-service.ts#L849)
   — the cache decision. Inspect `cached.usableUntil` and the current time. If
   the cached token is still usable, execution returns from this method without
   calling the provider.
2. [`token-service.ts`](./plugins/provider-token-backend/src/token-service.ts#L962)
   — the call to the provider adapter's `refreshAccessToken` method. This is
   the key breakpoint for confirming a refresh is requested.
3. [`adapter.ts`](./plugins/provider-token-backend-module-github/src/adapter.ts#L158)
   — GitHub's refresh-token adapter method. Step through the request and
   response parsing without copying or sharing credential values.
4. [`token-service.ts`](./plugins/provider-token-backend/src/token-service.ts#L1034)
   — persistence of any rotated, encrypted refresh token before the new access
   token is returned.
5. Optionally, [`token-service.ts`](./plugins/provider-token-backend/src/token-service.ts#L1077)
   — caching the new access token and calculating when it is no longer safe to
   reuse.

The request reaches the service through
[`router.ts`](./plugins/provider-token-backend/src/router.ts#L567). Add a
breakpoint there if you also want to step from the HTTP endpoint into the
service.

## Make the refresh path happen quickly

By default, Provider Token stops reusing an in-memory access token 60 seconds
before its provider-reported expiry. A real GitHub credential may take hours to
reach that window, and the sample has no app-config setting to shorten GitHub's
actual token lifetime.

For a quick interactive demonstration, temporarily change the fallback in the
`ProviderTokenService` constructor in
[`token-service.ts`](./plugins/provider-token-backend/src/token-service.ts#L154):

```ts
this.cacheSafetyWindowMs = options.cacheSafetyWindowMs ?? 24 * 60 * 60 * 1000;
```

The normal default is `60_000`. Use a temporary value larger than the
provider-reported access-token lifetime. The example above makes a normal
short-lived GitHub access token immediately fall outside the cache's safe-use
window. It does **not** make GitHub issue an already-expired token.

With this temporary change in place:

1. Start **Launch Provider Token Workspace**.
2. Connect GitHub and approve a new grant in the Provider Token UI.
3. Request a token once using the workflow in [LOCAL_TESTING.md](./LOCAL_TESTING.md)
   or the documented `POST /api/provider-token/v1/access-tokens` endpoint. The
   first request refreshes because this backend process has no cached token
   yet; this also populates the in-memory cache. Access tokens are not persisted
   across backend restarts.
4. Make the same token request again with the same grant. At the cache-decision
   breakpoint, the cached token exists but `usableUntil` is already in the
   past. Continue execution and confirm it reaches `refreshAccessToken`, then
   the persistence breakpoint.
5. Check that the response has a new `expiresAt`. Do not copy access or refresh
   token values from the debugger or include them in logs or screenshots.

The first request demonstrates a refresh on a cold cache. The second request
demonstrates that a cached token outside its safe-use window is refreshed. With
the temporary 24-hour safety window, the second request is an early refresh,
not proof that GitHub's token itself has expired.

## Restore the normal behavior

Restore the constructor fallback to `60_000` as soon as you finish debugging.
Do not commit the temporary safety-window change. Because this sample uses
in-memory SQLite, stopping or restarting the backend clears the grant; after a
restart, reconnect GitHub and approve a grant again before making another token
request.

For a deterministic automated test of the actual time boundary, use the
`now` and `cacheSafetyWindowMs` options accepted by `ProviderTokenService` in
[`token-service.test.ts`](./plugins/provider-token-backend/src/token-service.test.ts).
A test can advance its fake clock past `usableUntil` and assert that the adapter
is called again, without waiting for a real provider token to expire.
