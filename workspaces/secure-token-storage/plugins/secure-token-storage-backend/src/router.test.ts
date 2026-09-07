/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import express from 'express';
import request from 'supertest';
import type {
  BackstageCredentials,
  BackstageUserPrincipal,
  HttpAuthService,
} from '@backstage/backend-plugin-api';
import type { SecureTokenStorageService } from '@red-hat-developer-hub/backstage-plugin-secure-token-storage-node';
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

describe('secure token storage router', () => {
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
});
