/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ProviderTokenError,
  providerTokenErrorCodes,
  type ProviderTokenAccessTokenResult,
  type ProviderTokenConnectCallbackResult,
  type ProviderTokenConnectOptions,
  type ProviderTokenConnectDecisionResult,
  type ProviderTokenConnectSessionSummary,
  type ProviderTokenConnectStartResult,
  type ProviderTokenClientConfig,
  type ProviderTokenConnectionSummary,
  type ProviderTokenGrantSummary,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  ProviderTokenAdapter,
  ProviderTokenRefreshResult,
  ProviderTokenSet,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import {
  TokenCipherError,
  type TokenCipher,
  secretAssociatedData,
} from './crypto';
import {
  ProviderTokenRepository,
  type StoredConnectSession,
  type StoredGrant,
  type StoredProviderSecret,
  toGrantSummary,
} from './database/repository';

export interface ProviderTokenReturnUrlAllowlistEntry {
  origin: string;
  pathPrefix: string;
}

export interface ProviderTokenAccessToken {
  /** Short-lived access token; callers must not persist or log it. */
  accessToken: string;
  expiresAt: Date;
  scopes: string[];
}

export interface ProviderTokenServiceOptions {
  repository: ProviderTokenRepository;
  cipher: TokenCipher;
  adapters: ReadonlyMap<string, ProviderTokenAdapter>;
  clients?: ReadonlyMap<string, ProviderTokenClientConfig>;
  callbackUrl?: string;
  returnUrlAllowlist?: ProviderTokenReturnUrlAllowlistEntry[];
  connectSessionTtlMs?: number;
  grantTtlMs?: number;
  logger?: LoggerService;
  now?: () => Date;
  /** Refresh before expiry and use this window when deciding cache reuse. */
  cacheSafetyWindowMs?: number;
}

type RefreshOutcome =
  | { kind: 'token'; token: ProviderTokenAccessToken }
  | { kind: 'error'; error: ProviderTokenError };

const defaultConnectSessionTtlMs = 10 * 60 * 1000;
const defaultGrantTtlMs = 30 * 24 * 60 * 60 * 1000;
const defaultConsentPurpose =
  'Allow background workflows to use this provider connection until the grant expires or you revoke it.';

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

function areSameScopes(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every(scope => rightSet.has(scope))
  );
}

function isAllowedReturnUrl(
  candidate: string,
  allowlist: ProviderTokenReturnUrlAllowlistEntry[],
): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && url.hostname === 'localhost'))
  ) {
    return false;
  }
  return allowlist.some(entry => {
    let allowedOrigin: URL;
    try {
      allowedOrigin = new URL(entry.origin);
    } catch {
      return false;
    }
    if (
      allowedOrigin.origin !== entry.origin ||
      url.origin !== allowedOrigin.origin ||
      !entry.pathPrefix.startsWith('/')
    ) {
      return false;
    }
    const prefix = entry.pathPrefix.replace(/\/$/, '') || '/';
    return (
      url.pathname === prefix ||
      prefix === '/' ||
      url.pathname.startsWith(`${prefix}/`)
    );
  });
}

/**
 * Refreshes encrypted provider credentials and keeps access tokens only in
 * process memory. Repository row locks serialize PostgreSQL refreshes; the
 * in-flight map coalesces concurrent requests in a process, including SQLite.
 */
export class ProviderTokenService {
  private readonly adapters: ReadonlyMap<string, ProviderTokenAdapter>;
  private readonly clients: ReadonlyMap<string, ProviderTokenClientConfig>;
  private readonly now: () => Date;
  private readonly cacheSafetyWindowMs: number;
  private readonly cache = new Map<
    string,
    { token: ProviderTokenAccessToken; usableUntil: number }
  >();
  private readonly inFlight = new Map<
    string,
    { generation: number; promise: Promise<ProviderTokenAccessToken> }
  >();
  private readonly invalidationGenerations = new Map<string, number>();

  constructor(private readonly options: ProviderTokenServiceOptions) {
    this.adapters = options.adapters;
    this.clients = options.clients ?? new Map();
    this.now = options.now ?? (() => new Date());
    this.cacheSafetyWindowMs = options.cacheSafetyWindowMs ?? 60_000;
  }

