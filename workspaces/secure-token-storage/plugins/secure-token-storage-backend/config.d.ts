/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export interface Config {
  secureTokenStorage?: {
    /** Enables the secure token storage broker. Defaults to false. */
    enabled?: boolean;
    /** Service subjects that may receive user-approved grants. */
    allowedCallerSubjects?: string[];
    oauth?: {
      /** Exact callback URLs accepted for OAuth connect sessions. */
      allowedRedirectUris: string[];
      /** Lifetime of a pending OAuth state in seconds. */
      connectSessionTtlSeconds?: number;
      /** Default lifetime of an approved grant in seconds. */
      defaultGrantTtlSeconds?: number;
      /** Maximum lifetime of an approved grant in seconds. */
      maxGrantTtlSeconds?: number;
      providers?: {
        github?: {
          /** OAuth App client ID. */
          clientId: string;
          /** Secret-backed OAuth App client secret. */
          clientSecret: string;
          /** Override for GitHub Enterprise Server authorization URL. */
          authorizationUrl?: string;
          /** Override for GitHub Enterprise Server token URL. */
          tokenUrl?: string;
        };
        microsoft?: {
          /** Microsoft Entra application client ID. */
          clientId: string;
          /** Secret-backed application client secret. */
          clientSecret: string;
          /** Tenant, `common`, `organizations`, `consumers`, or tenant ID. */
          tenant: string;
          /** Override for a compatible Microsoft identity authorization URL. */
          authorizationUrl?: string;
          /** Override for a compatible Microsoft identity token URL. */
          tokenUrl?: string;
        };
      };
    };
    encryption?: {
      /** Base64-encoded 32-byte AES-256-GCM key for new records. */
      activeKey?: string;
      /** Identifier recorded with ciphertext for future key rotation. */
      activeKeyVersion?: string;
      /** Base64-encoded previous keys indexed by their recorded version. */
      previousKeys?: Record<string, string>;
    };
  };
}
