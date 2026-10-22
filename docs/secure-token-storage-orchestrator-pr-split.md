# Secure Token Storage and Orchestrator PR Split

## Purpose

This note assesses how to submit the Secure Token Storage plugin separately
from the Orchestrator changes. It is an implementation plan only; no plugin or
Orchestrator code was changed as part of this analysis.

## Short answer

The work can be split, but the current Secure Token Storage backend package is
not fully decoupled from the new Orchestrator API. Its default backend feature
loader always includes an Orchestrator module, and that module imports a new
extension point from `orchestrator-node`. The sample workspace also resolves
Orchestrator packages directly from the sibling `workspaces/orchestrator`
checkout.

The cleanest sequence is:

1. **Secure Token Storage core PR:** submit the provider connection, consent,
   grant storage/management, token retrieval and refresh functionality without
   the Orchestrator resolver module. Keep the ordinary workflow-input path
   usable: a workflow can receive a `grantId` and provider in its input and call
   the Secure Token Storage token endpoint.
2. **Orchestrator PR:** add the Orchestrator-owned grant-reference contract and
   its workflow request/forwarding support. This PR should not depend on the
   Secure Token Storage implementation; the resolver remains optional.
3. **Secure Token Storage–Orchestrator integration PR:** add the resolver module
   back as an integration package/module, depending on the Orchestrator version
   that exports the extension point.

Steps 2 and 3 can be coordinated or reviewed together, but keeping them as
separate merge units makes the plugin core independently reviewable and
releasable.

## What belongs to Secure Token Storage itself

The plugin owns provider OAuth connection and consent, encrypted token and
grant persistence, grant lifecycle operations, provider refresh behavior, and
the authorized token-retrieval endpoint. These capabilities do not inherently
require Orchestrator. A workflow can use the existing explicit-input contract
by receiving `{ "grantId": "...", "provider": "github" }` and calling the
plugin endpoint. The local guide already documents this direct workflow path
and the separate Orchestrator UI path; see
[`LOCAL_TESTING.md`](../workspaces/secure-token-storage/LOCAL_TESTING.md),
especially its workflow-input and direct-call sections.

The UI, backend service, OAuth adapters, persistence, token endpoint, and their
tests are therefore suitable for the core plugin PR. The backend service
surface used by an eventual integration module is in
`workspaces/secure-token-storage/plugins/secure-token-storage-node/src/index.ts`.

## What belongs to Orchestrator

The Orchestrator-side change is more than adding a header. It:

- defines and exports a provider-grant reference and resolver extension point
  from `orchestrator-node`;
- accepts optional grant references in workflow execution/retrigger API
  contracts and generated OpenAPI/client types;
- lets the workflow UI forward an explicit grant reference without removing
  the original workflow inputs;
- optionally resolves an active grant for the initiating user when the request
  does not include one;
- forwards the reference to direct HTTP workflows as headers and to
  CloudEvent/Kafka workflows as event data; and
- includes corresponding tests and package changesets.

The reference is an identifier, not an access token. Orchestrator forwards the
grant reference; the workflow subsequently calls the token endpoint to obtain
the provider access token. Relevant source areas include
`workspaces/orchestrator/plugins/orchestrator-node/src/extensions.ts`,
`workspaces/orchestrator/plugins/orchestrator-backend/src/service/SonataFlowService.ts`,
`workspaces/orchestrator/plugins/orchestrator-backend/src/service/api/v2.ts`,
and `workspaces/orchestrator/plugins/orchestrator/src/components/ExecuteWorkflowPage/ExecuteWorkflowPage.tsx`.

One detail for scoping the integration: the current workflow-start path calls
the resolver's `resolveProviderTokenGrant` method for automatic lookup. The
resolver contract also includes `getAccessToken`, and the Secure Token Storage
module implements it, but Orchestrator's workflow-start path does not call that
method. The workflow's call to the Secure Token Storage token endpoint remains
the token-exchange step.

## Current coupling to remove or defer

The following points make the current Secure Token Storage workspace depend on
the Orchestrator feature branch:

1. `plugins/secure-token-storage-backend/src/orchestrator-module.ts` imports
   `providerTokenGrantExtensionPoint` from the Orchestrator Node package and
   registers Secure Token Storage as its resolver.
2. `plugins/secure-token-storage-backend/src/index.ts` exports and yields that
   module from the backend package's default feature loader. It is therefore
   loaded with the core plugin rather than being an optional integration.
3. `plugins/secure-token-storage-backend/package.json` declares
   `@red-hat-developer-hub/backstage-plugin-orchestrator-node` as a dependency.
   The extension point is an in-repository addition, so depending on the
   currently published version alone does not provide this export.
4. The workspace root `package.json` uses `portal:../orchestrator/...`
   resolutions for Orchestrator packages, and the lockfile records those local
   links. That is convenient for joint development but ties this sample
   workspace's install/build to the sibling Orchestrator checkout.
5. `LOCAL_TESTING.md` currently describes automatic grant lookup and header
   forwarding in the same guide as standalone plugin testing. Those steps
   should be labelled as requiring the Orchestrator integration; the direct
   workflow-input test can remain in the core guide.

The sample application can continue to include the published Orchestrator UI
and backend for the explicit-input demo. To make the core plugin workspace
independently buildable, its dependency resolution should use compatible
published Orchestrator packages rather than local portals, or the sample app's
Orchestrator demo dependency should be separated from the plugin build.

## Proposed PR boundaries

### PR 1 — Secure Token Storage core

Include the plugin packages, migrations, OAuth providers, UI/settings
integration, backend API/service, token refresh, tests, changesets, and
standalone testing documentation.

For this PR, omit the Orchestrator resolver integration from the backend
package's default loader and remove its direct `orchestrator-node` dependency.
Keep the sample workflow test based on explicit `grantId`/provider input. The
sample app may demonstrate that flow with a compatible published Orchestrator
release, but should not require local Orchestrator source portals to build the
plugin workspace.

### PR 2 — Orchestrator grant-reference support

Include the Orchestrator extension-point contract, API/OpenAPI/client and UI
plumbing, optional grant resolution, HTTP/event forwarding, retrigger support,
tests, generated artifacts, and changesets. The resolver should remain
optional, so Orchestrator without a grant provider retains its existing
workflow behavior.

This PR can be merged without Secure Token Storage. It provides the integration
seam, but automatic lookup will not return a grant until a resolver module is
installed.

### PR 3 — Secure Token Storage resolver integration

Add a dedicated optional backend module/package that implements the
Orchestrator resolver using Secure Token Storage's service API. It should
register the module only when the Orchestrator extension-point version it
depends on is available. Update dynamic-plugin/package metadata, sample backend
registration, relevant changesets, tests, and the Orchestrator-specific part of
the local testing guide.

Making this a separate backend-module package is the strongest package-level
boundary. A smaller alternative is to restore the module in the existing
backend package after PR 2 lands, but that means the core plugin artifact still
has an Orchestrator dependency and cannot be released independently from that
API.

## Compatibility and expected behavior between PRs

- After PR 1, users can connect providers, approve/revoke grants, and use a
  workflow that receives the grant reference in its normal input and calls the
  token endpoint. No new Orchestrator header or automatic lookup is promised.
- After PR 2, Orchestrator can carry grant references and optionally consult a
  resolver. Without an integration module, explicit references can still be
  forwarded, while automatic lookup has no provider implementation.
- After PR 3, Secure Token Storage supplies that resolver, enabling automatic
  grant lookup for the initiating user and the associated Orchestrator flow.
- None of these steps should make RHDH login identity and provider OAuth
  connections the same thing. Logging out should not revoke persisted grants.

## Recommendation

Proceed with the three-PR sequence. For the first PR, isolate the
Orchestrator-specific module and local `portal:` package resolutions; preserve
the explicit grant-in-workflow-input behavior as the plugin's independently
testable workflow integration. Then land Orchestrator's generic extension seam,
followed by the small Secure Token Storage adapter module.

Before implementation, confirm the intended Orchestrator package release
boundary and whether the integration adapter should be a separately published
backend-module package. Those are packaging decisions; they do not change the
core plugin's OAuth, grant, or token-refresh behavior.
