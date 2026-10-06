# Provider Token node package

This package exposes the backend operations service reference and
`ProviderTokenClient` for trusted backend consumers. The client discovers the
Provider Token backend, authenticates each request with Backstage service
credentials, and returns a short-lived token result. Never persist or log the
token. The HTTP broker response uses `accessToken`, matching the provider-token
workflow demo contract.
