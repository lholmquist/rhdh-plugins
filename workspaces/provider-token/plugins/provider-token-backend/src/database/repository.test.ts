/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DatabaseService } from '@backstage/backend-plugin-api';
import knex, { type Knex } from 'knex';
import { migrate } from './migration';
import {
  ProviderTokenRepository,
  toGrantSummary,
  type StoredConnectSession,
  type StoredGrant,
  type StoredProviderSecret,
} from './repository';

const owner = 'user:default/alice';
const now = new Date('2026-10-02T12:00:00.000Z');

const makeSession = (
  overrides: Partial<StoredConnectSession> = {},
): StoredConnectSession => ({
  id: 'session-1',
  stateHash: 'sha256-state-hash',
  userEntityRef: owner,
  clientId: 'workflow-service',
  callerSubject: 'sonataflow',
  provider: 'github',
  scopes: ['read:user'],
  providerScopes: ['read:user'],
  redirectUri: 'http://localhost:7007/api/provider-token/callback',
  returnUrl: 'http://localhost:3000/provider-token/consent',
  codeVerifier: {
    ciphertext: 'encrypted-verifier',
    iv: 'iv-base64',
    authTag: 'tag-base64',
    keyVersion: 'v1',
  },
  createdAt: new Date('2026-10-02T11:55:00.000Z'),
  expiresAt: new Date('2026-10-02T12:05:00.000Z'),
  consentStatus: 'pending',
  ...overrides,
});

const makeGrant = (overrides: Partial<StoredGrant> = {}): StoredGrant => ({
  id: 'grant-1',
  userEntityRef: owner,
  clientId: 'workflow-service',
  callerSubject: 'sonataflow',
  provider: 'github',
  secretId: 'secret-1',
  scopes: ['read:user'],
  createdAt: new Date('2026-10-02T11:00:00.000Z'),
  expiresAt: new Date('2026-10-03T11:00:00.000Z'),
  ...overrides,
});

const makeSecret = (
  overrides: Partial<StoredProviderSecret> = {},
): StoredProviderSecret => ({
  id: 'secret-1',
  userEntityRef: owner,
  provider: 'github',
  refreshToken: {
    ciphertext: 'encrypted-refresh-material',
    iv: 'iv-base64',
    authTag: 'tag-base64',
    keyVersion: 'v1',
  },
  scopes: ['read:user'],
  createdAt: new Date('2026-10-02T11:00:00.000Z'),
  updatedAt: new Date('2026-10-02T11:00:00.000Z'),
  ...overrides,
});

describe('provider-token database repository', () => {
  let database: Knex;
  let repository: ProviderTokenRepository;

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
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('stores encrypted refresh material without persisting access tokens', async () => {
    const secret = makeSecret();
    await repository.storeProviderSecret(secret);

    await expect(
      repository.getProviderSecret(owner, 'github'),
    ).resolves.toEqual(secret);
    await expect(
      database('provider_token_secrets').columnInfo(),
    ).resolves.not.toHaveProperty('access_token_ciphertext');
  });

  it('preserves the secret identifier when refresh material is replaced', async () => {
    await repository.storeProviderSecret(makeSecret());
    const updatedSecret = makeSecret({
      id: 'new-secret-id',
      refreshToken: {
        ciphertext: 'rotated-encrypted-refresh-material',
        iv: 'new-iv-base64',
        authTag: 'new-tag-base64',
        keyVersion: 'v2',
      },
      updatedAt: new Date('2026-10-02T12:00:00.000Z'),
    });

    await expect(
      repository.storeProviderSecret(updatedSecret),
    ).resolves.toMatchObject({ id: 'secret-1' });
    await expect(
      repository.getProviderSecret(owner, 'github'),
    ).resolves.toMatchObject({
      id: 'secret-1',
      refreshToken: updatedSecret.refreshToken,
      updatedAt: updatedSecret.updatedAt,
    });
  });

  it('returns only safe owner-visible grant metadata', async () => {
    const grant = makeGrant();
    await repository.createGrant(grant);

    const stored = await repository.getGrant(grant.id);
    expect(stored).toEqual(grant);
    expect(toGrantSummary(stored!)).toEqual({
      grantId: grant.id,
      provider: grant.provider,
      clientId: grant.clientId,
      callerSubject: grant.callerSubject,
      scopes: grant.scopes,
      createdAt: grant.createdAt,
      expiresAt: grant.expiresAt,
      revokedAt: undefined,
    });
    expect(toGrantSummary(stored!)).not.toHaveProperty('secretId');
    expect(toGrantSummary(stored!)).not.toHaveProperty('userEntityRef');
  });

  it('consumes a valid connection session once and rejects expired sessions', async () => {
    await repository.createConnectSession(makeSession());
    await repository.createConnectSession(
      makeSession({
        id: 'expired-session',
        stateHash: 'expired-state-hash',
        expiresAt: new Date('2026-10-02T11:59:00.000Z'),
      }),
    );

    await expect(
      repository.consumeConnectSession('session-1', now),
    ).resolves.toBe(true);
    await expect(
      repository.consumeConnectSession('session-1', now),
    ).resolves.toBe(false);
    await expect(
      repository.consumeConnectSession('expired-session', now),
    ).resolves.toBe(false);
    await expect(
      repository.getConnectSessionByStateHash('sha256-state-hash'),
    ).resolves.toMatchObject({ stateConsumedAt: now });
  });

  it('cleans expired sessions and completed sessions past retention', async () => {
    await repository.createConnectSession(
      makeSession({
        id: 'expired-session',
        stateHash: 'expired-state-hash',
        expiresAt: new Date('2026-10-02T11:59:00.000Z'),
      }),
    );
    await repository.createConnectSession(
      makeSession({
        id: 'old-completed-session',
        stateHash: 'old-completed-state-hash',
        expiresAt: new Date('2026-10-03T12:00:00.000Z'),
        completedAt: new Date('2026-09-01T12:00:00.000Z'),
      }),
    );
    await repository.createConnectSession(
      makeSession({
        id: 'pending-session',
        stateHash: 'pending-state-hash',
      }),
    );

    await expect(repository.cleanupExpiredConnectSessions(now)).resolves.toBe(
      1,
    );
    await expect(
      repository.cleanupCompletedConnectSessionsBefore(
        new Date('2026-10-01T00:00:00.000Z'),
      ),
    ).resolves.toBe(1);
    await expect(
      repository.getConnectSessionById('pending-session'),
    ).resolves.toBeDefined();
    await expect(
      repository.getConnectSessionById('expired-session'),
    ).resolves.toBeUndefined();
  });
});
