/**
 * Shared types, permissions, and stable errors for the provider-token plugin.
 *
 * @packageDocumentation
 */

export { ProviderTokenError, providerTokenErrorCodes } from './errors';
export type { ProviderTokenErrorCode } from './errors';
export {
  providerTokenConnectPermission,
  providerTokenGrantReadPermission,
  providerTokenGrantRevokePermission,
  providerTokenProviderDisconnectPermission,
  providerTokenPermissions,
  providerTokenTokenIssuePermission,
} from './permissions';
export type {
  ProviderTokenAccessTokenResult,
  ProviderTokenClientConfig,
  ProviderTokenConnectCallbackResult,
  ProviderTokenConnectOptions,
  ProviderTokenConnectDecisionResult,
  ProviderTokenConnectSessionSummary,
  ProviderTokenConnectStartResult,
  ProviderTokenConnectionSummary,
  ProviderTokenGrantSummary,
  ProviderTokenProviderId,
} from './types';
