# RHIDP-15907: extension-seam decision record

## Decision

The first implementation uses an additive secure-token-storage backend plugin
and a separate OAuth connect flow. It does not override `coreServices.auth` or
replace registered auth providers.

## Evidence

- Backstage `1.54.0` exposes `coreServices.auth` for Backstage request and
  service-to-service credentials, not provider-token persistence.
- The new backend plugin system can register a root-scoped service factory,
  database migrations, and authenticated HTTP routes without changing existing
  auth APIs.
- The service retrieves a token only after checking the opaque grant, provider,
  expiry, and verified service subject. Encrypted token material is not touched
  for rejected callers.
- The service response contains only an access token, expiry, and approved
  scopes. Refresh tokens remain inside the broker.

## Consequences

The prototype can be implemented in `rhdh-plugins` and can preserve the current
Orchestrator `authTokens` path while the grant path is added. It cannot
transparently capture already-established provider sessions until Backstage
adds a provider-token storage extension point. A future upstream proposal should
add that hook to `auth-node`/`auth-backend` rather than overload the request-auth
core service.

## Remaining spike work

- Validate the GitHub and Microsoft adapters against configured app
  registrations, including provider-specific reauthentication errors.
- Add a user-facing connect/consent experience on top of the backend routes
  without accepting raw tokens from an untrusted HTTP caller.
- Confirm the SonataFlow call-time retrieval boundary with the Orchestrator and
  security owners.
- Record threat-model review and security-team validation.
