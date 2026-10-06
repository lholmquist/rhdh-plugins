/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import knexFactory, { type Knex } from 'knex';
import { createTokenCipher, secretAssociatedData } from './crypto';
import { migrate } from './database/migration';
import { ProviderTokenRepository } from './database/repository';
import { ProviderTokenService } from './token-service';
import type {
  ProviderTokenAdapter,
  ProviderTokenSet,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-node';

describe('provider-token connection lifecycle', () => {
  let database: Knex;
  let repository: ProviderTokenRepository;
  let service: ProviderTokenService;
  let cipher: ReturnType<typeof createTokenCipher>;
  let now: Date;
  let adapter: jest.Mocked<ProviderTokenAdapter>;

  beforeEach(async () => {
    database = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await migrate({ getClient: async () => database } as never);
    repository = new ProviderTokenRepository(database as never);
    now = new Date('2026-10-03T12:00:00.000Z');
    adapter = {
      id: 'github',
      createAuthorizationUrl: jest.fn(input => {
        const url = new URL('https://github.example/authorize');
        url.searchParams.set('state', input.state);
        url.searchParams.set('code_challenge', input.codeChallenge);
        url.searchParams.set('redirect_uri', input.redirectUri);
        url.searchParams.set('scope', input.scopes.join(' '));
        return url.toString();
      }),
      exchangeAuthorizationCode: jest
        .fn<
          Promise<ProviderTokenSet>,
          Parameters<ProviderTokenAdapter['exchangeAuthorizationCode']>
        >()
        .mockResolvedValue({
          accessToken: 'temporary-access-token',
          accessTokenExpiresAt: new Date('2026-10-03T12:10:00.000Z'),
          refreshToken: 'refresh-token-from-provider',
          refreshTokenExpiresAt: new Date('2026-11-03T12:00:00.000Z'),
          scopes: ['read:user'],
        }),
      refreshAccessToken: jest.fn().mockResolvedValue({
        accessToken: 'short-lived-access-token',
        accessTokenExpiresAt: new Date('2026-10-03T12:10:00.000Z'),
        refreshToken: 'rotated-refresh-token',
        refreshTokenExpiresAt: new Date('2026-11-03T12:00:00.000Z'),
        scopes: ['read:user'],
      }),
    };
    cipher = createTokenCipher({
      activeKey: Buffer.alloc(32, 1).toString('base64'),
      activeKeyVersion: 'v1',
    });
    service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map([['github', adapter]]),
      clients: new Map([
        [
          'workflow-service',
          {
            id: 'workflow-service',
            title: 'Workflow Service',
            allowedSubjects: ['sonataflow'],
            providerScopes: { github: ['read:user'] },
          },
        ],
      ]),
      callbackUrl:
        'http://localhost:7007/api/provider-token/v1/connect/callback',
      returnUrlAllowlist: [
        { origin: 'http://localhost:3000', pathPrefix: '/provider-token' },
      ],
      now: () => now,
    });
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('connects a provider, obtains explicit consent, and issues only the approved grant', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const authorization = new URL(started.authorizationUrl);
    const state = authorization.searchParams.get('state');
    const challenge = authorization.searchParams.get('code_challenge');

    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      'http://localhost:7007/api/provider-token/v1/connect/callback',
    );
    expect(authorization.searchParams.get('scope')).toBe('read:user');

    await expect(
      service.completeConnectCallback({ state: state!, code: 'oauth-code' }),
    ).resolves.toMatchObject({
      redirectUrl: expect.stringContaining(`sessionId=${started.sessionId}`),
    });
    expect(adapter.exchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'oauth-code',
        redirectUri:
          'http://localhost:7007/api/provider-token/v1/connect/callback',
        scopes: ['read:user'],
      }),
    );

    const consent = await service.getConnectSession(
      started.sessionId,
      'user:default/alice',
    );
    expect(consent).toMatchObject({
      clientId: 'workflow-service',
      clientTitle: 'Workflow Service',
      callerSubject: 'sonataflow',
      provider: 'github',
      scopes: ['read:user'],
      consentStatus: 'pending',
    });
    expect(JSON.stringify(consent)).not.toContain(
      'refresh-token-from-provider',
    );
    expect(JSON.stringify(consent)).not.toContain('temporary-access-token');

    const decision = await service.decideConnectSession({
      sessionId: started.sessionId,
      userEntityRef: 'user:default/alice',
      decision: 'approve',
    });
    expect(decision.grantId).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    await expect(
      service.listGrants('user:default/alice'),
    ).resolves.toMatchObject([
      {
        grantId: decision.grantId,
        provider: 'github',
        clientId: 'workflow-service',
        scopes: ['read:user'],
      },
    ]);
    await expect(
      service.issueAccessToken({
        grantId: decision.grantId!,
        callerSubject: 'sonataflow',
      }),
    ).resolves.toMatchObject({
      token: 'short-lived-access-token',
      scopes: ['read:user'],
      userEntityRef: 'user:default/alice',
    });

    const secret = await repository.getProviderSecret(
      'user:default/alice',
      'github',
    );
    expect(
      cipher.decrypt(
        secret!.refreshToken,
        secretAssociatedData('user:default/alice', 'github', 'refresh-token'),
      ),
    ).toBe('rotated-refresh-token');
    expect(JSON.stringify(secret)).not.toContain('temporary-access-token');
  });

  it('does not create a connection for an unapproved return URL', async () => {
    await expect(
      service.startConnect({
        userEntityRef: 'user:default/alice',
        provider: 'github',
        clientId: 'workflow-service',
        returnUrl: 'https://attacker.example/consent',
      }),
    ).rejects.toMatchObject({ code: 'invalid-request' });

    expect(adapter.createAuthorizationUrl).not.toHaveBeenCalled();
    await expect(
      service.listConnections('user:default/alice'),
    ).resolves.toEqual([]);
  });

  it('does not consume a connect session twice', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;

    await service.completeConnectCallback({ state, code: 'first-code' });
    await expect(
      service.completeConnectCallback({ state, code: 'replayed-code' }),
    ).rejects.toMatchObject({ code: 'connect-session-consumed' });

    expect(adapter.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it('rejects a state mismatch without consuming the valid session', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;

    await expect(
      service.completeConnectCallback({
        state: 'mismatched-state-value-that-is-long-enough',
        code: 'oauth-code',
      }),
    ).rejects.toMatchObject({ code: 'invalid-oauth-state' });
    expect(adapter.exchangeAuthorizationCode).not.toHaveBeenCalled();
    await expect(
      service.completeConnectCallback({ state, code: 'oauth-code' }),
    ).resolves.toMatchObject({
      redirectUrl: expect.stringContaining('sessionId='),
    });
  });

  it('rejects an expired session before exchanging an OAuth code', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    now = new Date(started.expiresAt.getTime() + 1);

    await expect(
      service.completeConnectCallback({ state, code: 'oauth-code' }),
    ).rejects.toMatchObject({ code: 'connect-session-expired' });
    expect(adapter.exchangeAuthorizationCode).not.toHaveBeenCalled();
    await expect(
      service.listConnections('user:default/alice'),
    ).resolves.toEqual([]);
  });

  it('rejects provider credentials whose actual scopes differ from the authorization request', async () => {
    adapter.exchangeAuthorizationCode.mockResolvedValueOnce({
      accessToken: 'temporary-access-token',
      accessTokenExpiresAt: new Date('2026-10-03T12:10:00.000Z'),
      refreshToken: 'refresh-token-from-provider',
      scopes: ['repo'],
    });
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;

    await expect(
      service.completeConnectCallback({ state, code: 'oauth-code' }),
    ).rejects.toMatchObject({ code: 'invalid-provider-response' });
    await expect(
      service.listConnections('user:default/alice'),
    ).resolves.toEqual([]);
    await expect(service.listGrants('user:default/alice')).resolves.toEqual([]);
  });

  it('does not approve a refresh credential that expires before consent', async () => {
    adapter.exchangeAuthorizationCode.mockResolvedValueOnce({
      accessToken: 'temporary-access-token',
      accessTokenExpiresAt: new Date('2026-10-03T12:10:00.000Z'),
      refreshToken: 'short-lived-refresh-token',
      refreshTokenExpiresAt: new Date('2026-10-03T12:00:01.000Z'),
      scopes: ['read:user'],
    });
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await service.completeConnectCallback({ state, code: 'oauth-code' });
    now = new Date('2026-10-03T12:00:02.000Z');

    await expect(
      service.decideConnectSession({
        sessionId: started.sessionId,
        userEntityRef: 'user:default/alice',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'token-refresh-rejected' });
    await expect(
      service.listConnections('user:default/alice'),
    ).resolves.toEqual([]);
    await expect(service.listGrants('user:default/alice')).resolves.toEqual([]);
  });

  it('does not persist a provider connection when the user denies consent', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await service.completeConnectCallback({ state, code: 'oauth-code' });

    await expect(
      service.decideConnectSession({
        sessionId: started.sessionId,
        userEntityRef: 'user:default/alice',
        decision: 'deny',
      }),
    ).resolves.toEqual({ consentStatus: 'denied' });
    await expect(
      service.listConnections('user:default/alice'),
    ).resolves.toEqual([]);
    await expect(service.listGrants('user:default/alice')).resolves.toEqual([]);
  });

  it('does not reveal or approve another user’s connection session', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await service.completeConnectCallback({ state, code: 'oauth-code' });

    await expect(
      service.getConnectSession(started.sessionId, 'user:default/bob'),
    ).rejects.toMatchObject({ code: 'connection-not-found' });
    await expect(
      service.decideConnectSession({
        sessionId: started.sessionId,
        userEntityRef: 'user:default/bob',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'connection-not-found' });
    await expect(service.listGrants('user:default/alice')).resolves.toEqual([]);
  });

  it('rolls back both the provider secret and grant when approval persistence fails', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await service.completeConnectCallback({ state, code: 'oauth-code' });
    await database.raw(
      "CREATE TRIGGER fail_provider_token_grant BEFORE INSERT ON provider_token_grants BEGIN SELECT RAISE(ABORT, 'simulated grant write failure'); END",
    );
    await expect(
      database.raw(
        "INSERT INTO provider_token_grants (id, user_entity_ref, client_id, caller_subject, provider, secret_id, scopes_json, created_at, expires_at) VALUES ('trigger-check', 'user:default/alice', 'workflow-service', 'sonataflow', 'github', 'secret-check', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
      ),
    ).rejects.toThrow('simulated grant write failure');

    await expect(
      service.decideConnectSession({
        sessionId: started.sessionId,
        userEntityRef: 'user:default/alice',
        decision: 'approve',
      }),
    ).rejects.toThrow();
    await expect(
      service.listConnections('user:default/alice'),
    ).resolves.toEqual([]);
    await expect(service.listGrants('user:default/alice')).resolves.toEqual([]);
    await expect(
      service.getConnectSession(started.sessionId, 'user:default/alice'),
    ).resolves.toMatchObject({ consentStatus: 'pending' });

    await database.raw('DROP TRIGGER fail_provider_token_grant');
    await expect(
      service.decideConnectSession({
        sessionId: started.sessionId,
        userEntityRef: 'user:default/alice',
        decision: 'approve',
      }),
    ).resolves.toMatchObject({ consentStatus: 'approved' });
  });

  it('disconnects locally even when GitHub cannot revoke upstream authorization', async () => {
    const started = await service.startConnect({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await service.completeConnectCallback({ state, code: 'oauth-code' });
    const approved = await service.decideConnectSession({
      sessionId: started.sessionId,
      userEntityRef: 'user:default/alice',
      decision: 'approve',
    });
    adapter.revokeRefreshToken = jest
      .fn()
      .mockRejectedValue(new Error('provider diagnostic secret'));

    await expect(
      service.disconnectProvider('user:default/alice', 'github'),
    ).resolves.toBeUndefined();
    await expect(
      service.listConnections('user:default/alice'),
    ).resolves.toEqual([]);
    await expect(
      service.listGrants('user:default/alice'),
    ).resolves.toMatchObject([{ grantId: approved.grantId, revokedAt: now }]);
    await expect(
      service.issueAccessToken({
        grantId: approved.grantId!,
        callerSubject: 'sonataflow',
      }),
    ).rejects.toMatchObject({ code: 'grant-revoked' });
  });
});
