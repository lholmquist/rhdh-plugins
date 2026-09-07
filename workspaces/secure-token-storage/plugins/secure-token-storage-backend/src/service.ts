/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  coreServices,
  createServiceFactory,
  type BackstageCredentials,
  type BackstageServicePrincipal,
  type RootConfigService,
} from '@backstage/backend-plugin-api';
import { DatabaseManager } from '@backstage/backend-defaults/database';
import {
  secureTokenStorageServiceRef,
  SecureTokenStorageError,
  type AccessTokenResult,
  type CreateTokenGrantInput,
  type ProviderDisconnectResult,
  type SecureTokenStorageErrorCode,
  type StoreProviderTokenInput,
  type SecureTokenStorageService,
  type SecureTokenStorageStatus,
  type TokenGrant,
} from '@red-hat-developer-hub/backstage-plugin-secure-token-storage-node';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { migrate } from './database/migration';
import {
  TokenStorageRepository,
  type StoredAuditEvent,
  type StoredConnectSession,
  type StoredGrant,
} from './database/repository';
import { createTokenCipher, TokenCipher, TokenCipherError } from './crypto';
import { GitHubOAuthAdapter, MicrosoftOAuthAdapter } from './providers';

export interface ProviderTokenRefresher {
  refresh(input: {
    provider: string;
    refreshToken: string;
    scopes: string[];
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }>;
}

export interface ProviderOAuthAdapter {
  createAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
  }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    scopes: string[];
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string[];
  }>;
}

interface ServiceOptions {
  repository?: TokenStorageRepository;
  cipher?: TokenCipher;
  now?: () => Date;
  refreshers?: ReadonlyMap<string, ProviderTokenRefresher>;
  allowedCallerSubjects?: ReadonlySet<string>;
  oauthAdapters?: ReadonlyMap<string, ProviderOAuthAdapter>;
  allowedRedirectUris?: ReadonlySet<string>;
  connectSessionTtlMs?: number;
  defaultGrantTtlMs?: number;
  maxGrantTtlMs?: number;
}

const associatedData = (
  connectionId: string,
  kind: 'access' | 'refresh',
): string => `secure-token-storage:${connectionId}:${kind}`;

const connectVerifierAssociatedData = (sessionId: string): string =>
  `secure-token-storage:connect-session:${sessionId}:code-verifier`;

const sha256Base64Url = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('base64url');

const toTokenGrant = (grant: StoredGrant): TokenGrant => ({
  grantId: grant.id,
  callerSubject: grant.callerSubject,
  provider: grant.provider,
  scopes: grant.scopes,
  workflowInstanceId: grant.workflowInstanceId,
  createdAt: grant.createdAt,
  expiresAt: grant.expiresAt,
  revokedAt: grant.revokedAt,
});

const requireServiceSubject = (
  caller: BackstageCredentials<BackstageServicePrincipal>,
): string => caller.principal.subject;

function createCipherFromConfig(config: RootConfigService): TokenCipher {
  const encryption = config.getOptionalConfig('secureTokenStorage.encryption');
  const activeKey = encryption?.getOptionalString('activeKey');
  if (!activeKey) {
    throw new Error(
      'secureTokenStorage.encryption.activeKey is required when secure token storage is enabled',
    );
  }

  return createTokenCipher({
    activeKey,
    activeKeyVersion: encryption?.getOptionalString('activeKeyVersion') ?? 'v1',
    previousKeys:
      encryption?.getOptional<Record<string, string>>('previousKeys'),
  });
}

