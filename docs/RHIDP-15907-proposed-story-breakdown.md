# Proposed Jira Story Breakdown for RHIDP-15907

**Status:** Draft for review; no Jira issues have been created or edited.

**Parent epic:** [RHIDP-15907](https://redhat.atlassian.net/browse/RHIDP-15907)

## Recommendation

Keep RHIDP-17909 as the story for the Secure Token Storage core. Its current
scope already covers encrypted server-side storage and the grant-based REST
API for token retrieval and refresh. Do not create a second core-plugin story.

Two additional stories cover the code that is not explicitly assigned to an
open story:

1. Orchestrator support for carrying an optional provider-grant reference to a
   workflow.
2. An optional Secure Token Storage integration module that resolves a grant
   for Orchestrator.

Both proposed implementation stories are children of RHIDP-15907. Its scope
should expand to include Orchestrator grant-reference transport and the
optional Secure Token Storage resolver. The separate documentation Epic and
task remain under RHDHPLAN-1661. The workflow still exchanges `grantId` with
Secure Token Storage for an access token. Orchestrator transports only the
reference; it must not receive the provider access or refresh token.

## Existing Jira scope and overlap

### Issues directly under RHIDP-15907

The exact child query returned three issues:

| Issue                                                   | Status      | Relationship                                                                                |
| ------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| RHIDP-17909 — Secure Token Storage implementation story | In Progress | Direct overlap with any new core-plugin story. Reuse this story for the core plugin PR.     |
| RHIDP-17137 — QE investigation task                     | To Do       | Coordinate test planning and resulting QE work here; it is not an implementation duplicate. |
| RHIDP-17197 — Secure Token Storage spike                | Closed      | Completed discovery/prototype work; keep as history, not a new implementation story.        |

RHIDP-17909 describes the encrypted database and REST token retrieval/refresh
using grants. It does not explicitly describe Orchestrator's generic grant
reference contract, transport to workflows, or an optional resolver module.
Those behaviors are distinct from its current core-plugin story scope.

### Related work found in Jira

| Issue                                                                         | Status       | Assessment                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RHIDP-15907 — Secure Token Storage Epic                                       | In Progress  | Parent Epic and broad workflow outcome; not a duplicate child story.                                                                                                                                     |
| RHDHPLAN-1661 — Secure short-lived user tokens Feature                        | In Progress  | Parent Feature. It calls for implementation Epics for platform consumption and runtime integration, which raises a hierarchy question below.                                                             |
| RHIDP-17900 and RHIDP-17970 — documentation Epic and task                     | New          | Related docs work. Coordinate user-facing documentation there rather than creating duplicate docs-only work inside these implementation stories. Keep API/contract documentation with the relevant code. |
| RHDHSUPP-367 — secure token management and automatic refresh request          | In Progress  | Source problem/customer request, not an implementation story.                                                                                                                                            |
| RHIDP-16722 — durable test for token expiry on long runs                      | To Do        | Related test spike. Coordinate test placement; it is not duplicate product implementation.                                                                                                               |
| RHIDP-15381 — token forwarding/header injection weakness                      | New          | Security work that should inform the Orchestrator acceptance criteria; not a duplicate.                                                                                                                  |
| RHDHPLAN-653 — OBO token exchange                                             | New          | Separate capability. RHDHPLAN-1661 explicitly lists OBO as out of scope.                                                                                                                                 |
| RHDHPLAN-1008 — static and service-to-service Orchestrator API authentication | Under Review | Different authentication outcome; the proposed grant resolver is an extension point, not an API-authentication change.                                                                                   |
| RHDHBUGS-3216, RHDHBUGS-3290, RHIDP-15106, RHDHSUPP-317, RHDHSUPP-89          | Closed       | Historical SAML/provider-login or token-expiry reports. Related context, but not duplicates of grant-reference propagation or the resolver adapter.                                                      |
| RHIDP-18046, RHIDP-18047, RHIDP-18048                                         | Review       | Dependency CVEs whose summaries mention Orchestrator; unrelated to this feature.                                                                                                                         |
| RHIDP-17859, RHIDP-17860, RHIDP-17861                                         | New          | Identity-provider ML-DSA test subtasks; keyword matches only, unrelated.                                                                                                                                 |

### Parent Feature placement

The children of RHDHPLAN-1661 are currently RHIDP-15907 (plugin Epic),
RHIDP-17900 (documentation Epic), and RHDHPLAN-1843 (acceptance/demo
sub-task). Keep RHIDP-17900 and its documentation task outside RHIDP-15907,
where they already track documentation work.

Per your direction, keep the implementation work under RHIDP-15907. Expand
that Epic's summary and description to include platform runtime integration,
then add the two proposed implementation stories below as its children. This
avoids a separate Orchestrator implementation Epic while preserving the
documentation Epic's current placement under the Feature.

### Suggested clarification for RHIDP-17909

Because RHIDP-17909 is already In Progress, treat this as a possible scope
clarification for its assignee, not a replacement for its current acceptance
criteria:

> This story delivers the Secure Token Storage core and its grant-based token
> retrieval/refresh API. A workflow can receive `grantId` through its normal
> input and call the token endpoint without the Orchestrator resolver. Generic
> Orchestrator grant-reference transport and the optional Secure Token Storage
> resolver module are tracked separately.

Keep the Epic's existing requirements for encryption, persistence, REST
retrieval/refresh, compatibility, and security validation in RHIDP-17909.

## Draft story 1 — Orchestrator grant-reference support

**Jira fields**

- **Issue type:** Story
- **Proposed parent:** RHIDP-15907, with the Epic scope expanded to include
  runtime integration
- **Suggested component:** Orchestrator
- **Initial estimate:** 8 points, to be confirmed by the team. The scope spans
  Orchestrator's API, UI, backend, two workflow transports, tests, and docs;
  this matches the sizing guide's “very broad” story.
- **Blocking edges:** No Secure Token Storage code blocks the generic
  contract. End-to-end validation with automatic grant resolution depends on
  RHIDP-17909 and story 2. Consult RHIDP-15381 for header-construction
  security requirements.

### Summary

Propagate an optional provider-grant reference to Orchestrator workflows.

### Description

**User story**

As an Orchestrator workflow user, I want my workflow to receive a provider-grant
reference. It can then request a current provider token without sending that
token through Orchestrator.

**Background**

Queued workflows can wait until an access token expires. Long-running
workflows can reach that point during execution. Secure Token Storage stores
grants and exposes a token endpoint.

Orchestrator needs a provider-neutral contract to accept or resolve a grant
reference and forward it. The workflow then calls that endpoint. Users can
still pass `grantId` in normal workflow input. They do not need to enter one
when a resolver finds an eligible grant.

**Out of scope**

- Storing OAuth access or refresh tokens in Orchestrator.
- Connecting providers, obtaining consent, persisting grants, or refreshing
  tokens.
- Implementing the Secure Token Storage-specific resolver. That is story 2.
- Removing or changing the existing workflow-input path for `grantId`.

**Approach**

Add an optional, provider-neutral grant-reference contract to workflow
execution and retrigger paths. Keep normal workflow inputs unchanged. If the
user supplies `grantId`, preserve it. If they omit it and a resolver is
configured, resolve the grant for the initiating user and requested provider.
Send only the opaque reference.

For direct HTTP workflows, pass the reference in documented request metadata.
For event-driven workflows, add it to documented event data. Without a
resolver, keep existing behavior.

### Acceptance criteria

1. Workflow execution and retrigger APIs accept an optional grant reference.
   OpenAPI and generated clients document the contract.
2. An explicitly supplied `grantId` remains supported. If it is omitted and a
   resolver is registered, Orchestrator requests a reference for the initiating
   user and provider. The UI does not require users to enter the ID when the
   resolver can find an eligible grant.
3. If no resolver is registered, existing workflows behave as they do today.
   If a configured resolver finds no single eligible grant, Orchestrator
   follows a documented, tested safe failure path and never chooses
   arbitrarily.
4. Direct HTTP workflows receive the opaque reference through documented
   request metadata. Event-driven workflows receive it in documented event
   data. Execute and retrigger paths preserve the same behavior.
5. Orchestrator never receives or persists provider access/refresh tokens in
   workflow input, headers, events, logs, or execution state. Header
   construction follows the security controls tracked by RHIDP-15381.

### Done checklist

- [ ] Unit/integration tests pass for the changed Orchestrator packages.
- [ ] API and workflow transport documentation is updated; the sample workflow
      demonstrates reference forwarding without exposing a token.
- [ ] Generated API artifacts and package changesets are included where
      required by repository practice.
- [ ] QE test needs are reviewed with RHIDP-17137.
- [ ] A release demo is covered by the parent Feature; no separate operating
      procedure is needed for this story.

## Draft story 2 — Secure Token Storage resolver integration

**Jira fields**

- **Issue type:** Story
- **Proposed parent:** RHIDP-15907
- **Suggested components:** Authentication, Orchestrator
- **Initial estimate:** 3 points, to be confirmed by the team. This is a
  narrow integration module with branched behavior, automated tests, and a
  small sample configuration update.
- **Blocking edges:** Blocked by RHIDP-17909's service contract and draft story
  1's Orchestrator resolver contract. Both are required for end-to-end
  verification.

### Summary

Add an optional Secure Token Storage backend module that resolves provider
grant references for Orchestrator.

### Description

**User story**

As an RHDH operator, I want Secure Token Storage to find an eligible grant for
an Orchestrator user. The workflow can then call the existing token endpoint
without asking the user to enter a grant ID.

**Background**

Orchestrator's generic resolver contract should not depend on Secure Token
Storage. A separate, optional module can connect them through Secure Token
Storage's grant service. The core plugin remains usable without Orchestrator.

**Out of scope**

- Reimplementing provider connection, consent, grant persistence, token
  refresh, or the token endpoint.
- Passing provider access or refresh tokens to Orchestrator.
- Making RHDH login use the same provider as a grant, or revoking grants on
  logout.
- Requiring this module for standalone Secure Token Storage operation.
- Automatically creating or approving grants.

**Approach**

Package the adapter as a separate optional backend module. Register it with
Orchestrator's resolver contract. Use Secure Token Storage's existing grant
service for lookups. Keep this module out of the core backend's default path,
so the core plugin runs without Orchestrator. Return only the opaque
`grantId`. The workflow exchanges it for an access token through the existing
token endpoint.

### Acceptance criteria

1. The optional module registers with the supported Orchestrator resolver
   contract. The core Secure Token Storage backend builds and runs without it.
2. For the initiating user and requested provider, the adapter resolves only
   an active, non-revoked grant owned by that user. If it finds no eligible or
   unambiguous grant, it returns the documented safe no-match result and never
   chooses arbitrarily.
3. The resolver returns only the `grantId` and required non-secret metadata.
   It does not return or log access-token or refresh-token values.
4. The workflow exchanges the reference through the existing token endpoint;
   that endpoint and service continue to own authorization and refresh.
5. If the module is absent or disabled, existing Secure Token Storage and
   Orchestrator flows remain unchanged. Tests cover registration, grant
   ownership, no-match/ambiguity, and disabled behavior.

### Done checklist

- [ ] Adapter tests pass using a fake or test Secure Token Storage service.
- [ ] Sample backend registration/configuration is demonstrated and documented.
- [ ] Local testing instructions distinguish core-plugin testing from the
      Orchestrator integration path; user-facing guide changes are coordinated
      with RHIDP-17900/RHIDP-17970.
- [ ] QE test needs are reviewed with RHIDP-17137.
- [ ] The parent Feature demo covers the end-to-end flow; no separate operating
      procedure is needed for this story.

## Suggested sequencing

1. Continue RHIDP-17909 for the Secure Token Storage core; clarify that the
   explicit workflow-input path works without the new resolver integration.
2. Implement and land draft story 1 as the Orchestrator-owned, provider-neutral
   contract and transport change.
3. Implement and land draft story 2 as the optional Secure Token Storage
   adapter.

The PR boundaries can follow that sequence: Secure Token Storage core,
Orchestrator grant-reference support, then the optional integration. The
Orchestrator story can be reviewed independently; the adapter depends on the
available Orchestrator contract and the core plugin service. If the Orchestrator
story moves under a sibling Epic, retain the same PR sequence and dependency.

## Jira search and confidence

The following read-only searches ran through `acli` outside the sandbox with
an explicit `--limit 500`; none was truncated.

```sh
acli jira workitem search --jql 'project in (RHIDP, RHDHPLAN, RHDHSUPP, RHDHBUGS) AND summary ~ "secure token storage" AND status != Closed ORDER BY updated DESC' --fields "key,summary,status,issuetype" --limit 500
```

This exact summary search returned **3** issues: RHIDP-17137, RHIDP-17909, and
RHIDP-15907.

The expanded title/parent search returned **23** issues:

```text
project in (RHIDP, RHDHPLAN, RHDHSUPP, RHDHBUGS)
AND (parent = RHIDP-15907
  OR summary ~ "secure token storage"
  OR summary ~ "provider token"
  OR summary ~ "token grant"
  OR summary ~ "grant reference"
  OR (summary ~ "orchestrator" AND summary ~ "grant")
  OR (summary ~ "orchestrator" AND summary ~ "token"))
ORDER BY updated DESC
```

The exact hierarchy query `parent = RHIDP-15907 ORDER BY updated DESC` returned
**3** children: RHIDP-17909, RHIDP-17137, and RHIDP-17197. The parent Feature
query `parent = RHDHPLAN-1661 ORDER BY updated DESC` returned **3** children:
RHIDP-15907, RHIDP-17900, and RHDHPLAN-1843.

These are title-level searches, not a complete scan of every issue
description. They found no separate open Story for Orchestrator grant-reference
propagation or the Secure Token Storage resolver. RHIDP-17909 remains the
existing, directly overlapping Secure Token Storage core story. The related
items in the table above should be coordinated with, but are not duplicates of,
the proposed implementation stories.
