/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  createServiceRef,
  type BackstageCredentials,
  type BackstageServicePrincipal,
} from '@backstage/backend-plugin-api';

/**
 * The health state exposed by the secure token storage foundation.
 *
 * @public
 */
export interface SecureTokenStorageStatus {
  /** Whether the broker is enabled by configuration. */
  enabled: boolean;
}

/**
 * The provider token material supplied by an OAuth connect flow.
 *
 * This type is accepted only by the backend service boundary. Refresh tokens
 * are never included in a token retrieval response.
 *
 * @public
 */
export interface StoreProviderTokenInput {
  /** Backstage entity reference of the consenting user. */
  userEntityRef: string;
  /** Provider identifier, for example `github` or `microsoft`. */
  provider: string;
  /** Short-lived provider access token. */
  accessToken: string;
  /** Provider refresh token, when the provider supports refresh. */
  refreshToken?: string;
  /** Time at which the access token expires. */
  expiresAt?: Date;
  /** Scopes approved by the user. */
  scopes: string[];
}

/**
 * A user-approved grant that binds a provider connection to one service.
 *
 * @public
 */
export interface CreateTokenGrantInput {
  /** Backstage entity reference of the consenting user. */
  userEntityRef: string;
  /** Provider identifier. */
  provider: string;
  /** Verified Backstage service subject allowed to use the grant. */
  callerSubject: string;
  /** Subset of provider scopes approved for this grant. */
  scopes: string[];
  /** Optional workflow or instance binding. */
  workflowInstanceId?: string;
  /** Time at which the grant expires. */
  expiresAt: Date;
}

/**
 * A provider connection request initiated by a trusted caller on behalf of a
 * user.
 *
 * @public
 */
export interface StartProviderConnectionInput {
  /** Backstage entity reference of the consenting user. */
  userEntityRef: string;
  /** Provider identifier. */
  provider: string;
  /** Scopes requested from the provider. */
  scopes: string[];
  /** Registered callback URL for the OAuth provider. */
  redirectUri: string;
  /** Verified service subject that will request the eventual grant. */
  callerSubject: string;
}

/**
 * The redirect information returned for a provider connection request.
 *
 * @public
 */
export interface ProviderConnectionStart {
  /** Opaque broker session identifier used for consent. */
  sessionId: string;
  /** Provider authorization URL containing a one-time state value. */
  authorizationUrl: string;
  /** Time at which the connect session expires. */
  expiresAt: Date;
}

/**
 * The safe result of completing an OAuth callback.
 *
 * @public
 */
export interface ProviderConnectionResult {
  /** Opaque broker session identifier. */
  sessionId: string;
  /** Provider identifier. */
  provider: string;
  /** Backstage entity reference of the consenting user. */
  userEntityRef: string;
  /** Scopes stored with the provider connection. */
  scopes: string[];
}

/**
 * A user decision for a completed provider connection.
 *
 * @public
 */
export type ProviderConnectionConsent = 'approve' | 'reject';

/**
 * The access-token response returned to a service caller.
 *
 * @public
 */
export interface AccessTokenResult {
  /** Short-lived provider access token. */
  accessToken: string;
  /** Access-token expiry, when supplied by the provider. */
  expiresAt?: Date;
  /** Scopes granted to the caller. */
  scopes: string[];
}

/**
 * Stable failure modes for broker operations.
 *
 * @public
 */
export type SecureTokenStorageErrorCode =
  | 'not-enabled'
  | 'connection-not-found'
  | 'grant-not-found'
  | 'grant-revoked'
  | 'grant-expired'
  | 'caller-not-authorized'
  | 'provider-refresh-required'
  | 'provider-refresh-failed'
  | 'token-integrity-failed'
  | 'provider-not-configured'
  | 'invalid-redirect-uri'
  | 'connect-session-not-found'
  | 'connect-session-expired'
  | 'connect-session-consumed'
  | 'oauth-consent-denied'
  | 'oauth-exchange-failed'
  | 'consent-not-available';

/**
 * Error raised when the broker cannot safely fulfill a token request.
 *
 * @public
 */
export class SecureTokenStorageError extends Error {
  /** Stable machine-readable error code. */
  readonly code: SecureTokenStorageErrorCode;

  /** @param code - Stable machine-readable error code. */
  constructor(code: SecureTokenStorageErrorCode) {
    super(code);
    this.name = 'SecureTokenStorageError';
    this.code = code;
  }
}

/**
 * Root-scoped service contract for secure provider token storage.
 *
 * Token persistence and provider-specific behavior remain behind this small
 * interface so consumers do not depend on the storage implementation.
 *
 * @public
 */
export interface SecureTokenStorageService {
  /** Returns the current feature status. */
  getStatus(): Promise<SecureTokenStorageStatus>;
  /** Stores provider credentials encrypted at rest for a user connection. */
  storeProviderToken(input: StoreProviderTokenInput): Promise<void>;
  /** Creates an opaque, caller-bound grant for a provider connection. */
  createGrant(input: CreateTokenGrantInput): Promise<{
    grantId: string;
    expiresAt: Date;
  }>;
  /** Starts a persistent, PKCE-protected provider connection session. */
  startProviderConnection(
    input: StartProviderConnectionInput,
  ): Promise<ProviderConnectionStart>;
  /** Completes a provider callback and stores its credentials encrypted. */
  completeProviderConnection(input: {
    provider: string;
    state: string;
    code?: string;
    providerError?: boolean;
  }): Promise<ProviderConnectionResult>;
  /** Approves a completed connection and creates its caller-bound grant. */
  approveProviderConnection(input: {
    sessionId: string;
    userEntityRef: string;
    expiresAt?: Date;
  }): Promise<{
    grantId: string;
    provider: string;
    scopes: string[];
    expiresAt: Date;
  }>;
  /** Rejects a completed connection without creating a grant. */
  rejectProviderConnection(input: {
    sessionId: string;
    userEntityRef: string;
  }): Promise<void>;
  /** Retrieves or refreshes an access token for a verified service caller. */
  getAccessToken(options: {
    grantId: string;
    provider: string;
    caller: BackstageCredentials<BackstageServicePrincipal>;
  }): Promise<AccessTokenResult>;
  /** Revokes a user-owned grant. */
  revokeGrant(options: {
    grantId: string;
    userEntityRef: string;
  }): Promise<void>;
}

/**
 * The canonical service reference used by the backend plugin and consumers.
 *
 * @public
 */
export const secureTokenStorageServiceRef =
  createServiceRef<SecureTokenStorageService>({
    id: 'secure-token-storage',
    scope: 'root',
  });