function createOAuthProviders(config: RootConfigService): {
  adapters: ReadonlyMap<string, ProviderOAuthAdapter>;
  refreshers: ReadonlyMap<string, ProviderTokenRefresher>;
} {
  const adapters = new Map<string, ProviderOAuthAdapter>();
  const refreshers = new Map<string, ProviderTokenRefresher>();
  const oauth = config.getOptionalConfig('secureTokenStorage.oauth');
  const providers = oauth?.getOptionalConfig('providers');

  const github = providers?.getOptionalConfig('github');
  if (github) {
    const clientId = github.getOptionalString('clientId');
    const clientSecret = github.getOptionalString('clientSecret');
    if (!clientId || !clientSecret) {
      throw new Error(
        'secureTokenStorage.oauth.providers.github.clientId and clientSecret are required together',
      );
    }
    const adapter = new GitHubOAuthAdapter({
      clientId,
      clientSecret,
      authorizationUrl: github.getOptionalString('authorizationUrl'),
      tokenUrl: github.getOptionalString('tokenUrl'),
    });
    adapters.set('github', adapter);
    refreshers.set('github', adapter);
  }

  const microsoft = providers?.getOptionalConfig('microsoft');
  if (microsoft) {
    const clientId = microsoft.getOptionalString('clientId');
    const clientSecret = microsoft.getOptionalString('clientSecret');
    const tenant = microsoft.getOptionalString('tenant');
    if (!clientId || !clientSecret || !tenant) {
      throw new Error(
        'secureTokenStorage.oauth.providers.microsoft.clientId, clientSecret, and tenant are required together',
      );
    }
    const adapter = new MicrosoftOAuthAdapter({
      clientId,
      clientSecret,
      tenant,
      authorizationUrl: microsoft.getOptionalString('authorizationUrl'),
      tokenUrl: microsoft.getOptionalString('tokenUrl'),
    });
    adapters.set('microsoft', adapter);
    refreshers.set('microsoft', adapter);
  }

  return { adapters, refreshers };
}

