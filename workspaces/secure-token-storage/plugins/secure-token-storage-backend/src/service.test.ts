/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  DefaultSecureTokenStorageService,
  type ProviderOAuthAdapter,
} from './service';
import { createTokenCipher } from './crypto';
import type { TokenStorageRepository } from './database/repository';
import type {
  BackstageCredentials,
  BackstageServicePrincipal,
} from '@backstage/backend-plugin-api';

const key = Buffer.alloc(32, 1).toString('base64');
const caller = (
  subject: string,
): BackstageCredentials<BackstageServicePrincipal> => ({
  $$type: '@backstage/BackstageCredentials',
  principal: { type: 'service', subject },
});

function createRepository() {
  return {
    findConnection: jest.fn(),
    upsertConnection: jest.fn(),
    createGrant: jest.fn(),
    findGrant: jest.fn(),
    markConnectionUsed: jest.fn(),
    updateConnectionTokens: jest.fn(),
    revokeGrant: jest.fn(),
    createConnectSession: jest.fn(),
    findConnectSessionByStateHash: jest.fn(),
    findConnectSession: jest.fn(),
    consumeConnectSession: jest.fn(),
    completeConnectSession: jest.fn(),
    approveConnectSession: jest.fn(),
    rejectConnectSession: jest.fn(),
  } as unknown as jest.Mocked<TokenStorageRepository>;
}

