/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

/**
 * Backend contracts and extension points for the provider-token plugin.
 *
 * @packageDocumentation
 */
import {
  createExtensionPoint,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import type {
  ProviderTokenAccessTokenResult,
  ProviderTokenConnectCallbackResult,
  ProviderTokenConnectOptions,
  ProviderTokenConnectDecisionResult,
  ProviderTokenConnectSessionSummary,
  ProviderTokenConnectStartResult,
  ProviderTokenConnectionSummary,
  ProviderTokenGrantSummary,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';

/** OAuth token material returned only inside trusted backend code. */
/** @public */
export interface ProviderTokenSet {
  /** Short-lived access token; callers must not persist or log it. */
  accessToken: string;
  /** Absolute access-token expiry. */
  accessTokenExpiresAt: Date;
  /** Refresh token, returned by code exchange and possibly rotated on refresh. */
  refreshToken: string;
  /** Absolute refresh-token expiry when the provider exposes one. */
  refreshTokenExpiresAt?: Date;
  /** Provider-approved scopes, excluding protocol-only scopes. */
  scopes: string[];
}

/** Token response from a refresh operation. Microsoft may omit rotation. */
/** @public */
export type ProviderTokenRefreshResult = Omit<
  ProviderTokenSet,
  'refreshToken' | 'refreshTokenExpiresAt' | 'scopes'
> & {
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
  /** Actual scopes reported by the provider; omitted when they cannot be verified. */
  scopes?: string[];
};

/** OAuth dialect implementation registered by a provider backend module. */
/** @public */
export interface ProviderTokenAdapter {
  /** Stable configured provider identifier. */
  readonly id: string;

  /** Builds a PKCE authorization URL without exposing client credentials. */
  createAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
  }): string;

  /** Exchanges an authorization code for refreshable credentials. */
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    scopes: string[];
  }): Promise<ProviderTokenSet>;

  /** Refreshes the access token; never logs or returns provider diagnostics. */
  refreshAccessToken(input: {
    refreshToken: string;
    scopes: string[];
  }): Promise<ProviderTokenRefreshResult>;

  /** Revokes the provider authorization when the provider supports it. */
  revokeRefreshToken?(input: { refreshToken: string }): Promise<void>;
}

/** Extension point implemented by provider-token and used by provider modules. */
/** @public */
export interface ProviderTokenExtensionPoint {
  /** Registers a provider OAuth adapter; duplicate IDs are rejected. */
  addProviderAdapter(adapter: ProviderTokenAdapter): void;
}

/** Backend-only token operation used by provider-token routes and modules. */
/** @public */
export interface ProviderTokenOperations {
  /**
   * Fails closed if a provider is configured but its optional module did not
   * register an adapter. Connection routes should call this before redirecting.
   */
  assertProviderConfigured(providerId: string): void;
  /** Lists safe grant metadata belonging to the authenticated user. */
  listGrants(userEntityRef: string): Promise<ProviderTokenGrantSummary[]>;
  /** Lists safe provider connection metadata belonging to one user. */
  listConnections(
    userEntityRef: string,
  ): Promise<ProviderTokenConnectionSummary[]>;
  /** Returns safe provider/client choices for the signed-in consent page. */
  getConnectOptions(): ProviderTokenConnectOptions;
  /** Starts a PKCE-protected provider OAuth flow for a verified user. */
  startConnect(input: {
    userEntityRef: string;
    provider: string;
    clientId: string;
    returnUrl: string;
  }): Promise<ProviderTokenConnectStartResult>;
  /** Completes the OAuth callback and redirects to an allow-listed consent page. */
  completeConnectCallback(input: {
    state: string;
    code?: string;
    providerError?: string;
  }): Promise<ProviderTokenConnectCallbackResult>;
  /** Reads consent data only for the authenticated owner. */
  getConnectSession(
    sessionId: string,
    userEntityRef: string,
  ): Promise<ProviderTokenConnectSessionSummary>;
  /** Records an explicit approval or denial for the authenticated owner. */
  decideConnectSession(input: {
    sessionId: string;
    userEntityRef: string;
    decision: 'approve' | 'deny';
  }): Promise<ProviderTokenConnectDecisionResult>;
  /** Disconnects a provider and revokes all of that owner's local grants. */
  disconnectProvider(userEntityRef: string, provider: string): Promise<void>;
  /** Revokes a grant only when it belongs to the authenticated user. */
  revokeGrant(grantId: string, userEntityRef: string): Promise<void>;
  /** Issues a short-lived token after revalidating the grant and caller. */
  issueAccessToken(input: {
    grantId: string;
    callerSubject: string;
    /** Optional provider assertion supplied by token-broker consumers. */
    provider?: string;
    context?: string;
  }): Promise<ProviderTokenAccessTokenResult>;
  /** Drops an in-memory token after a local revoke. */
  invalidate(secretId: string): void;
}

/** Client contract for trusted backend consumers of provider-token. @public */
export interface ProviderTokenApi {
  /** Requests a short-lived access token for an approved grant. */
  getAccessToken(input: {
    grantId: string;
    credentials: BackstageCredentials;
    /** Optional provider assertion checked against the grant. */
    provider?: string;
    /** Optional non-authorizing context. Never include credentials or secrets. */
    context?: string;
  }): Promise<ProviderTokenAccessTokenResult>;
  /** Resolves an active grant reference for a workflow owner. */
  resolveProviderTokenGrant(input: {
    userEntityRef: string;
    credentials: BackstageCredentials;
    provider?: string;
  }): Promise<{ grantId: string; provider: string } | undefined>;
}

/** Plugin-scoped operations service for trusted backend consumers. */
/** @public */
export const providerTokenOperationsRef =
  createServiceRef<ProviderTokenOperations>({
    id: 'provider-token.operations',
    scope: 'plugin',
  });

/** Provider adapter registration point for provider-token backend modules. */
/** @public */
export const providerTokenExtensionPoint =
  createExtensionPoint<ProviderTokenExtensionPoint>({
    id: 'provider-token.adapters',
  });

export { ProviderTokenClient } from './ProviderTokenClient';