/** @internal */
export class DefaultSecureTokenStorageService
  implements SecureTokenStorageService
{
  private readonly enabled: boolean;
  private readonly repository?: TokenStorageRepository;
  private readonly cipher?: TokenCipher;
  private readonly now: () => Date;
  private readonly refreshers: ReadonlyMap<string, ProviderTokenRefresher>;
  private readonly allowedCallerSubjects: ReadonlySet<string>;
  private readonly oauthAdapters: ReadonlyMap<string, ProviderOAuthAdapter>;
  private readonly allowedRedirectUris: ReadonlySet<string>;
  private readonly connectSessionTtlMs: number;
  private readonly defaultGrantTtlMs: number;
  private readonly maxGrantTtlMs: number;

  constructor(enabled: boolean, options: ServiceOptions = {}) {
    this.enabled = enabled;
    this.repository = options.repository;
    this.cipher = options.cipher;
    this.now = options.now ?? (() => new Date());
    this.refreshers = options.refreshers ?? new Map();
    this.allowedCallerSubjects = options.allowedCallerSubjects ?? new Set();
    this.oauthAdapters = options.oauthAdapters ?? new Map();
    this.allowedRedirectUris = options.allowedRedirectUris ?? new Set();
    this.connectSessionTtlMs = options.connectSessionTtlMs ?? 10 * 60 * 1000;
    this.defaultGrantTtlMs = options.defaultGrantTtlMs ?? 24 * 60 * 60 * 1000;
    this.maxGrantTtlMs = options.maxGrantTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  }

  async getStatus(): Promise<SecureTokenStorageStatus> {
    return { enabled: this.enabled };
  }

  async storeProviderToken(input: StoreProviderTokenInput): Promise<void> {
    this.assertReady();
    const now = this.now();
    const existing = await this.repository!.findConnection(
      input.userEntityRef,
      input.provider,
    );
    const id = existing?.id ?? randomUUID();
    const accessToken = this.cipher!.encrypt(
      input.accessToken,
      associatedData(id, 'access'),
    );
    const refreshToken = input.refreshToken
      ? this.cipher!.encrypt(input.refreshToken, associatedData(id, 'refresh'))
      : undefined;

    await this.repository!.upsertConnection({
      id,
      userEntityRef: input.userEntityRef,
      provider: input.provider,
      accessToken,
      refreshToken,
      accessTokenExpiresAt: input.expiresAt,
      scopes: [...input.scopes],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revokedAt: undefined,
    });
  }

  async createGrant(input: CreateTokenGrantInput): Promise<{
    grantId: string;
    expiresAt: Date;
  }> {
    this.assertReady();
    const connection = await this.repository!.findConnection(
      input.userEntityRef,
      input.provider,
    );
    if (!connection || connection.revokedAt) {
      throw new SecureTokenStorageError('connection-not-found');
    }
    if (!this.allowedCallerSubjects.has(input.callerSubject)) {
      throw new SecureTokenStorageError('caller-not-authorized');
    }
    if (!input.scopes.every(scope => connection.scopes.includes(scope))) {
      throw new SecureTokenStorageError('caller-not-authorized');
    }

    const grantId = randomUUID();
    await this.repository!.createGrant({
      id: grantId,
      userEntityRef: input.userEntityRef,
      callerSubject: input.callerSubject,
      provider: input.provider,
      scopes: [...input.scopes],
      workflowInstanceId: input.workflowInstanceId,
      createdAt: this.now(),
      expiresAt: input.expiresAt,
    });
    await this.recordAudit({
      eventType: 'grant-created',
      userEntityRef: input.userEntityRef,
      provider: input.provider,
      grantId,
      callerSubject: input.callerSubject,
      metadata: { scopeCount: input.scopes.length },
    });
    return { grantId, expiresAt: input.expiresAt };
  }

  async listGrants(options: {
    userEntityRef: string;
    provider?: string;
  }): Promise<TokenGrant[]> {
    this.assertReady();
    const grants = await this.repository!.listGrants(
      options.userEntityRef,
      options.provider,
    );
    return grants.map(toTokenGrant);
  }

  async disconnectProvider(options: {
    userEntityRef: string;
    provider: string;
  }): Promise<ProviderDisconnectResult> {
    this.assertReady();
    const disconnected = await this.repository!.disconnectProvider(
      options.userEntityRef,
      options.provider,
      this.now(),
    );
    if (!disconnected) {
      throw new SecureTokenStorageError('connection-not-found');
    }
    await this.recordAudit({
      eventType: 'provider-disconnected',
      userEntityRef: options.userEntityRef,
      provider: options.provider,
      connectionId: disconnected.connectionId,
      metadata: { revokedGrantCount: disconnected.revokedGrantCount },
    });
    return {
      provider: options.provider,
      revokedGrantCount: disconnected.revokedGrantCount,
    };
  }

  async startProviderConnection(input: {
    userEntityRef: string;
    provider: string;
    scopes: string[];
    redirectUri: string;
    callerSubject: string;
  }): Promise<{
    sessionId: string;
    authorizationUrl: string;
    expiresAt: Date;
  }> {
    this.assertReady();
    if (!this.allowedCallerSubjects.has(input.callerSubject)) {
      throw new SecureTokenStorageError('caller-not-authorized');
    }
    if (!this.allowedRedirectUris.has(input.redirectUri)) {
      throw new SecureTokenStorageError('invalid-redirect-uri');
    }
    const adapter = this.oauthAdapters.get(input.provider);
    if (!adapter) {
      throw new SecureTokenStorageError('provider-not-configured');
    }

    const sessionId = randomUUID();
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.connectSessionTtlMs);
    const authorizationUrl = adapter.createAuthorizationUrl({
      state,
      codeChallenge: sha256Base64Url(codeVerifier),
      redirectUri: input.redirectUri,
      scopes: [...input.scopes],
    });

    await this.repository!.createConnectSession({
      id: sessionId,
      stateHash: sha256Base64Url(state),
      userEntityRef: input.userEntityRef,
      callerSubject: input.callerSubject,
      provider: input.provider,
      scopes: [...input.scopes],
      redirectUri: input.redirectUri,
      codeVerifier: this.cipher!.encrypt(
        codeVerifier,
        connectVerifierAssociatedData(sessionId),
      ),
      createdAt: now,
      expiresAt,
      consentStatus: 'pending',
    });

    return { sessionId, authorizationUrl, expiresAt };
  }

  async completeProviderConnection(input: {
    provider: string;
    state: string;
    code?: string;
    providerError?: boolean;
  }): Promise<{
    sessionId: string;
    provider: string;
    userEntityRef: string;
    scopes: string[];
  }> {
    this.assertReady();
    const session = await this.repository!.findConnectSessionByStateHash(
      sha256Base64Url(input.state),
    );
    if (!session || session.provider !== input.provider) {
      throw new SecureTokenStorageError('connect-session-not-found');
    }
    const now = this.now();
    if (session.expiresAt <= now) {
      throw new SecureTokenStorageError('connect-session-expired');
    }
    if (session.stateConsumedAt) {
      throw new SecureTokenStorageError('connect-session-consumed');
    }
    if (!(await this.repository!.consumeConnectSession(session.id, now))) {
      throw new SecureTokenStorageError('connect-session-consumed');
    }
    if (input.providerError) {
      await this.recordAudit({
        eventType: 'consent-denied',
        userEntityRef: session.userEntityRef,
        provider: session.provider,
        callerSubject: session.callerSubject,
        metadata: { reason: 'provider-denied' },
      });
      throw new SecureTokenStorageError('oauth-consent-denied');
    }
    if (!input.code) {
      await this.recordAudit({
        eventType: 'consent-denied',
        userEntityRef: session.userEntityRef,
        provider: session.provider,
        callerSubject: session.callerSubject,
        metadata: { reason: 'missing-authorization-code' },
      });
      throw new SecureTokenStorageError('oauth-exchange-failed');
    }

    const adapter = this.oauthAdapters.get(session.provider);
    if (!adapter) {
      throw new SecureTokenStorageError('provider-not-configured');
    }

    let codeVerifier: string;
    try {
      codeVerifier = this.cipher!.decrypt(
        session.codeVerifier,
        connectVerifierAssociatedData(session.id),
      );
    } catch (error) {
      if (error instanceof TokenCipherError) {
        throw new SecureTokenStorageError('token-integrity-failed');
      }
      throw error;
    }

    let exchanged: Awaited<
      ReturnType<ProviderOAuthAdapter['exchangeAuthorizationCode']>
    >;
    try {
      exchanged = await adapter.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier,
        redirectUri: session.redirectUri,
        scopes: session.scopes,
      });
    } catch {
      await this.recordAudit({
        eventType: 'consent-denied',
        userEntityRef: session.userEntityRef,
        provider: session.provider,
        callerSubject: session.callerSubject,
        metadata: { reason: 'authorization-code-exchange-failed' },
      });
      throw new SecureTokenStorageError('oauth-exchange-failed');
    }

    const scopes = exchanged.scopes ?? session.scopes;
    if (
      scopes.length === 0 ||
      !scopes.every(scope => session.scopes.includes(scope))
    ) {
      await this.recordAudit({
        eventType: 'consent-denied',
        userEntityRef: session.userEntityRef,
        provider: session.provider,
        callerSubject: session.callerSubject,
        metadata: { reason: 'provider-scope-mismatch' },
      });
      throw new SecureTokenStorageError('oauth-exchange-failed');
    }
    await this.storeProviderToken({
      userEntityRef: session.userEntityRef,
      provider: session.provider,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt: exchanged.expiresAt,
      scopes,
    });
    await this.repository!.completeConnectSession(session.id, now, scopes);

    return {
      sessionId: session.id,
      provider: session.provider,
      userEntityRef: session.userEntityRef,
      scopes,
    };
  }

  async approveProviderConnection(input: {
    sessionId: string;
    userEntityRef: string;
    expiresAt?: Date;
  }): Promise<{
    grantId: string;
    provider: string;
    scopes: string[];
    expiresAt: Date;
  }> {
    this.assertReady();
    const session = await this.requireConsentSession(input.sessionId);
    if (session.userEntityRef !== input.userEntityRef) {
      throw new SecureTokenStorageError('consent-not-available');
    }
    const now = this.now();
    const expiresAt =
      input.expiresAt ?? new Date(now.getTime() + this.defaultGrantTtlMs);
    if (
      expiresAt <= now ||
      expiresAt.getTime() > now.getTime() + this.maxGrantTtlMs
    ) {
      throw new SecureTokenStorageError('consent-not-available');
    }

    const grantId = randomUUID();
    const created = await this.repository!.approveConnectSession(
      session.id,
      input.userEntityRef,
      {
        id: grantId,
        userEntityRef: session.userEntityRef,
        callerSubject: session.callerSubject,
        provider: session.provider,
        scopes: session.scopes,
        createdAt: now,
        expiresAt,
      },
      now,
    );
    if (!created) {
      throw new SecureTokenStorageError('consent-not-available');
    }
    await this.recordAudit({
      eventType: 'grant-created',
      userEntityRef: session.userEntityRef,
      provider: session.provider,
      grantId,
      callerSubject: session.callerSubject,
      metadata: { scopeCount: session.scopes.length },
    });
    return {
      grantId,
      provider: session.provider,
      scopes: session.scopes,
      expiresAt,
    };
  }

  async rejectProviderConnection(input: {
    sessionId: string;
    userEntityRef: string;
  }): Promise<void> {
    this.assertReady();
    const session = await this.requireConsentSession(input.sessionId);
    if (session.userEntityRef !== input.userEntityRef) {
      throw new SecureTokenStorageError('consent-not-available');
    }
    if (
      !(await this.repository!.rejectConnectSession(
        session.id,
        input.userEntityRef,
        this.now(),
      ))
    ) {
      throw new SecureTokenStorageError('consent-not-available');
    }
    await this.recordAudit({
      eventType: 'consent-denied',
      userEntityRef: session.userEntityRef,
      provider: session.provider,
      callerSubject: session.callerSubject,
      metadata: { reason: 'user-rejected' },
    });
  }

  async getAccessToken(options: {
    grantId: string;
    provider: string;
    caller: BackstageCredentials<BackstageServicePrincipal>;
  }): Promise<AccessTokenResult> {
    this.assertReady();
    const now = this.now();
    const callerSubject = requireServiceSubject(options.caller);
    const grant = await this.repository!.findGrant(options.grantId);
    if (!grant || grant.provider !== options.provider) {
      return this.denyGrantAccess(options, callerSubject, 'grant-not-found');
    }
    if (grant.revokedAt) {
      return this.denyGrantAccess(options, callerSubject, 'grant-revoked', {
        userEntityRef: grant.userEntityRef,
      });
    }
    if (grant.expiresAt <= now) {
      return this.denyGrantAccess(options, callerSubject, 'grant-expired', {
        userEntityRef: grant.userEntityRef,
      });
    }
    if (grant.callerSubject !== callerSubject) {
      return this.denyGrantAccess(
        options,
        callerSubject,
        'caller-not-authorized',
        {
          userEntityRef: grant.userEntityRef,
        },
      );
    }

    const connection = await this.repository!.findConnection(
      grant.userEntityRef,
      grant.provider,
    );
    if (!connection || connection.revokedAt) {
      return this.denyGrantAccess(
        options,
        callerSubject,
        'connection-not-found',
        {
          userEntityRef: grant.userEntityRef,
        },
      );
    }

    let accessToken: string;
    try {
      accessToken = this.cipher!.decrypt(
        connection.accessToken,
        associatedData(connection.id, 'access'),
      );
    } catch (error) {
      if (error instanceof TokenCipherError) {
        return this.denyGrantAccess(
          options,
          callerSubject,
          'token-integrity-failed',
          { userEntityRef: grant.userEntityRef },
        );
      }
      throw error;
    }

    if (
      !connection.accessTokenExpiresAt ||
      connection.accessTokenExpiresAt > now
    ) {
      await this.repository!.markConnectionUsed(connection.id, now);
      await this.recordAudit({
        eventType: 'grant-used',
        userEntityRef: grant.userEntityRef,
        provider: grant.provider,
        connectionId: connection.id,
        grantId: grant.id,
        callerSubject,
        metadata: { refreshed: false },
      });
      return {
        accessToken,
        expiresAt: connection.accessTokenExpiresAt,
        scopes: grant.scopes,
      };
    }

    if (!connection.refreshToken) {
      return this.denyGrantAccess(
        options,
        callerSubject,
        'provider-refresh-required',
        { userEntityRef: grant.userEntityRef },
      );
    }
    const refresher = this.refreshers.get(grant.provider);
    if (!refresher) {
      return this.denyGrantAccess(
        options,
        callerSubject,
        'provider-refresh-required',
        { userEntityRef: grant.userEntityRef },
      );
    }

    let refreshToken: string;
    let refreshed: Awaited<ReturnType<ProviderTokenRefresher['refresh']>>;
    try {
      refreshToken = this.cipher!.decrypt(
        connection.refreshToken,
        associatedData(connection.id, 'refresh'),
      );
      refreshed = await refresher.refresh({
        provider: grant.provider,
        refreshToken,
        scopes: grant.scopes,
      });
      const refreshedAccessToken = this.cipher!.encrypt(
        refreshed.accessToken,
        associatedData(connection.id, 'access'),
      );
      const refreshedRefreshToken = refreshed.refreshToken
        ? this.cipher!.encrypt(
            refreshed.refreshToken,
            associatedData(connection.id, 'refresh'),
          )
        : connection.refreshToken;
      await this.repository!.updateConnectionTokens(
        connection.id,
        {
          accessToken: refreshedAccessToken,
          refreshToken: refreshedRefreshToken,
          accessTokenExpiresAt: refreshed.expiresAt,
        },
        now,
      );
    } catch (error) {
      if (error instanceof TokenCipherError) {
        return this.denyGrantAccess(
          options,
          callerSubject,
          'token-integrity-failed',
          { userEntityRef: grant.userEntityRef },
        );
      }
      if (error instanceof SecureTokenStorageError) throw error;
      await this.recordAudit({
        eventType: 'token-refresh-failed',
        userEntityRef: grant.userEntityRef,
        provider: grant.provider,
        connectionId: connection.id,
        grantId: grant.id,
        callerSubject,
        metadata: { reason: 'provider-refresh-failed' },
      });
      throw new SecureTokenStorageError('provider-refresh-failed');
    }

    await this.recordAudit({
      eventType: 'token-refreshed',
      userEntityRef: grant.userEntityRef,
      provider: grant.provider,
      connectionId: connection.id,
      grantId: grant.id,
      callerSubject,
      metadata: { rotated: true },
    });
    await this.recordAudit({
      eventType: 'grant-used',
      userEntityRef: grant.userEntityRef,
      provider: grant.provider,
      connectionId: connection.id,
      grantId: grant.id,
      callerSubject,
      metadata: { refreshed: true },
    });
    return {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scopes: grant.scopes,
    };
  }

  async revokeGrant(options: {
    grantId: string;
    userEntityRef: string;
  }): Promise<void> {
    this.assertReady();
    const grant = await this.repository!.findGrant(options.grantId);
    if (!grant || grant.userEntityRef !== options.userEntityRef) {
      await this.recordAudit({
        eventType: 'grant-denied',
        userEntityRef: options.userEntityRef,
        grantId: options.grantId,
        metadata: { reason: 'grant-not-found' },
      });
      throw new SecureTokenStorageError('grant-not-found');
    }
    if (grant.revokedAt) return;
    if (
      await this.repository!.revokeGrant(
        options.grantId,
        options.userEntityRef,
        this.now(),
      )
    ) {
      await this.recordAudit({
        eventType: 'grant-revoked',
        userEntityRef: grant.userEntityRef,
        provider: grant.provider,
        grantId: grant.id,
        callerSubject: grant.callerSubject,
        metadata: { reason: 'user-revoked' },
      });
    }
  }

  private async denyGrantAccess(
    options: {
      grantId: string;
      provider: string;
    },
    callerSubject: string,
    code: SecureTokenStorageErrorCode,
    context: { userEntityRef?: string } = {},
  ): Promise<never> {
    await this.recordAudit({
      eventType: 'grant-denied',
      userEntityRef: context.userEntityRef,
      provider: options.provider,
      grantId: options.grantId,
      callerSubject,
      metadata: { reason: code },
    });
    throw new SecureTokenStorageError(code);
  }

  private async recordAudit(
    event: Omit<StoredAuditEvent, 'id' | 'occurredAt'>,
  ): Promise<void> {
    await this.repository!.recordAuditEvent({
      ...event,
      id: randomUUID(),
      occurredAt: this.now(),
    });
  }

  private assertReady(): void {
    if (!this.enabled) throw new SecureTokenStorageError('not-enabled');
    if (!this.repository || !this.cipher) {
      throw new Error('Secure token storage service is not fully configured');
    }
  }

  private async requireConsentSession(
    sessionId: string,
  ): Promise<StoredConnectSession> {
    const session = await this.repository!.findConnectSession(sessionId);
    if (!session) {
      throw new SecureTokenStorageError('connect-session-not-found');
    }
    if (session.expiresAt <= this.now()) {
      throw new SecureTokenStorageError('connect-session-expired');
    }
    if (
      !session.completedAt ||
      session.consentStatus !== 'pending' ||
      !session.stateConsumedAt
    ) {
      throw new SecureTokenStorageError('consent-not-available');
    }
    return session;
  }
}

