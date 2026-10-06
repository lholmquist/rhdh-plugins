# Provider Token Orchestrator backend module

This optional module registers Provider Token as Orchestrator's provider-grant
resolver. When a workflow has no explicit grant reference, it selects an active
grant for the initiating user and requested provider only when the selection is
unambiguous. Token exchange uses the verified Orchestrator service credentials
through `ProviderTokenClient`; the module does not put access tokens into
workflow input or state.

The module binds to Orchestrator's extension-point ID
`orchestrator.provider-token-grants`. That extension contract is currently
present in the repository's Orchestrator source but not yet exported by the
workspace's pinned `orchestrator-node` package release; the module keeps a
structural copy of the contract until the published node package catches up.

Load this module only in a backend that already loads both the Provider Token
backend and the Orchestrator backend:

```ts
backend.add(
  import(
    '@red-hat-developer-hub/backstage-plugin-provider-token-backend-module-orchestrator'
  ),
);
```

Only one module may register Orchestrator's provider-token resolver at a time.
Do not load this module alongside the secure-token-storage Orchestrator module.

The sample workflow in
`/Users/lholmqui/develop/rhdhorchestrator/orchestrator-demo/11_provider_token_grant_multi_step`
calls the token endpoint itself at execution time. Point its broker URL to
`http://localhost:7007/api/provider-token/v1/access-tokens` and use a service
credential whose subject is allowed by the Provider Token grant. The endpoint
accepts the workflow's `{ grantId, provider }` request and returns
`{ accessToken, expiresAt, scopes }`.
