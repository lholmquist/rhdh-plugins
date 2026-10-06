/**
 * Identifier supplied by a registered provider adapter.
 *
 * @public
 */
export type ProviderTokenProviderId = string;

/** Configured consumer allowed to request tokens for its grants. @public */
export interface ProviderTokenClientConfig {
  /** Stable identifier stored on grants. */
  id: string;
  /** Human-readable name shown during consent. */
  title: string;
  /** Why this consumer needs background access, shown on the consent screen. */
  purpose?: string;
  /** Provider-specific OAuth scopes configured for this trusted client. */
  providerScopes: Record<string, string[]>;
  /** Verified Backstage service subjects permitted to use this client. */
  allowedSubjects: string[];
}

/** Safe metadata for a provider connection owned by the signed-in user. @public */
export interface ProviderTokenConnectionSummary {
  /** Stable provider adapter identifier. */
  provider: ProviderTokenProviderId;
  /** Provider scopes available on the stored refresh credential. */
  scopes: string[];
  /** When the provider credential was first connected. */
  connectedAt: Date;
}

/** Public provider and workflow-client choices for the signed-in user page. @public */
export interface ProviderTokenConnectOptions {
  /** Providers with a configured OAuth adapter. */
  providers: string[];
  /** Safe client details; service credentials and allow-listed subjects omitted. */
  clients: Array<{
    id: string;
    title: string;
    purpose: string;
    /** Non-secret scope policy displayed before the user starts OAuth. */
    providerScopes: Record<string, string[]>;
  }>;
}

/** Safe consent data for a one-use provider connection session. @public */
export interface ProviderTokenConnectSessionSummary {
  /** Opaque session identifier used by the consent UI. */
  sessionId: string;
  /** Client requesting background access. */
  clientId: string;
  /** Human-readable client name. */
  clientTitle: string;
  /** Verified workflow service subject that may use the eventual grant. */
  callerSubject: string;
  /** Explanation shown to the user before they approve. */
  purpose: string;
  /** Provider the user is connecting. */
  provider: ProviderTokenProviderId;
  /** Scopes the user is being asked to grant to this client. */
  scopes: string[];
  /** Session expiry. */
  expiresAt: Date;
  /** Current local consent state. */
  consentStatus: 'pending' | 'approved' | 'denied';
  /** Grant identifier, present only after successful approval. */
  grantId?: string;
}

/** Result returned when a user starts a provider connection. @public */
export interface ProviderTokenConnectStartResult {
  sessionId: string;
  authorizationUrl: string;
  expiresAt: Date;
}

/** Safe result of processing an OAuth provider callback. @public */
export interface ProviderTokenConnectCallbackResult {
  redirectUrl: string;
}

/** Result of the user's explicit approval or denial. @public */
export interface ProviderTokenConnectDecisionResult {
  consentStatus: 'approved' | 'denied';
  grantId?: string;
}

/** Short-lived provider token returned to an authorized backend caller. @public */
export interface ProviderTokenAccessTokenResult {
  /** Provider bearer token; never persist or log it. */
  token: string;
  /** Provider-token expiry. */
  expiresAt: Date;
  /** Scopes approved on the grant. */
  scopes: string[];
  /** Owner when returned to trusted in-process consumers; omitted over HTTP. */
  userEntityRef?: string;
}

/**
 * Safe grant metadata. This intentionally has no access- or refresh-token
 * fields and is suitable for owner-scoped API responses.
 *
 * @public
 */
export interface ProviderTokenGrantSummary {
  /** Opaque grant identifier presented to a trusted workflow caller. */
  grantId: string;
  /** Provider adapter identifier, such as `github` or `microsoft`. */
  provider: ProviderTokenProviderId;
  /** Configured trusted client that requested the grant. */
  clientId: string;
  /** Authenticated service subject bound to the grant. */
  callerSubject: string;
  /** Scopes approved for the grant. */
  scopes: string[];
  /** Time at which the user approved the grant. */
  createdAt: Date;
  /** Time after which the grant cannot be used. */
  expiresAt: Date;
  /** Time at which the owner revoked the grant, if revoked. */
  revokedAt?: Date;
}
