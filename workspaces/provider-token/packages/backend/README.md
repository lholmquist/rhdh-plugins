# Sample backend

This isolated Backstage backend loads the provider-token backend and its
optional GitHub and Microsoft modules. It does not load secure-token-storage.
The modules are registration shells; provider behavior is implemented in later
slices.

Start the sample app and backend together from the workspace root with
`yarn dev`.
