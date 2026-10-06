/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type {
  BackstageCredentials,
  HttpAuthService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { Request, Response } from 'express';
import { ProviderTokenError } from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import {
  providerTokenGrantReadPermission,
  providerTokenGrantRevokePermission,
  providerTokenConnectPermission,
  providerTokenProviderDisconnectPermission,
  providerTokenTokenIssuePermission,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type { ProviderTokenOperations } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { createHandlers } from './router';

describe('provider-token HTTP policy', () => {
  const grants = [
    {
      grantId: 'grant-1',
      provider: 'github',
      clientId: 'workflow-service',
      callerSubject: 'sonataflow',
      scopes: ['read:user'],
      createdAt: new Date('2026-10-02T11:00:00.000Z'),
      expiresAt: new Date('2026-10-03T11:00:00.000Z'),
    },
  ];
  const service = {
    listGrants: jest.fn().mockResolvedValue(grants),
    listConnections: jest.fn().mockResolvedValue([
      {
        provider: 'github',
        scopes: ['read:user'],
        connectedAt: new Date('2026-10-02T11:00:00.000Z'),
      },
    ]),
    getConnectOptions: jest.fn().mockReturnValue({
      providers: ['github'],
      clients: [
        {
          id: 'orchestrator',
          title: 'Orchestrator',
          purpose: 'Run queued workflows.',
          providerScopes: { github: ['read:user'] },
        },
      ],
    }),
    startConnect: jest.fn().mockResolvedValue({
      sessionId: '5d0716b4-fdd9-4ac4-8fc3-bd73d84d24fb',
      authorizationUrl: 'https://github.example/authorize?state=opaque',
      expiresAt: new Date('2026-10-03T12:10:00.000Z'),
    }),
    getConnectSession: jest.fn().mockResolvedValue({
      sessionId: '5d0716b4-fdd9-4ac4-8fc3-bd73d84d24fb',
      clientId: 'workflow-service',
      clientTitle: 'Workflow Service',
      purpose: 'Run background workflows',
      provider: 'github',
      scopes: ['read:user'],
      expiresAt: new Date('2026-10-03T12:10:00.000Z'),
      consentStatus: 'pending',
    }),
    decideConnectSession: jest.fn().mockResolvedValue({
      consentStatus: 'approved',
      grantId: 'opaque-grant',
    }),
    completeConnectCallback: jest.fn().mockResolvedValue({
      redirectUrl: 'http://localhost:3000/provider-token?sessionId=opaque',
    }),
    disconnectProvider: jest.fn().mockResolvedValue(undefined),
    revokeGrant: jest.fn().mockResolvedValue(undefined),
    issueAccessToken: jest.fn().mockResolvedValue({
      token: 'secret-provider-token',
      expiresAt: new Date('2026-10-02T12:10:00.000Z'),
      scopes: ['read:user'],
      userEntityRef: 'user:default/alice',
    }),
  } as unknown as jest.Mocked<ProviderTokenOperations>;
  const httpAuth = {
    credentials: jest.fn(
      async (
        request: Request,
        options: { allow: Array<'user' | 'service'> },
      ) => {
        const type = request.headers['x-test-principal'];
        if (!options.allow.includes(type as 'user' | 'service')) {
          throw new Error('principal type not allowed');
        }
        if (type === 'user') {
          return {
            principal: {
              type: 'user',
              userEntityRef: 'user:default/alice',
            },
          } as BackstageCredentials;
        }
        return {
          principal: { type: 'service', subject: 'sonataflow' },
        } as BackstageCredentials;
      },
    ),
  } as unknown as jest.Mocked<HttpAuthService>;
  const permissions = {
    authorize: jest.fn().mockResolvedValue([{ result: AuthorizeResult.ALLOW }]),
  } as unknown as jest.Mocked<PermissionsService>;
  const handlers = createHandlers({ httpAuth, permissions, service });

  const request = (input: {
    principal: 'user' | 'service';
    params?: Record<string, string>;
    body?: unknown;
    query?: Record<string, unknown>;
  }) =>
    ({
      headers: { 'x-test-principal': input.principal },
      params: input.params ?? {},
      body: input.body,
      query: input.query ?? {},
    } as unknown as Request);

  const response = () => {
    const result = {
      statusCode: 200,
      body: undefined as unknown,
      headers: {} as Record<string, string>,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        this.headers[name] = value;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
      end: jest.fn(),
      redirect: jest.fn(function redirect(
        this: { statusCode: number },
        status: number,
      ) {
        this.statusCode = status;
        return this;
      }),
    };
    return result as unknown as Response & typeof result;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (permissions.authorize as jest.Mock).mockResolvedValue([
      { result: AuthorizeResult.ALLOW },
    ]);
  });

  it('lists only the authenticated user’s grants after grant-read authorization', async () => {
    const result = response();
    await handlers.listGrants(request({ principal: 'user' }), result);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(grants);
    expect(service.listGrants).toHaveBeenCalledWith('user:default/alice');
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: providerTokenGrantReadPermission }],
      expect.objectContaining({ credentials: expect.any(Object) }),
    );
  });

  it('revokes a grant only for the authenticated owner', async () => {
    const result = response();
    await handlers.revokeGrant(
      request({ principal: 'user', params: { grantId: 'grant-1' } }),
      result,
    );

    expect(result.statusCode).toBe(204);
    expect(service.revokeGrant).toHaveBeenCalledWith(
      'grant-1',
      'user:default/alice',
    );
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: providerTokenGrantRevokePermission }],
      expect.objectContaining({ credentials: expect.any(Object) }),
    );
  });

  it('starts a provider connection for the authenticated user only after permission check', async () => {
    const result = response();
    await handlers.startConnect(
      request({
        principal: 'user',
        body: {
          provider: 'github',
          clientId: 'workflow-service',
          returnUrl: 'http://localhost:3000/provider-token/consent',
        },
      }),
      result,
    );

    expect(result.statusCode).toBe(201);
    expect(service.startConnect).toHaveBeenCalledWith({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      clientId: 'workflow-service',
      returnUrl: 'http://localhost:3000/provider-token/consent',
    });
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: providerTokenConnectPermission }],
      expect.objectContaining({ credentials: expect.any(Object) }),
    );
  });

  it('rejects browser-supplied OAuth scopes so clients cannot widen config policy', async () => {
    const result = response();
    await handlers.startConnect(
      request({
        principal: 'user',
        body: {
          provider: 'github',
          clientId: 'workflow-service',
          scopes: ['read:user', 'admin:org'],
          returnUrl: 'http://localhost:3000/provider-token/consent',
        },
      }),
      result,
    );

    expect(result.statusCode).toBe(400);
    expect(service.startConnect).not.toHaveBeenCalled();
  });

  it('keeps the OAuth callback free of raw provider details and redirects only to the service result', async () => {
    const result = response();
    await handlers.connectCallback(
      request({
        principal: 'user',
        query: {
          state: 'random-state-value-that-is-long-enough-to-be-valid',
          code: 'oauth-secret-code',
        },
      }),
      result,
    );

    expect(service.completeConnectCallback).toHaveBeenCalledWith({
      state: 'random-state-value-that-is-long-enough-to-be-valid',
      code: 'oauth-secret-code',
      providerError: undefined,
    });
    expect(result.redirect).toHaveBeenCalledWith(
      303,
      'http://localhost:3000/provider-token?sessionId=opaque',
    );
  });

  it('loads consent data using only the verified user identity', async () => {
    const result = response();
    await handlers.getConnectSession(
      request({
        principal: 'user',
        params: { sessionId: '5d0716b4-fdd9-4ac4-8fc3-bd73d84d24fb' },
      }),
      result,
    );

    expect(service.getConnectSession).toHaveBeenCalledWith(
      '5d0716b4-fdd9-4ac4-8fc3-bd73d84d24fb',
      'user:default/alice',
    );
    expect(result.body).toMatchObject({
      clientTitle: 'Workflow Service',
      purpose: 'Run background workflows',
      scopes: ['read:user'],
    });
    expect(JSON.stringify(result.body)).not.toContain('provider-access-token');
  });

  it('redacts callback errors instead of returning OAuth diagnostics', async () => {
    service.completeConnectCallback.mockRejectedValueOnce(
      new ProviderTokenError(
        'invalid-oauth-state',
        'sensitive callback code and provider response',
      ),
    );
    const result = response();
    await handlers.connectCallback(
      request({
        principal: 'user',
        query: { state: 'random-state-value-that-is-long-enough-to-be-valid' },
      }),
      result,
    );

    expect(result.statusCode).toBe(400);
    expect(JSON.stringify(result.body)).toContain('invalid-oauth-state');
    expect(JSON.stringify(result.body)).not.toContain('sensitive callback');
  });

  it('disconnects only after the user-scoped permission check', async () => {
    const result = response();
    await handlers.disconnectProvider(
      request({ principal: 'user', params: { providerId: 'github' } }),
      result,
    );

    expect(result.statusCode).toBe(204);
    expect(service.disconnectProvider).toHaveBeenCalledWith(
      'user:default/alice',
      'github',
    );
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: providerTokenProviderDisconnectPermission }],
      expect.objectContaining({ credentials: expect.any(Object) }),
    );
  });

  it('issues a token only to service credentials after permission authorization', async () => {
    const result = response();
    await handlers.issueAccessToken(
      request({
        principal: 'service',
        body: {
          grantId: 'grant-1',
          provider: 'github',
          context: 'workflow execution',
        },
      }),
      result,
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ accessToken: 'secret-provider-token' });
    expect(result.body).not.toHaveProperty('token');
    expect(result.body).not.toHaveProperty('userEntityRef');
    expect(service.issueAccessToken).toHaveBeenCalledWith({
      grantId: 'grant-1',
      callerSubject: 'sonataflow',
      provider: 'github',
      context: 'workflow execution',
    });
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: providerTokenTokenIssuePermission }],
      expect.objectContaining({ credentials: expect.any(Object) }),
    );
  });

  it('resolves only one active owner grant for an authenticated service', async () => {
    service.listGrants.mockResolvedValueOnce([
      {
        ...grants[0],
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const result = response();

    await handlers.resolveProviderTokenGrant(
      request({
        principal: 'service',
        body: {
          userEntityRef: 'user:default/alice',
          provider: 'github',
        },
      }),
      result,
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      grant: { grantId: 'grant-1', provider: 'github' },
    });
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(service.listGrants).toHaveBeenCalledWith('user:default/alice');
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: providerTokenGrantReadPermission }],
      expect.objectContaining({ credentials: expect.any(Object) }),
    );
  });

  it('does not resolve ambiguous grants across service subjects', async () => {
    service.listGrants.mockResolvedValueOnce([
      {
        ...grants[0],
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        ...grants[0],
        grantId: 'grant-other-caller',
        callerSubject: 'another-workflow',
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const result = response();

    await handlers.resolveProviderTokenGrant(
      request({
        principal: 'service',
        body: { userEntityRef: 'user:default/alice', provider: 'github' },
      }),
      result,
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ grant: null });
  });

  it('rejects a malformed provider assertion without issuing a token', async () => {
    const result = response();

    await handlers.issueAccessToken(
      request({
        principal: 'service',
        body: { grantId: 'grant-1', provider: 'GitHub' },
      }),
      result,
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({ error: { code: 'invalid-request' } });
    expect(service.issueAccessToken).not.toHaveBeenCalled();
  });

  it('denies conditional permission results and does not issue a token', async () => {
    (permissions.authorize as jest.Mock).mockResolvedValue([
      { result: AuthorizeResult.CONDITIONAL },
    ]);
    const result = response();

    await handlers.issueAccessToken(
      request({ principal: 'service', body: { grantId: 'grant-1' } }),
      result,
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({
      error: {
        name: 'ProviderTokenError',
        code: 'permission-denied',
        retryable: false,
      },
    });
    expect(service.issueAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an issue request that attempts to provide the grant owner', async () => {
    const result = response();

    await handlers.issueAccessToken(
      request({
        principal: 'service',
        body: { grantId: 'grant-1', userEntityRef: 'user:default/bob' },
      }),
      result,
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: { code: 'invalid-request' },
    });
    expect(service.issueAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a user principal at the service-only token endpoint', async () => {
    const result = response();

    await handlers.issueAccessToken(
      request({ principal: 'user', body: { grantId: 'grant-1' } }),
      result,
    );

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      error: { code: 'authentication-required' },
    });
    expect(service.issueAccessToken).not.toHaveBeenCalled();
  });

  it('returns stable provider errors without leaking their messages', async () => {
    service.issueAccessToken.mockRejectedValueOnce(
      new ProviderTokenError('grant-revoked', 'secret provider diagnostics'),
    );
    const result = response();

    await handlers.issueAccessToken(
      request({ principal: 'service', body: { grantId: 'grant-1' } }),
      result,
    );

    expect(result.statusCode).toBe(403);
    expect(JSON.stringify(result.body)).toContain('grant-revoked');
    expect(JSON.stringify(result.body)).not.toContain(
      'secret provider diagnostics',
    );
  });
});
