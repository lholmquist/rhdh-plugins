# Provider Token prototype workspace

This is an isolated prototype for RHDHPLAN-1661. It lives in the
`rhdh-plugins` monorepo as a new workspace and does not replace or share data
with `workspaces/secure-token-storage`.

Slices 0–5 are complete. Slice 6 adds an optional Orchestrator resolver module
and an access-token response compatible with the multi-step demo workflow. The
standalone provider-token page supports provider connection, explicit consent,
grant review/revocation, and provider disconnect. It displays only safe grant
and connection metadata; access and refresh tokens remain in the backend. The
sample configuration keeps `providerToken.enabled: false` and requires no
provider OAuth credentials until you opt in locally.

## Design baseline

- RHDH login is independent of provider connection and consent. Logging out
  does not revoke a provider grant.
- Workflows continue to use an opaque `grantId` as their provider-token
  reference. Access tokens are obtained just in time, not stored in workflow
  state.
- This workspace has its own plugin packages, database, configuration, and
  sample host. No grants or credentials are migrated from secure-token-storage.
- Keep the sample host isolated. The current secure-token-storage and
  provider-token implementations cannot both own the provider-settings
  singleton or Orchestrator grant-resolver slot in one host.

See [the implementation roadmap](../../docs/PLAN-RHDHPLAN-1661-provider-token-workspace.md)
for the full security model and remaining slices.

## Local setup and testing

See the [local setup and testing guide](./LOCAL_TESTING.md) for prerequisites,
GitHub OAuth configuration, opt-in backend settings, startup commands, a UI
test walkthrough, the multi-step workflow demo, and troubleshooting. Start
both the sample app and backend from this workspace root with `yarn dev`; the
guide covers the full setup.

The Orchestrator module is optional and must not be loaded alongside the
secure-token-storage resolver in one backend. The Settings > Authentication
Providers section is intentionally unchanged.
