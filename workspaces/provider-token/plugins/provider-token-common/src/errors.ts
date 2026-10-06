/**
 * Stable machine-readable errors returned by provider-token operations.
 *
 * @public
 */
export const providerTokenErrorCodes = {
  invalidRequest: 'invalid-request',
  authenticationRequired: 'authentication-required',
  providerNotConfigured: 'provider-not-configured',
  connectionNotFound: 'connection-not-found',
  grantNotFound: 'grant-not-found',
  grantExpired: 'grant-expired',
  grantRevoked: 'grant-revoked',
  callerNotAuthorized: 'caller-not-authorized',
  permissionDenied: 'permission-denied',
  consentRequired: 'consent-required',
  consentDenied: 'consent-denied',
  connectSessionExpired: 'connect-session-expired',
  connectSessionConsumed: 'connect-session-consumed',
  invalidOAuthState: 'invalid-oauth-state',
  invalidProviderResponse: 'invalid-provider-response',
  tokenRefreshRejected: 'token-refresh-rejected',
  providerUnavailable: 'provider-unavailable',
  encryptionError: 'encryption-error',
  storageError: 'storage-error',
} as const;

/**
 * Union of stable provider-token error identifiers.
 *
 * @public
 */
export type ProviderTokenErrorCode =
  (typeof providerTokenErrorCodes)[keyof typeof providerTokenErrorCodes];

/**
 * Error carrying a safe, stable code. Callers must not put provider response
 * bodies, credentials, authorization codes, or encryption data in its message.
 *
 * @public
 */
export class ProviderTokenError extends Error {
  /** Stable machine-readable error identifier. */
  readonly code: ProviderTokenErrorCode;
  /** Whether a caller may retry the operation without changing its request. */
  readonly retryable: boolean;

  constructor(
    code: ProviderTokenErrorCode,
    message: string,
    options: { retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'ProviderTokenError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