/**
 * Root-scoped service factory for the secure token storage foundation.
 *
 * The feature is disabled unless explicitly enabled in configuration. Enabled
 * instances require a configured encryption key and allowlist of service
 * subjects before they can issue grants.
 *
 * @public
 */
export const secureTokenStorageServiceFactory = createServiceFactory({
  service: secureTokenStorageServiceRef,
  deps: {
    config: coreServices.rootConfig,
    logger: coreServices.rootLogger,
    lifecycle: coreServices.rootLifecycle,
  },
  async factory({ config, logger, lifecycle }) {
    const enabled =
      config.getOptionalBoolean('secureTokenStorage.enabled') ?? false;
    if (!enabled) return new DefaultSecureTokenStorageService(false);

    const allowedCallerSubjects = config.getOptionalStringArray(
      'secureTokenStorage.allowedCallerSubjects',
    );
    if (!allowedCallerSubjects?.length) {
      throw new Error(
        'secureTokenStorage.allowedCallerSubjects is required when secure token storage is enabled',
      );
    }

    const oauth = config.getOptionalConfig('secureTokenStorage.oauth');
    const allowedRedirectUris = oauth?.getOptionalStringArray(
      'allowedRedirectUris',
    );
    if (!allowedRedirectUris?.length) {
      throw new Error(
        'secureTokenStorage.oauth.allowedRedirectUris is required when secure token storage is enabled',
      );
    }

    const databaseManager = DatabaseManager.fromConfig(config, {
      rootLogger: logger,
      rootLifecycle: lifecycle,
    });
    const database = databaseManager.forPlugin('secure-token-storage', {
      logger,
      lifecycle,
    });
    await migrate(database);
    return new DefaultSecureTokenStorageService(true, {
      repository: new TokenStorageRepository(await database.getClient()),
      cipher: createCipherFromConfig(config),
      allowedCallerSubjects: new Set(allowedCallerSubjects),
      ...createOAuthProviders(config),
      allowedRedirectUris: new Set(allowedRedirectUris),
      connectSessionTtlMs:
        (oauth?.getOptionalNumber('connectSessionTtlSeconds') ?? 600) * 1000,
      defaultGrantTtlMs:
        (oauth?.getOptionalNumber('defaultGrantTtlSeconds') ?? 86400) * 1000,
      maxGrantTtlMs:
        (oauth?.getOptionalNumber('maxGrantTtlSeconds') ?? 2592000) * 1000,
    });
  },
});