describe('DefaultSecureTokenStorageService', () => {
  it('returns the disabled foundation status', async () => {
    await expect(
      new DefaultSecureTokenStorageService(false).getStatus(),
    ).resolves.toEqual({ enabled: false });
  });

  it('returns the explicitly enabled foundation status', async () => {
    await expect(
      new DefaultSecureTokenStorageService(true).getStatus(),
    ).resolves.toEqual({ enabled: true });
  });

  it('stores provider credentials encrypted and issues a caller-bound grant', async () => {
    const repository = createRepository();
    repository.findConnection.mockResolvedValue(undefined);
    const cipher = createTokenCipher({
      activeKey: key,
      activeKeyVersion: 'v1',
    });
    const service = new DefaultSecureTokenStorageService(true, {
      repository,
      cipher,
      now: () => new Date('2026-09-07T12:00:00Z'),
      allowedCallerSubjects: new Set(['sonataflow']),
    });

    await service.storeProviderToken({
      userEntityRef: 'user:default/luke',
      provider: 'github',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-09-07T13:00:00Z'),
      scopes: ['repo'],
    });

    const stored = repository.upsertConnection.mock.calls[0][0];
    expect(stored.accessToken.ciphertext).not.toBe('access-token');
    expect(
      cipher.decrypt(
        stored.accessToken,
        `secure-token-storage:${stored.id}:access`,
      ),
    ).toBe('access-token');

    repository.findConnection.mockResolvedValue(stored);
    const grant = await service.createGrant({
      userEntityRef: 'user:default/luke',
      provider: 'github',
      callerSubject: 'sonataflow',
      scopes: ['repo'],
      expiresAt: new Date('2026-09-08T12:00:00Z'),
    });

    expect(grant.grantId).toEqual(expect.any(String));
    expect(repository.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        callerSubject: 'sonataflow',
        scopes: ['repo'],
      }),
    );
  });

  it('checks caller authorization before loading encrypted token material', async () => {
    const repository = createRepository();
    repository.findGrant.mockResolvedValue({
      id: 'grant-1',
      userEntityRef: 'user:default/luke',
      callerSubject: 'sonataflow',
      provider: 'github',
      scopes: ['repo'],
      createdAt: new Date('2026-09-07T12:00:00Z'),
      expiresAt: new Date('2026-09-08T12:00:00Z'),
    });
    const service = new DefaultSecureTokenStorageService(true, {
      repository,
      cipher: createTokenCipher({ activeKey: key, activeKeyVersion: 'v1' }),
      now: () => new Date('2026-09-07T12:00:00Z'),
    });

    await expect(
      service.getAccessToken({
        grantId: 'grant-1',
        provider: 'github',
        caller: caller('untrusted-service'),
      }),
    ).rejects.toMatchObject({ code: 'caller-not-authorized' });
    expect(repository.findConnection).not.toHaveBeenCalled();
  });

  it('refreshes internally and never returns the refresh token', async () => {
    const repository = createRepository();
    const cipher = createTokenCipher({
      activeKey: key,
      activeKeyVersion: 'v1',
    });
    const connection = {
      id: 'connection-1',
      userEntityRef: 'user:default/luke',
      provider: 'github',
      accessToken: cipher.encrypt(
        'expired-access',
        'secure-token-storage:connection-1:access',
      ),
      refreshToken: cipher.encrypt(
        'refresh-token',
        'secure-token-storage:connection-1:refresh',
      ),
      accessTokenExpiresAt: new Date('2026-09-07T11:00:00Z'),
      scopes: ['repo'],
      createdAt: new Date('2026-09-07T10:00:00Z'),
      updatedAt: new Date('2026-09-07T10:00:00Z'),
    };
    repository.findGrant.mockResolvedValue({
      id: 'grant-1',
      userEntityRef: 'user:default/luke',
      callerSubject: 'sonataflow',
      provider: 'github',
      scopes: ['repo'],
      createdAt: new Date('2026-09-07T10:00:00Z'),
      expiresAt: new Date('2026-09-08T12:00:00Z'),
    });
    repository.findConnection.mockResolvedValue(connection);
    const service = new DefaultSecureTokenStorageService(true, {
      repository,
      cipher,
      now: () => new Date('2026-09-07T12:00:00Z'),
      refreshers: new Map([
        [
          'github',
          {
            refresh: jest.fn().mockResolvedValue({
              accessToken: 'fresh-access',
              refreshToken: 'rotated-refresh',
              expiresAt: new Date('2026-09-07T13:00:00Z'),
            }),
          },
        ],
      ]),
    });

    await expect(
      service.getAccessToken({
        grantId: 'grant-1',
        provider: 'github',
        caller: caller('sonataflow'),
      }),
    ).resolves.toEqual({
      accessToken: 'fresh-access',
      expiresAt: new Date('2026-09-07T13:00:00Z'),
      scopes: ['repo'],
    });
    expect(repository.updateConnectionTokens).toHaveBeenCalled();
    expect(
      JSON.stringify(repository.updateConnectionTokens.mock.calls[0]),
    ).not.toContain('rotated-refresh');
  });

  it('creates a short-lived PKCE session without persisting raw state or verifier', async () => {
    const repository = createRepository();
    const cipher = createTokenCipher({
      activeKey: key,
      activeKeyVersion: 'v1',
    });
    const adapter: ProviderOAuthAdapter = {
      createAuthorizationUrl: jest.fn(
        ({ state, codeChallenge, redirectUri, scopes }) =>
          `https://github.example/authorize?state=${state}&challenge=${codeChallenge}&redirect_uri=${encodeURIComponent(
            redirectUri,
          )}&scope=${scopes.join(' ')}`,
      ),
      exchangeAuthorizationCode: jest.fn(),
    };
    const service = new DefaultSecureTokenStorageService(true, {
      repository,
      cipher,
      now: () => new Date('2026-09-07T12:00:00Z'),
      oauthAdapters: new Map([['github', adapter]]),
      allowedCallerSubjects: new Set(['sonataflow']),
      allowedRedirectUris: new Set([
        'http://localhost:7007/api/secure-token-storage/connections/github/callback',
      ]),
      connectSessionTtlMs: 5 * 60 * 1000,
    });

    const result = await service.startProviderConnection({
      userEntityRef: 'user:default/luke',
      provider: 'github',
      scopes: ['repo'],
      redirectUri:
        'http://localhost:7007/api/secure-token-storage/connections/github/callback',
      callerSubject: 'sonataflow',
    });

    expect(result).toEqual({
      sessionId: expect.any(String),
      authorizationUrl: expect.stringContaining(
        'https://github.example/authorize',
      ),
      expiresAt: new Date('2026-09-07T12:05:00Z'),
    });
    const stored = repository.createConnectSession.mock.calls[0][0];
    expect(stored.stateHash).not.toEqual(
      new URL(result.authorizationUrl).searchParams.get('state'),
    );
    expect(
      cipher.decrypt(
        stored.codeVerifier,
        `secure-token-storage:connect-session:${stored.id}:code-verifier`,
      ),
    ).not.toHaveLength(0);
    expect(stored.consentStatus).toBe('pending');
  });

  it('exchanges a one-time callback and stores provider credentials without returning them', async () => {
    const repository = createRepository();
    repository.findConnection.mockResolvedValue(undefined);
    repository.consumeConnectSession.mockResolvedValue(true);
    const cipher = createTokenCipher({
      activeKey: key,
      activeKeyVersion: 'v1',
    });
    let callbackState = '';
    const adapter: ProviderOAuthAdapter = {
      createAuthorizationUrl: jest.fn(({ state }) => {
        callbackState = state;
        return `https://github.example/authorize?state=${state}`;
      }),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'oauth-access',
        refreshToken: 'oauth-refresh',
        expiresAt: new Date('2026-09-07T13:00:00Z'),
        scopes: ['repo'],
      }),
    };
    const service = new DefaultSecureTokenStorageService(true, {
      repository,
      cipher,
      now: () => new Date('2026-09-07T12:00:00Z'),
      oauthAdapters: new Map([['github', adapter]]),
      allowedCallerSubjects: new Set(['sonataflow']),
      allowedRedirectUris: new Set(['http://localhost/callback']),
    });
    const started = await service.startProviderConnection({
      userEntityRef: 'user:default/luke',
      provider: 'github',
      scopes: ['repo'],
      redirectUri: 'http://localhost/callback',
      callerSubject: 'sonataflow',
    });
    const stored = repository.createConnectSession.mock.calls[0][0];
    repository.findConnectSessionByStateHash.mockResolvedValue(stored);

    await expect(
      service.completeProviderConnection({
        provider: 'github',
        state: callbackState,
        code: 'one-time-code',
      }),
    ).resolves.toEqual({
      sessionId: started.sessionId,
      provider: 'github',
      userEntityRef: 'user:default/luke',
      scopes: ['repo'],
    });
    expect(adapter.exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: 'one-time-code',
      codeVerifier: expect.any(String),
      redirectUri: 'http://localhost/callback',
      scopes: ['repo'],
    });
    expect(repository.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userEntityRef: 'user:default/luke',
        provider: 'github',
      }),
    );
    expect(repository.completeConnectSession).toHaveBeenCalledWith(
      started.sessionId,
      new Date('2026-09-07T12:00:00Z'),
      ['repo'],
    );
  });

  it('creates a grant only after the owning user approves the completed session', async () => {
    const repository = createRepository();
    repository.findConnectSession.mockResolvedValue({
      id: 'session-1',
      stateHash: 'state-hash',
      userEntityRef: 'user:default/luke',
      callerSubject: 'sonataflow',
      provider: 'github',
      scopes: ['repo'],
      redirectUri: 'http://localhost/callback',
      codeVerifier: {
        ciphertext: 'x',
        iv: 'y',
        authTag: 'z',
        keyVersion: 'v1',
      },
      createdAt: new Date('2026-09-07T11:55:00Z'),
      expiresAt: new Date('2026-09-07T12:05:00Z'),
      stateConsumedAt: new Date('2026-09-07T12:00:00Z'),
      completedAt: new Date('2026-09-07T12:00:00Z'),
      consentStatus: 'pending',
    });
    repository.approveConnectSession.mockResolvedValue(true);
    const service = new DefaultSecureTokenStorageService(true, {
      repository,
      cipher: createTokenCipher({ activeKey: key, activeKeyVersion: 'v1' }),
      now: () => new Date('2026-09-07T12:00:00Z'),
      defaultGrantTtlMs: 60 * 60 * 1000,
      maxGrantTtlMs: 24 * 60 * 60 * 1000,
    });

    await expect(
      service.approveProviderConnection({
        sessionId: 'session-1',
        userEntityRef: 'user:default/luke',
      }),
    ).resolves.toEqual({
      grantId: expect.any(String),
      provider: 'github',
      scopes: ['repo'],
      expiresAt: new Date('2026-09-07T13:00:00Z'),
    });
    expect(repository.approveConnectSession).toHaveBeenCalledWith(
      'session-1',
      'user:default/luke',
      expect.objectContaining({
        callerSubject: 'sonataflow',
        provider: 'github',
        scopes: ['repo'],
      }),
      new Date('2026-09-07T12:00:00Z'),
    );
  });
});