  /** Ensures a provider adapter is available before a connection is started. */
  assertProviderConfigured(providerId: string): void {
    if (!this.adapters.has(providerId)) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerNotConfigured,
        `No adapter is registered for provider ${providerId}.`,
      );
    }
  }

  /** Returns token-free grant metadata for one verified owner. */
  async listGrants(
    userEntityRef: string,
  ): Promise<ProviderTokenGrantSummary[]> {
    const grants = await this.options.repository.listGrantsForUser(
      userEntityRef,
    );
    return grants.map(toGrantSummary);
  }

  /** Lists connected providers without returning OAuth credentials. */
  async listConnections(
    userEntityRef: string,
  ): Promise<ProviderTokenConnectionSummary[]> {
    return this.options.repository.listProviderConnectionsForUser(
      userEntityRef,
    );
  }

  /** Exposes only configured provider IDs and safe client consent metadata. */
  getConnectOptions(): ProviderTokenConnectOptions {
    return {
      providers: [...this.adapters.keys()].sort(),
      clients: [...this.clients.values()]
        .map(client => ({
          id: client.id,
          title: client.title,
          purpose: client.purpose ?? defaultConsentPurpose,
          providerScopes: Object.fromEntries(
            Object.entries(client.providerScopes).map(([provider, scopes]) => [
              provider,
              [...scopes],
            ]),
          ),
        }))
        .sort((left, right) => left.title.localeCompare(right.title)),
    };
  }

  /** Creates a short-lived OAuth/PKCE session for the verified user. */
  async startConnect(input: {
    userEntityRef: string;
    provider: string;
    clientId: string;
    returnUrl: string;
  }): Promise<ProviderTokenConnectStartResult> {
    this.assertProviderConfigured(input.provider);
    const client = this.clients.get(input.clientId);
    if (!client) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.callerNotAuthorized,
        'The requested provider-token client is not configured.',
      );
    }
    const clientScopes = client.providerScopes[input.provider];
    if (!clientScopes?.length) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidRequest,
        'No provider scopes are configured for this client and provider.',
      );
    }
    if (!this.options.callbackUrl || !input.userEntityRef) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerNotConfigured,
        'Provider-token connection configuration is incomplete.',
      );
    }
    if (
      !isAllowedReturnUrl(
        input.returnUrl,
        this.options.returnUrlAllowlist ?? [],
      )
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidRequest,
        'The requested return URL is not allowed.',
      );
    }
    const scopes = [...clientScopes].sort();
    const previousGrants =
      await this.options.repository.listActiveGrantsForUser(
        input.userEntityRef,
        input.provider,
        this.now(),
      );
    const providerScopes = [
      ...new Set([...scopes, ...previousGrants.flatMap(grant => grant.scopes)]),
    ].sort();
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier, 'utf8')
      .digest('base64url');
    const now = this.now();
    const expiresAt = new Date(
      now.getTime() +
        (this.options.connectSessionTtlMs ?? defaultConnectSessionTtlMs),
    );
    const sessionId = randomUUID();
    const adapter = this.adapters.get(input.provider)!;
    const verifierCiphertext = this.options.cipher.encrypt(
      codeVerifier,
      secretAssociatedData(
        input.userEntityRef,
        input.provider,
        'connect-verifier',
      ),
    );
    const session: StoredConnectSession = {
      id: sessionId,
      stateHash: hashState(state),
      userEntityRef: input.userEntityRef,
      clientId: client.id,
      callerSubject: client.allowedSubjects[0],
      provider: input.provider,
      scopes,
      providerScopes,
      redirectUri: this.options.callbackUrl,
      returnUrl: input.returnUrl,
      codeVerifier: verifierCiphertext,
      createdAt: now,
      expiresAt,
      consentStatus: 'pending',
    };
    const authorizationUrl = adapter.createAuthorizationUrl({
      state,
      codeChallenge,
      redirectUri: session.redirectUri,
      scopes: providerScopes,
    });
    try {
      const authorization = new URL(authorizationUrl);
      if (
        authorization.protocol !== 'https:' &&
        !(
          authorization.protocol === 'http:' &&
          authorization.hostname === 'localhost'
        )
      ) {
        throw new Error('OAuth authorization URL must use HTTPS');
      }
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'The provider returned an invalid authorization URL.',
      );
    }
    await this.options.repository.createConnectSession(session);
    return { sessionId, authorizationUrl, expiresAt };
  }

  /**
   * Validates and consumes an OAuth callback, then stores only the encrypted
   * refresh credential until the user explicitly approves the local grant.
   */
  async completeConnectCallback(input: {
    state: string;
    code?: string;
    providerError?: string;
  }): Promise<ProviderTokenConnectCallbackResult> {
    if (
      typeof input.state !== 'string' ||
      input.state.length < 32 ||
      input.state.length > 256
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidOAuthState,
        'The provider connection state is invalid.',
      );
    }
    const session = await this.options.repository.getConnectSessionByStateHash(
      hashState(input.state),
    );
    if (!session) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidOAuthState,
        'The provider connection state is invalid.',
      );
    }
    if (
      !isAllowedReturnUrl(
        session.returnUrl,
        this.options.returnUrlAllowlist ?? [],
      )
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidRequest,
        'The provider connection return URL is no longer allowed.',
      );
    }
    const now = this.now();
    if (session.expiresAt <= now) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectSessionExpired,
        'The provider connection session has expired.',
      );
    }
    const consumed = await this.options.repository.consumeConnectSession(
      session.id,
      now,
    );
    if (!consumed) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectSessionConsumed,
        'The provider connection session has already been used.',
      );
    }

    const redirect = (status: string): ProviderTokenConnectCallbackResult => {
      if (
        !isAllowedReturnUrl(
          session.returnUrl,
          this.options.returnUrlAllowlist ?? [],
        )
      ) {
        throw new ProviderTokenError(
          providerTokenErrorCodes.invalidRequest,
          'The provider connection return URL is no longer allowed.',
        );
      }
      const url = new URL(session.returnUrl);
      url.searchParams.set('sessionId', session.id);
      url.searchParams.set('status', status);
      return { redirectUrl: url.toString() };
    };

    if (input.providerError || !input.code) {
      await this.options.repository.decideConnectSession({
        sessionId: session.id,
        userEntityRef: session.userEntityRef,
        decision: 'deny',
        now,
      });
      return redirect(
        input.providerError ? 'provider-denied' : 'callback-error',
      );
    }
    if (input.code.length > 4096) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidRequest,
        'The provider authorization response is invalid.',
      );
    }

    let codeVerifier: string;
    try {
      codeVerifier = this.options.cipher.decrypt(
        session.codeVerifier,
        secretAssociatedData(
          session.userEntityRef,
          session.provider,
          'connect-verifier',
        ),
      );
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.encryptionError,
        'The provider connection could not be completed securely.',
      );
    }

    const adapter = this.adapters.get(session.provider);
    if (!adapter) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerNotConfigured,
        'The requested provider is not configured.',
      );
    }
    let tokenSet: ProviderTokenSet;
    try {
      tokenSet = await adapter.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier,
        redirectUri: session.redirectUri,
        scopes: [...session.providerScopes],
      });
    } catch (error) {
      if (error instanceof ProviderTokenError) throw error;
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerUnavailable,
        'The provider could not complete the OAuth connection.',
        { retryable: true },
      );
    }
    const tokenNow = this.now();
    if (
      !tokenSet.accessToken ||
      !Number.isFinite(tokenSet.accessTokenExpiresAt.getTime()) ||
      tokenSet.accessTokenExpiresAt <= tokenNow ||
      !tokenSet.refreshToken ||
      (tokenSet.refreshTokenExpiresAt &&
        (!Number.isFinite(tokenSet.refreshTokenExpiresAt.getTime()) ||
          tokenSet.refreshTokenExpiresAt <= tokenNow)) ||
      !areSameScopes(tokenSet.scopes, session.providerScopes)
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'The provider did not issue refreshable credentials with the requested scopes.',
      );
    }
    let pendingRefreshToken;
    try {
      pendingRefreshToken = this.options.cipher.encrypt(
        tokenSet.refreshToken,
        secretAssociatedData(
          session.userEntityRef,
          session.provider,
          'pending-refresh-token',
        ),
      );
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.encryptionError,
        'The provider credentials could not be secured.',
      );
    }
    const stored = await this.options.repository.storePendingConnectCredentials(
      {
        sessionId: session.id,
        refreshToken: pendingRefreshToken,
        refreshTokenExpiresAt: tokenSet.refreshTokenExpiresAt,
        providerScopes: [...tokenSet.scopes],
      },
    );
    if (!stored) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectSessionConsumed,
        'The provider connection session has already been used.',
      );
    }
    return redirect('consent-required');
  }

  /** Returns consent details only to the user who started the connection. */
  async getConnectSession(
    sessionId: string,
    userEntityRef: string,
  ): Promise<ProviderTokenConnectSessionSummary> {
    const session = await this.options.repository.getConnectSessionById(
      sessionId,
    );
    if (!session || session.userEntityRef !== userEntityRef) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectionNotFound,
        'The provider connection session was not found.',
      );
    }
    if (session.expiresAt <= this.now()) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectSessionExpired,
        'The provider connection session has expired.',
      );
    }
    if (
      session.consentStatus === 'pending' &&
      (!session.stateConsumedAt || !session.pendingRefreshToken)
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.consentRequired,
        'The provider authorization must complete before consent can be reviewed.',
      );
    }
    const client = this.clients.get(session.clientId);
    if (!client) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerNotConfigured,
        'The consent client is no longer configured.',
      );
    }
    return {
      sessionId: session.id,
      clientId: session.clientId,
      clientTitle: client.title,
      callerSubject: session.callerSubject,
      purpose: client.purpose ?? defaultConsentPurpose,
      provider: session.provider,
      scopes: [...session.scopes],
      expiresAt: session.expiresAt,
      consentStatus: session.consentStatus,
      grantId: session.grantId,
    };
  }

  /** Persists or denies the local background-access grant for a user. */
  async decideConnectSession(input: {
    sessionId: string;
    userEntityRef: string;
    decision: 'approve' | 'deny';
  }): Promise<ProviderTokenConnectDecisionResult> {
    const session = await this.options.repository.getConnectSessionById(
      input.sessionId,
    );
    if (!session || session.userEntityRef !== input.userEntityRef) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectionNotFound,
        'The provider connection session was not found.',
      );
    }
    const now = this.now();
    if (session.expiresAt <= now) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectSessionExpired,
        'The provider connection session has expired.',
      );
    }
    if (
      !session.stateConsumedAt ||
      session.consentStatus !== 'pending' ||
      !session.pendingRefreshToken ||
      !session.pendingScopes
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectSessionConsumed,
        'The provider connection session cannot be decided again.',
      );
    }
    if (
      session.pendingRefreshTokenExpiresAt &&
      session.pendingRefreshTokenExpiresAt <= now
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.tokenRefreshRejected,
        'The provider refresh token expired before consent was completed; reconnect the provider.',
      );
    }
    if (input.decision === 'deny') {
      const result = await this.options.repository.decideConnectSession({
        sessionId: session.id,
        userEntityRef: input.userEntityRef,
        decision: 'deny',
        now,
      });
      if (result.kind !== 'denied') {
        throw this.connectDecisionError(result.kind);
      }
      return { consentStatus: 'denied' };
    }

    if (
      !session.scopes.every(scope => session.pendingScopes!.includes(scope)) ||
      !areSameScopes(session.providerScopes, session.pendingScopes)
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'The provider connection scopes do not match the consent request.',
      );
    }
    let refreshToken: string;
    let encryptedRefreshToken;
    try {
      refreshToken = this.options.cipher.decrypt(
        session.pendingRefreshToken,
        secretAssociatedData(
          session.userEntityRef,
          session.provider,
          'pending-refresh-token',
        ),
      );
      encryptedRefreshToken = this.options.cipher.encrypt(
        refreshToken,
        secretAssociatedData(
          session.userEntityRef,
          session.provider,
          'refresh-token',
        ),
      );
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.encryptionError,
        'The provider credentials could not be processed securely.',
      );
    }
    const secret: StoredProviderSecret = {
      id: randomUUID(),
      userEntityRef: session.userEntityRef,
      provider: session.provider,
      refreshToken: encryptedRefreshToken,
      refreshTokenExpiresAt: session.pendingRefreshTokenExpiresAt,
      scopes: [...session.pendingScopes],
      createdAt: now,
      updatedAt: now,
    };
    const grant: Omit<StoredGrant, 'secretId'> = {
      id: randomBytes(32).toString('base64url'),
      userEntityRef: session.userEntityRef,
      clientId: session.clientId,
      callerSubject: session.callerSubject,
      provider: session.provider,
      scopes: [...session.scopes],
      createdAt: now,
      expiresAt: new Date(
        now.getTime() + (this.options.grantTtlMs ?? defaultGrantTtlMs),
      ),
    };
    const result = await this.options.repository.decideConnectSession({
      sessionId: session.id,
      userEntityRef: input.userEntityRef,
      decision: 'approve',
      now,
      secret,
      grant,
    });
    if (result.kind !== 'approved') {
      throw this.connectDecisionError(result.kind);
    }
    this.invalidate(result.secretId);
    return { consentStatus: 'approved', grantId: result.grantId };
  }

  /** Disconnects locally first, then best-effort revokes provider authorization. */
  async disconnectProvider(
    userEntityRef: string,
    provider: string,
  ): Promise<void> {
    const secret = await this.options.repository.disconnectProvider(
      userEntityRef,
      provider,
      this.now(),
    );
    if (!secret) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectionNotFound,
        'The provider connection was not found.',
      );
    }
    this.invalidate(secret.id);
    const adapter = this.adapters.get(provider);
    if (!adapter?.revokeRefreshToken) return;
    try {
      const refreshToken = this.options.cipher.decrypt(
        secret.refreshToken,
        secretAssociatedData(userEntityRef, provider, 'refresh-token'),
      );
      await adapter.revokeRefreshToken({ refreshToken });
    } catch {
      this.options.logger?.warn(
        'Provider-token local disconnect succeeded but upstream revocation failed',
        { provider, userEntityRef },
      );
    }
  }

  private connectDecisionError(
    kind: 'missing' | 'expired' | 'consumed' | 'approved' | 'denied',
  ): ProviderTokenError {
    if (kind === 'missing') {
      return new ProviderTokenError(
        providerTokenErrorCodes.connectionNotFound,
        'The provider connection session was not found.',
      );
    }
    if (kind === 'expired') {
      return new ProviderTokenError(
        providerTokenErrorCodes.connectSessionExpired,
        'The provider connection session has expired.',
      );
    }
    return new ProviderTokenError(
      providerTokenErrorCodes.connectSessionConsumed,
      'The provider connection session has already been decided.',
    );
  }

  /** Revokes a grant without revealing whether another user owns its ID. */
  async revokeGrant(grantId: string, userEntityRef: string): Promise<void> {
    const grant = await this.options.repository.getGrant(grantId);
    if (!grant || grant.userEntityRef !== userEntityRef) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.grantNotFound,
        'The provider-token grant was not found.',
      );
    }
    if (grant.revokedAt) return;
    await this.options.repository.revokeGrant(
      grantId,
      userEntityRef,
      this.now(),
    );
  }

  /** Validates every grant and caller binding before refreshing provider access. */
  async issueAccessToken(input: {
    grantId: string;
    callerSubject: string;
    provider?: string;
    context?: string;
  }): Promise<ProviderTokenAccessTokenResult> {
    const now = this.now();
    const grant = await this.options.repository.getGrant(input.grantId);
    if (!grant) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.consentRequired,
        'No active consent grant is available.',
      );
    }
    if (grant.revokedAt) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.grantRevoked,
        'The provider-token grant has been revoked.',
      );
    }
    if (grant.expiresAt <= now) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.grantExpired,
        'The provider-token grant has expired.',
      );
    }

    const client = this.clients.get(grant.clientId);
    if (
      !client ||
      grant.callerSubject !== input.callerSubject ||
      !client.allowedSubjects.includes(input.callerSubject)
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.callerNotAuthorized,
        'The authenticated service is not authorized for this grant.',
      );
    }
    if (input.provider !== undefined && grant.provider !== input.provider) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.callerNotAuthorized,
        'The authenticated service is not authorized for this grant.',
      );
    }

    this.assertProviderConfigured(grant.provider);
    const secret = await this.options.repository.getProviderSecretById(
      grant.secretId,
    );
    if (
      !secret ||
      secret.revokedAt ||
      secret.userEntityRef !== grant.userEntityRef ||
      secret.provider !== grant.provider
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectionNotFound,
        'The provider connection for this grant is not available.',
      );
    }
    if (
      grant.scopes.length === 0 ||
      !grant.scopes.every(scope => secret.scopes.includes(scope))
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.callerNotAuthorized,
        'The provider connection does not contain the grant scopes.',
      );
    }

    const accessToken = await this.getAccessToken(secret.id, grant.scopes);
    const issuedScopes = new Set(accessToken.scopes);
    if (
      issuedScopes.size !== grant.scopes.length ||
      !grant.scopes.every(scope => issuedScopes.has(scope))
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'The provider token scopes do not match the approved grant.',
      );
    }

    return {
      token: accessToken.accessToken,
      expiresAt: accessToken.expiresAt,
      scopes: [...grant.scopes],
      userEntityRef: grant.userEntityRef,
    };
  }

  /** Returns a cached or freshly refreshed access token for a stored secret. */
  async getAccessToken(
    secretId: string,
    scopes?: string[],
  ): Promise<ProviderTokenAccessToken> {
    const requestedScopes = scopes ? [...new Set(scopes)].sort() : undefined;
    const cacheKey = `${secretId}\u0000${JSON.stringify(
      requestedScopes ?? null,
    )}`;
    const generation = this.invalidationGenerations.get(secretId) ?? 0;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.usableUntil > this.now().getTime()) {
      return { ...cached.token, scopes: [...cached.token.scopes] };
    }

    const ongoing = this.inFlight.get(cacheKey);
    if (ongoing?.generation === generation) {
      const token = await ongoing.promise;
      return { ...token, scopes: [...token.scopes] };
    }

    const refresh = this.refresh(
      secretId,
      generation,
      requestedScopes,
      cacheKey,
    );
    this.inFlight.set(cacheKey, { generation, promise: refresh });
    try {
      const token = await refresh;
      return { ...token, scopes: [...token.scopes] };
    } finally {
      if (this.inFlight.get(cacheKey)?.promise === refresh) {
        this.inFlight.delete(cacheKey);
      }
    }
  }

  /** Drops an access token after local grant or connection revocation. */
  invalidate(secretId: string): void {
    const keyPrefix = `${secretId}\u0000`;
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(keyPrefix)) this.cache.delete(cacheKey);
    }
    this.invalidationGenerations.set(
      secretId,
      (this.invalidationGenerations.get(secretId) ?? 0) + 1,
    );
  }

  private async refresh(
    secretId: string,
    generation: number,
    requestedScopes: string[] | undefined,
    cacheKey: string,
  ): Promise<ProviderTokenAccessToken> {
    let outcome: RefreshOutcome | undefined;
    try {
      outcome = await this.options.repository.withLockedProviderSecret(
        secretId,
        async (secret, persist) => {
          if (secret.revokedAt) {
            return {
              kind: 'error',
              error: new ProviderTokenError(
                providerTokenErrorCodes.grantRevoked,
                'The provider connection has been revoked.',
              ),
            };
          }
          if (
            requestedScopes &&
            (requestedScopes.length === 0 ||
              !requestedScopes.every(scope => secret.scopes.includes(scope)))
          ) {
            return {
              kind: 'error',
              error: new ProviderTokenError(
                providerTokenErrorCodes.callerNotAuthorized,
                'The requested token scopes are not available on the connection.',
              ),
            };
          }
          if (
            secret.refreshTokenExpiresAt &&
            secret.refreshTokenExpiresAt.getTime() <= this.now().getTime()
          ) {
            const error = new ProviderTokenError(
              providerTokenErrorCodes.tokenRefreshRejected,
              'The provider refresh token has expired; reconnect the provider.',
            );
            await persist({
              ...secret,
              revokedAt: this.now(),
              updatedAt: this.now(),
            });
            return { kind: 'error', error };
          }

          this.assertProviderConfigured(secret.provider);
          const adapter = this.adapters.get(secret.provider)!;

          let refreshToken: string;
          try {
            refreshToken = this.options.cipher.decrypt(
              secret.refreshToken,
              secretAssociatedData(
                secret.userEntityRef,
                secret.provider,
                'refresh-token',
              ),
            );
          } catch {
            return {
              kind: 'error',
              error: new ProviderTokenError(
                providerTokenErrorCodes.encryptionError,
                'Stored provider credentials could not be decrypted.',
              ),
            };
          }

          let refreshed: ProviderTokenRefreshResult;
          try {
            refreshed = await adapter.refreshAccessToken({
              refreshToken,
              scopes: [...(requestedScopes ?? secret.scopes)],
            });
          } catch (error) {
            if (
              error instanceof ProviderTokenError &&
              error.code === providerTokenErrorCodes.tokenRefreshRejected
            ) {
              await persist({
                ...secret,
                revokedAt: this.now(),
                updatedAt: this.now(),
              });
              return { kind: 'error', error };
            }
            if (error instanceof ProviderTokenError) {
              return { kind: 'error', error };
            }
            return {
              kind: 'error',
              error: new ProviderTokenError(
                providerTokenErrorCodes.providerUnavailable,
                'The provider could not refresh credentials.',
                { retryable: true },
              ),
            };
          }

          if (
            !refreshed.accessToken ||
            !Number.isFinite(refreshed.accessTokenExpiresAt.getTime()) ||
            refreshed.accessTokenExpiresAt.getTime() <= this.now().getTime()
          ) {
            return {
              kind: 'error',
              error: new ProviderTokenError(
                providerTokenErrorCodes.invalidProviderResponse,
                'The provider returned an expired or invalid access token.',
              ),
            };
          }

          let encryptedRefreshToken = secret.refreshToken;
          if (refreshed.refreshToken) {
            try {
              encryptedRefreshToken = this.options.cipher.encrypt(
                refreshed.refreshToken,
                secretAssociatedData(
                  secret.userEntityRef,
                  secret.provider,
                  'refresh-token',
                ),
              );
            } catch {
              return {
                kind: 'error',
                error: new ProviderTokenError(
                  providerTokenErrorCodes.encryptionError,
                  'Rotated provider credentials could not be encrypted.',
                ),
              };
            }
          }

          const updatedSecret: StoredProviderSecret = {
            ...secret,
            refreshToken: encryptedRefreshToken,
            refreshTokenExpiresAt:
              refreshed.refreshTokenExpiresAt ?? secret.refreshTokenExpiresAt,
            updatedAt: this.now(),
          };
          await persist(updatedSecret);

          const scopes =
            refreshed.scopes === undefined
              ? [...secret.scopes]
              : [...new Set(refreshed.scopes)];
          const token: ProviderTokenAccessToken = {
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.accessTokenExpiresAt,
            scopes,
          };
          return { kind: 'token', token };
        },
      );
    } catch (error) {
      if (error instanceof ProviderTokenError) throw error;
      if (error instanceof TokenCipherError) {
        throw new ProviderTokenError(
          providerTokenErrorCodes.encryptionError,
          'Stored provider credentials could not be processed.',
        );
      }
      throw new ProviderTokenError(
        providerTokenErrorCodes.storageError,
        'Provider credentials could not be loaded or updated.',
        { retryable: true },
      );
    }

    if (!outcome) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.connectionNotFound,
        'The provider connection was not found.',
      );
    }
    if (outcome.kind === 'error') {
      throw outcome.error;
    }

    const token = outcome.token;
    if ((this.invalidationGenerations.get(secretId) ?? 0) === generation) {
      this.cache.set(cacheKey, {
        token,
        usableUntil: token.expiresAt.getTime() - this.cacheSafetyWindowMs,
      });
    }
    return { ...token, scopes: [...token.scopes] };
  }
}
