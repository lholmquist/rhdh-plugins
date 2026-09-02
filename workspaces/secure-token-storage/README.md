# Secure token storage

This workspace contains the standalone secure token storage foundation for
Red Hat Developer Hub.

The first implementation slice provides:

- a root-scoped service contract in `secure-token-storage-node`;
- a feature-gated backend plugin and service factory; and
- a local backend host with an unauthenticated health endpoint at
  `/api/secure-token-storage/health`.

Token persistence, encryption, consent, and provider adapters are intentionally
not implemented yet. The service boundary keeps those concerns behind the
public node API for the subsequent acceptance-criteria slices.
