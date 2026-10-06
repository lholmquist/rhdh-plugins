/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export interface Config {
  providerToken?: {
    /** Enables the provider-token plugin. Defaults to false. */
    enabled?: boolean;
    encryption?: {
      /** Base64-encoded 32-byte AES-256 key. Treat as a secret. */
      activeKey?: string;
      /** Version label persisted with each encrypted value. */
      activeKeyVersion?: string;
      /** Previously active keys, indexed by their persisted key version. */
      previousKeys?: Record<string, string>;
    };
    /** Optional OAuth provider adapters; credentials are secrets. */
    providers?: {
      github?: {
        clientId?: string;
        clientSecret?: string;
        authorizationUrl?: string;
        tokenUrl?: string;
        revocationUrl?: string;
      };
      microsoft?: {
        clientId?: string;
        clientSecret?: string;
        tenant?: string;
        authorizationUrl?: string;
        tokenUrl?: string;
      };
    };
    /** Trusted consumers and the verified service subjects allowed to mint. */
    clients?: Array<{
      /** Stable identifier recorded on consent grants. */
      id: string;
      /** Human-readable client name. */
      title: string;
      /** Purpose text shown to the user before background access is approved. */
      purpose?: string;
      /** Provider-specific OAuth scopes configured for this trusted client. */
      providerScopes: Record<string, string[]>;
      /** Backstage service subjects permitted to issue tokens for this client. */
      allowedSubjects: string[];
    }>;
    /** Allowed post-OAuth browser return targets, matched by origin/path prefix. */
    returnUrlAllowlist?: Array<{
      origin: string;
      pathPrefix: string;
    }>;
    /** Lifetime of an approved grant, in days. Defaults to 30. */
    grantTtlDays?: number;
  };
}
