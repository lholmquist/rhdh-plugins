/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import express from 'express';
import request from 'supertest';
import type {
  BackstageCredentials,
  BackstageServicePrincipal,
  BackstageUserPrincipal,
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import {
  SecureTokenStorageError,
  type SecureTokenStorageService,
} from '@red-hat-developer-hub/backstage-plugin-secure-token-storage-node';
import { createRouter } from './router';

const userCredentials = (
  userEntityRef = 'user:default/luke',
  actorSubject?: string,
): BackstageCredentials<BackstageUserPrincipal> => ({
  $$type: '@backstage/BackstageCredentials',
  principal: {
    type: 'user',
    userEntityRef,
    ...(actorSubject
      ? { actor: { type: 'service', subject: actorSubject } }
      : {}),
  },
});

const serviceCredentials = (
  subject: string,
): BackstageCredentials<BackstageServicePrincipal> => ({
  $$type: '@backstage/BackstageCredentials',
  principal: { type: 'service', subject },
});

describe('secure token storage router', () => {
  it('logs every access token endpoint request without token material', async () => {
    const httpAuth = {
      credentials: jest
        .fn()
        .mockResolvedValue(serviceCredentials('sonataflow')),
    } as unknown as jest.Mocked<HttpAuthService>;
    const logger = {
      info: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;
    const service = {
      getAccessToken: jest.fn().mockResolvedValue({
        accessToken: 'provider-access-token',
        scopes: ['repo'],
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, logger, service }),
    );

    await request(app)
      .post('/api/secure-token-storage/token')
      .send({ grantId: 'grant-1', provider: 'github' })
      .expect(200);

    const logOutput = logger.info.mock.calls.map(call => call[0]).join('\n');
    expect(logger.info.mock.calls[0][0]).toContain('\n');
    expect(logOutput).toContain('POST /api/secure-token-storage/token');
    expect(logOutput).toContain('Stage: request received');
    expect(logOutput).toContain('Stage: access token returned');
    expect(logOutput).toContain('Grant ID and token values: [REDACTED]');
    expect(logOutput).not.toContain('provider-access-token');
    expect(logOutput).not.toContain('grant-1');
  });

  it('derives the caller subject from credentials instead of request data', async () => {
    const httpAuth = {
      credentials: jest
        .fn()
        .mockResolvedValue(userCredentials(undefined, 'sonataflow')),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      startProviderConnection: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        authorizationUrl: 'https://github.example/authorize',
        expiresAt: new Date('2026-09-07T12:10:00Z'),
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    await request(app)
      .post('/api/secure-token-storage/connections/github/start')
      .send({
        scopes: ['repo'],
        redirectUri: 'http://localhost/callback',
        callerSubject: 'forged-service',
        userEntityRef: 'user:default/forged',
      })
      .expect(201);

    expect(service.startProviderConnection).toHaveBeenCalledWith({
      userEntityRef: 'user:default/luke',
      provider: 'github',
      scopes: ['repo'],
      redirectUri: 'http://localhost/callback',
      callerSubject: 'sonataflow',
    });
  });

  it('does not allow a plain browser user to self-declare a service caller', async () => {
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(userCredentials()),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      startProviderConnection: jest.fn(),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    await request(app)
      .post('/api/secure-token-storage/connections/github/start')
      .send({
        scopes: ['repo'],
        redirectUri: 'http://localhost/callback',
        callerSubject: 'forged-service',
      })
      .expect(400, { error: 'service-caller-required' });

    expect(service.startProviderConnection).not.toHaveBeenCalled();
  });

  it('starts a configured browser connection for the authenticated user', async () => {
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(userCredentials()),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      startProviderConnection: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        authorizationUrl: 'https://github.example/authorize',
        expiresAt: new Date('2026-09-07T12:10:00Z'),
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({
        httpAuth,
        service,
        userConnection: {
          callerSubject: 'sonataflow',
          redirectUri: 'http://localhost/callback',
          scopes: ['read:user'],
        },
      }),
    );

    await request(app)
      .post('/api/secure-token-storage/connections/github/start-user')
      .expect(201);

    expect(service.startProviderConnection).toHaveBeenCalledWith({
      userEntityRef: 'user:default/luke',
      provider: 'github',
      scopes: ['read:user'],
      redirectUri: 'http://localhost/callback',
      callerSubject: 'sonataflow',
    });
  });

  it('accepts the OAuth callback without trusting browser credentials', async () => {
    const httpAuth = {
      credentials: jest.fn(),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      completeProviderConnection: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        provider: 'github',
        userEntityRef: 'user:default/luke',
        scopes: ['repo'],
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    await request(app)
      .get('/api/secure-token-storage/connections/github/callback')
      .query({ state: 'one-time-state', code: 'one-time-code' })
      .expect(200, {
        status: 'connected',
        sessionId: 'session-1',
        provider: 'github',
        userEntityRef: 'user:default/luke',
        scopes: ['repo'],
      });

    expect(httpAuth.credentials).not.toHaveBeenCalled();
  });

  it('redirects a completed OAuth callback to the consent page when configured', async () => {
    const httpAuth = {
      credentials: jest.fn(),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      completeProviderConnection: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        provider: 'github',
        userEntityRef: 'user:default/luke',
        scopes: ['repo', 'read:user'],
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({
        httpAuth,
        service,
        consentUrl: 'http://localhost:3000/settings/auth-providers',
      }),
    );

    const response = await request(app)
      .get('/api/secure-token-storage/connections/github/callback')
      .query({ state: 'one-time-state', code: 'one-time-code' })
      .expect(303);

    const consentUrl = new URL(response.headers.location);
    expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(
      'http://localhost:3000/settings/auth-providers',
    );
    expect(consentUrl.searchParams.get('sessionId')).toBe('session-1');
    expect(consentUrl.searchParams.get('provider')).toBe('github');
    expect(consentUrl.searchParams.get('scopes')).toBe('repo,read:user');
  });

  it.each([
    ['connect-session-expired', { state: 'one-time-state', code: 'code' }],
    ['connect-session-consumed', { state: 'one-time-state', code: 'code' }],
    [
      'oauth-consent-denied',
      { state: 'one-time-state', error: 'access_denied' },
    ],
  ] as const)(
    'redirects %s OAuth callback errors to Settings for recovery',
    async (errorCode, callbackQuery) => {
      const httpAuth = {
        credentials: jest.fn(),
      } as unknown as jest.Mocked<HttpAuthService>;
      const service = {
        completeProviderConnection: jest
          .fn()
          .mockRejectedValue(new SecureTokenStorageError(errorCode)),
      } as unknown as jest.Mocked<SecureTokenStorageService>;
      const app = express();
      app.use(
        '/api/secure-token-storage',
        await createRouter({
          httpAuth,
          service,
          consentUrl: 'http://localhost:3000/settings/auth-providers',
        }),
      );

      const response = await request(app)
        .get('/api/secure-token-storage/connections/github/callback')
        .query(callbackQuery)
        .expect(303);

      const consentUrl = new URL(response.headers.location);
      expect(consentUrl.pathname).toBe('/settings/auth-providers');
      expect(consentUrl.searchParams.get('provider')).toBe('github');
      expect(consentUrl.searchParams.get('connectionError')).toBe(errorCode);
      expect(consentUrl.searchParams.has('sessionId')).toBe(false);
    },
  );

  it('uses the authenticated user for consent and does not accept a caller subject', async () => {
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(userCredentials()),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      approveProviderConnection: jest.fn().mockResolvedValue({
        grantId: 'grant-1',
        provider: 'github',
        scopes: ['repo'],
        expiresAt: new Date('2026-09-08T12:00:00Z'),
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    await request(app)
      .post('/api/secure-token-storage/connections/session-1/consent')
      .send({
        decision: 'approve',
        callerSubject: 'forged-service',
      })
      .expect(201);

    expect(service.approveProviderConnection).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userEntityRef: 'user:default/luke',
      expiresAt: undefined,
    });
  });

  it('lists only grants owned by the authenticated user', async () => {
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(userCredentials()),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      listGrants: jest.fn().mockResolvedValue([
        {
          grantId: 'grant-1',
          callerSubject: 'sonataflow',
          provider: 'github',
          scopes: ['repo'],
          createdAt: new Date('2026-09-07T12:00:00Z'),
          expiresAt: new Date('2026-09-08T12:00:00Z'),
        },
      ]),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    await request(app)
      .get('/api/secure-token-storage/grants')
      .query({ provider: 'github' })
      .expect(200);

    expect(service.listGrants).toHaveBeenCalledWith({
      userEntityRef: 'user:default/luke',
      provider: 'github',
    });
  });

  it('returns token-free provider status for the authenticated user', async () => {
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(userCredentials()),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      listProviders: jest.fn().mockResolvedValue([
        {
          provider: 'github',
          configured: true,
          connected: true,
          scopes: ['repo'],
          accessTokenExpiresAt: new Date('2026-09-07T13:00:00Z'),
          reconnectRequired: false,
          grants: [
            {
              grantId: 'grant-1',
              provider: 'github',
              scopes: ['repo'],
              createdAt: new Date('2026-09-07T12:00:00Z'),
              expiresAt: new Date('2026-09-08T12:00:00Z'),
            },
          ],
        },
      ]),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    const response = await request(app)
      .get('/api/secure-token-storage/providers')
      .expect(200);

    expect(response.body).toEqual([
      {
        provider: 'github',
        configured: true,
        connected: true,
        scopes: ['repo'],
        accessTokenExpiresAt: '2026-09-07T13:00:00.000Z',
        reconnectRequired: false,
        grants: [
          {
            grantId: 'grant-1',
            provider: 'github',
            scopes: ['repo'],
            createdAt: '2026-09-07T12:00:00.000Z',
            expiresAt: '2026-09-08T12:00:00.000Z',
          },
        ],
      },
    ]);
    expect(service.listProviders).toHaveBeenCalledWith({
      userEntityRef: 'user:default/luke',
    });
    expect(httpAuth.credentials).toHaveBeenCalledWith(expect.anything(), {
      allow: ['user'],
    });
    expect(response.body[0]).not.toHaveProperty('accessToken');
    expect(response.body[0]).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(response.body)).not.toContain(
      'provider-access-token',
    );
    expect(JSON.stringify(response.body)).not.toContain(
      'provider-refresh-token',
    );
  });

  it('disconnects a provider for the authenticated user', async () => {
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(userCredentials()),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      disconnectProvider: jest.fn().mockResolvedValue({
        provider: 'github',
        revokedGrantCount: 2,
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    await request(app)
      .post('/api/secure-token-storage/connections/github/disconnect')
      .expect(200, { provider: 'github', revokedGrantCount: 2 });

    expect(service.disconnectProvider).toHaveBeenCalledWith({
      userEntityRef: 'user:default/luke',
      provider: 'github',
    });
  });

  it('refreshes a grant for the authenticated user', async () => {
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(userCredentials()),
    } as unknown as jest.Mocked<HttpAuthService>;
    const service = {
      refreshGrant: jest.fn().mockResolvedValue({
        grantId: 'grant-1',
        callerSubject: 'sonataflow',
        provider: 'github',
        scopes: ['repo'],
        createdAt: new Date('2026-09-07T12:00:00Z'),
        expiresAt: new Date('2026-10-07T12:00:00Z'),
      }),
    } as unknown as jest.Mocked<SecureTokenStorageService>;
    const app = express();
    app.use(
      '/api/secure-token-storage',
      await createRouter({ httpAuth, service }),
    );

    await request(app)
      .post('/api/secure-token-storage/grants/grant-1/refresh')
      .expect(200, {
        grantId: 'grant-1',
        callerSubject: 'sonataflow',
        provider: 'github',
        scopes: ['repo'],
        createdAt: '2026-09-07T12:00:00.000Z',
        expiresAt: '2026-10-07T12:00:00.000Z',
      });

    expect(service.refreshGrant).toHaveBeenCalledWith({
      grantId: 'grant-1',
      userEntityRef: 'user:default/luke',
    });
  });
});
