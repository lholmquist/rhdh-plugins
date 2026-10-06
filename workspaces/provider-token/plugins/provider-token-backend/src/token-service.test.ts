/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DatabaseService } from '@backstage/backend-plugin-api';
import { ProviderTokenError } from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type { ProviderTokenAdapter } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import knex, { type Knex } from 'knex';
import { createTokenCipher, secretAssociatedData } from './crypto';
import { migrate } from './database/migration';
import {
  ProviderTokenRepository,
  type StoredProviderSecret,
} from './database/repository';
import { ProviderTokenService } from './token-service';

const owner = 'user:default/alice';
const now = () => new Date('2026-10-02T12:00:00.000Z');

describe('ProviderTokenService', () => {
  let database: Knex;
  let repository: ProviderTokenRepository;
  let cipher: ReturnType<typeof createTokenCipher>;
  let secret: StoredProviderSecret;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await migrate({
      getClient: async () => database,
      migrations: { skip: false },
    } as unknown as DatabaseService);
    repository = new ProviderTokenRepository(database as never);
    cipher = createTokenCipher({
      activeKey: Buffer.alloc(32, 7).toString('base64'),
      activeKeyVersion: 'v1',
    });
    secret = {
      id: 'secret-1',
      userEntityRef: owner,
      provider: 'github',
      refreshToken: cipher.encrypt(
        'old-refresh-token',
        secretAssociatedData(owner, 'github', 'refresh-token'),
      ),
      scopes: ['read:user'],
      createdAt: now(),
      updatedAt: now(),
    };
    await repository.storeProviderSecret(secret);
  });

  afterEach(async () => {
    await database.destroy();
  });

  function adapter(
    refreshAccessToken: ProviderTokenAdapter['refreshAccessToken'],
  ): ProviderTokenAdapter {
    return {
      id: 'github',
      createAuthorizationUrl: () => 'https://github.com/login/oauth/authorize',
      exchangeAuthorizationCode: async () => {
        throw new Error('not used in refresh tests');
      },
      refreshAccessToken,
    };
  }

  it('fails closed when a provider module has not registered its adapter', () => {
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map(),
      now,
    });

    let caught: unknown;
    try {
      service.assertProviderConfigured('github');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'provider-not-configured' });
  });

  it('reuses an unexpired in-memory access token without refreshing again', async () => {
    const refreshAccessToken = jest.fn().mockResolvedValue({
      accessToken: 'short-lived-access',
      accessTokenExpiresAt: new Date('2026-10-02T12:10:00.000Z'),
      refreshToken: 'rotated-refresh-token',
      scopes: ['read:user'],
    });
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map([['github', adapter(refreshAccessToken)]]),
      now,
      cacheSafetyWindowMs: 30_000,
    });

    await expect(service.getAccessToken(secret.id)).resolves.toMatchObject({
      accessToken: 'short-lived-access',
      expiresAt: new Date('2026-10-02T12:10:00.000Z'),
    });
    await expect(service.getAccessToken(secret.id)).resolves.toMatchObject({
      accessToken: 'short-lived-access',
    });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('lists only safe grant metadata for the requested owner', async () => {
    await repository.createGrant({
      id: 'grant-1',
      userEntityRef: owner,
      clientId: 'workflow-service',
      callerSubject: 'sonataflow',
      provider: 'github',
      secretId: secret.id,
      scopes: ['read:user'],
      createdAt: now(),
      expiresAt: new Date('2026-10-03T12:00:00.000Z'),
    });
    await repository.createGrant({
      id: 'grant-2',
      userEntityRef: 'user:default/bob',
      clientId: 'workflow-service',
      callerSubject: 'sonataflow',
      provider: 'github',
      secretId: secret.id,
      scopes: ['read:user'],
      createdAt: now(),
      expiresAt: new Date('2026-10-03T12:00:00.000Z'),
    });
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map(),
      now,
    });

    const grants = await service.listGrants(owner);

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      grantId: 'grant-1',
      provider: 'github',
      clientId: 'workflow-service',
      callerSubject: 'sonataflow',
    });
    expect(grants[0]).not.toHaveProperty('secretId');
    expect(grants[0]).not.toHaveProperty('userEntityRef');
    expect(grants[0]).not.toHaveProperty('token');
  });

  it('revokes only a grant owned by the authenticated user', async () => {
    await repository.createGrant({
      id: 'grant-1',
      userEntityRef: owner,
      clientId: 'workflow-service',
      callerSubject: 'sonataflow',
      provider: 'github',
      secretId: secret.id,
      scopes: ['read:user'],
      createdAt: now(),
      expiresAt: new Date('2026-10-03T12:00:00.000Z'),
    });
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map(),
      now,
    });

    await expect(
      service.revokeGrant('grant-1', 'user:default/bob'),
    ).rejects.toMatchObject({ code: 'grant-not-found' });
    await service.revokeGrant('grant-1', owner);
    await expect(repository.getGrant('grant-1')).resolves.toMatchObject({
      revokedAt: now(),
    });
  });

  it('issues a token only to the configured client subject and returns the grant owner', async () => {
    await repository.createGrant({
      id: 'grant-1',
      userEntityRef: owner,
      clientId: 'workflow-service',
      callerSubject: 'sonataflow',
      provider: 'github',
      secretId: secret.id,
      scopes: ['read:user'],
      createdAt: now(),
      expiresAt: new Date('2026-10-03T12:00:00.000Z'),
    });
    const refreshAccessToken = jest.fn().mockResolvedValue({
      accessToken: 'short-lived-access',
      accessTokenExpiresAt: new Date('2026-10-02T12:10:00.000Z'),
      refreshToken: 'rotated-refresh-token',
      scopes: ['read:user'],
    });
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map([['github', adapter(refreshAccessToken)]]),
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
      now,
      cacheSafetyWindowMs: 30_000,
    });

    await expect(
      service.issueAccessToken({
        grantId: 'grant-1',
        callerSubject: 'sonataflow',
        provider: 'microsoft',
      }),
    ).rejects.toMatchObject({ code: 'caller-not-authorized' });
    expect(refreshAccessToken).not.toHaveBeenCalled();

    await expect(
      service.issueAccessToken({
        grantId: 'grant-1',
        callerSubject: 'sonataflow',
      }),
    ).resolves.toEqual({
      token: 'short-lived-access',
      expiresAt: new Date('2026-10-02T12:10:00.000Z'),
      scopes: ['read:user'],
      userEntityRef: owner,
    });
    expect(refreshAccessToken).toHaveBeenCalledWith({
      refreshToken: 'old-refresh-token',
      scopes: ['read:user'],
    });
  });

  it.each([
    ['provider reports broader scopes', ['read:user', 'read:org']],
    ['provider omits scope confirmation', undefined],
  ] as const)(
    'rejects a provider token when %s',
    async (_scenario, reportedScopes) => {
      await repository.storeProviderSecret({
        ...secret,
        scopes: ['read:user', 'read:org'],
      });
      await repository.createGrant({
        id: 'narrow-grant',
        userEntityRef: owner,
        clientId: 'workflow-service',
        callerSubject: 'sonataflow',
        provider: 'github',
        secretId: secret.id,
        scopes: ['read:user'],
        createdAt: now(),
        expiresAt: new Date('2026-10-03T12:00:00.000Z'),
      });
      const refreshAccessToken = jest.fn().mockResolvedValue({
        accessToken: 'over-scoped-token',
        accessTokenExpiresAt: new Date('2026-10-02T12:10:00.000Z'),
        refreshToken: 'rotated-refresh-token',
        scopes: reportedScopes,
      });
      const service = new ProviderTokenService({
        repository,
        cipher,
        adapters: new Map([['github', adapter(refreshAccessToken)]]),
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
        now,
        cacheSafetyWindowMs: 30_000,
      });

      await expect(
        service.issueAccessToken({
          grantId: 'narrow-grant',
          callerSubject: 'sonataflow',
        }),
      ).rejects.toMatchObject({ code: 'invalid-provider-response' });
      expect(refreshAccessToken).toHaveBeenCalledWith({
        refreshToken: 'old-refresh-token',
        scopes: ['read:user'],
      });
    },
  );

  it('keeps cached tokens separate for distinct approved scope sets', async () => {
    await repository.storeProviderSecret({
      ...secret,
      scopes: ['read:user', 'read:org'],
    });
    for (const [id, scopes] of [
      ['full-grant', ['read:user', 'read:org']],
      ['narrow-grant', ['read:user']],
    ] as const) {
      await repository.createGrant({
        id,
        userEntityRef: owner,
        clientId: 'workflow-service',
        callerSubject: 'sonataflow',
        provider: 'github',
        secretId: secret.id,
        scopes: [...scopes],
        createdAt: now(),
        expiresAt: new Date('2026-10-03T12:00:00.000Z'),
      });
    }
    const refreshAccessToken = jest.fn(async (input: { scopes: string[] }) => ({
      accessToken: `token-${input.scopes.join('-')}`,
      accessTokenExpiresAt: new Date('2026-10-02T12:10:00.000Z'),
      refreshToken: `rotated-${input.scopes.join('-')}`,
      scopes: [...input.scopes],
    }));
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map([['github', adapter(refreshAccessToken)]]),
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
      now,
      cacheSafetyWindowMs: 30_000,
    });

    await expect(
      service.issueAccessToken({
        grantId: 'full-grant',
        callerSubject: 'sonataflow',
      }),
    ).resolves.toMatchObject({ token: 'token-read:org-read:user' });
    await expect(
      service.issueAccessToken({
        grantId: 'narrow-grant',
        callerSubject: 'sonataflow',
      }),
    ).resolves.toMatchObject({ token: 'token-read:user' });
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'missing consent',
      grant: undefined,
      errorCode: 'consent-required',
    },
    {
      name: 'revoked grant',
      grant: { revokedAt: now() },
      errorCode: 'grant-revoked',
    },
    {
      name: 'expired grant',
      grant: { expiresAt: new Date('2026-10-02T11:59:59.000Z') },
      errorCode: 'grant-expired',
    },
    {
      name: 'secret provider mismatch',
      grant: { provider: 'microsoft' },
      errorCode: 'connection-not-found',
    },
    {
      name: 'grant caller mismatch',
      grant: { callerSubject: 'another-service' },
      errorCode: 'caller-not-authorized',
    },
    {
      name: 'unconfigured client',
      grant: { clientId: 'unknown-client' },
      errorCode: 'caller-not-authorized',
    },
    {
      name: 'scope not held by secret',
      grant: { scopes: ['read:org'] },
      errorCode: 'caller-not-authorized',
    },
    {
      name: 'unlisted authenticated service',
      grant: {},
      callerSubject: 'another-service',
      errorCode: 'caller-not-authorized',
    },
  ])(
    'rejects token issuance for $name',
    async ({ grant: grantOverrides, callerSubject, errorCode }) => {
      if (grantOverrides !== undefined) {
        await repository.createGrant({
          id: 'grant-1',
          userEntityRef: owner,
          clientId: 'workflow-service',
          callerSubject: 'sonataflow',
          provider: 'github',
          secretId: secret.id,
          scopes: ['read:user'],
          createdAt: now(),
          expiresAt: new Date('2026-10-03T12:00:00.000Z'),
          ...grantOverrides,
        });
      }
      const service = new ProviderTokenService({
        repository,
        cipher,
        adapters: new Map([
          ['github', adapter(jest.fn())],
          ['microsoft', { ...adapter(jest.fn()), id: 'microsoft' }],
        ]),
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
        now,
      });

      await expect(
        service.issueAccessToken({
          grantId: 'grant-1',
          callerSubject: callerSubject ?? 'sonataflow',
        }),
      ).rejects.toMatchObject({ code: errorCode });
    },
  );

  it('marks rejected refresh credentials revoked and does not retry them', async () => {
    const refreshAccessToken = jest.fn(async () => {
      throw new ProviderTokenError(
        'token-refresh-rejected',
        'The provider refresh token was rejected.',
      );
    });
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map([['github', adapter(refreshAccessToken)]]),
      now,
    });

    await expect(service.getAccessToken(secret.id)).rejects.toMatchObject({
      code: 'token-refresh-rejected',
      retryable: false,
    });
    await expect(
      repository.getProviderSecretById(secret.id),
    ).resolves.toMatchObject({
      revokedAt: now(),
    });
    await expect(service.getAccessToken(secret.id)).rejects.toMatchObject({
      code: 'grant-revoked',
    });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('does not cache an access token when invalidation races with refresh', async () => {
    let signalRefreshStarted!: () => void;
    let releaseRefresh!: () => void;
    const refreshStarted = new Promise<void>(resolve => {
      signalRefreshStarted = resolve;
    });
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    const refreshAccessToken = jest.fn() as jest.MockedFunction<
      ProviderTokenAdapter['refreshAccessToken']
    >;
    refreshAccessToken.mockImplementation(async () => {
      const call = refreshAccessToken.mock.calls.length;
      signalRefreshStarted();
      if (call === 1) await refreshGate;
      return {
        accessToken: `access-${call}`,
        accessTokenExpiresAt: new Date('2026-10-02T12:10:00.000Z'),
        refreshToken: `refresh-${call}`,
        scopes: ['read:user'],
      };
    });
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map([['github', adapter(refreshAccessToken)]]),
      now,
      cacheSafetyWindowMs: 30_000,
    });

    const first = service.getAccessToken(secret.id);
    await refreshStarted;
    service.invalidate(secret.id);
    releaseRefresh();
    await first;

    await expect(service.getAccessToken(secret.id)).resolves.toMatchObject({
      accessToken: 'access-2',
    });
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it('single-flights concurrent SQLite refreshes and persists rotation before returning', async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    const refreshAccessToken = jest.fn(async () => {
      await refreshGate;
      return {
        accessToken: 'fresh-access-token',
        accessTokenExpiresAt: new Date('2026-10-02T12:10:00.000Z'),
        refreshToken: 'new-refresh-token',
        scopes: ['read:user'],
      };
    });
    const service = new ProviderTokenService({
      repository,
      cipher,
      adapters: new Map([['github', adapter(refreshAccessToken)]]),
      now,
      cacheSafetyWindowMs: 30_000,
    });

    const first = service.getAccessToken(secret.id);
    const second = service.getAccessToken(secret.id);
    await Promise.resolve();
    releaseRefresh();
    const [firstToken, secondToken] = await Promise.all([first, second]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(firstToken.accessToken).toBe('fresh-access-token');
    expect(secondToken.accessToken).toBe('fresh-access-token');
    const persisted = await repository.getProviderSecretById(secret.id);
    expect(
      cipher.decrypt(
        persisted!.refreshToken,
        secretAssociatedData(owner, 'github', 'refresh-token'),
      ),
    ).toBe('new-refresh-token');
  });
});
