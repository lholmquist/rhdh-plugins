/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { MicrosoftProviderTokenAdapter } from './adapter';

const now = () => new Date('2026-10-02T12:00:00.000Z');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function formBody(call: [RequestInfo | URL, RequestInit | undefined]) {
  return new URLSearchParams(String(call[1]?.body));
}

describe('MicrosoftProviderTokenAdapter', () => {
  const options = {
    clientId: 'microsoft-client',
    clientSecret: 'microsoft-secret',
    tenant: 'contoso-tenant',
    now,
  };

  it('uses tenant-specific PKCE authorization and requests offline access', () => {
    const adapter = new MicrosoftProviderTokenAdapter(options);
    const url = new URL(
      adapter.createAuthorizationUrl({
        state: 'opaque-state',
        codeChallenge: 'pkce-challenge',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['User.Read'],
      }),
    );

    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/contoso-tenant/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('scope')).toBe('User.Read offline_access');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('exchanges a code, parses scoped expiry, and refreshes with token rotation', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl
      .mockResolvedValueOnce(
        response({
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          expires_in: 3600,
          scope: 'User.Read offline_access',
        }),
      )
      .mockResolvedValueOnce(
        response({
          access_token: 'fresh-access',
          refresh_token: 'rotated-refresh',
          expires_in: 1800,
          scope: 'User.Read',
        }),
      );
    const adapter = new MicrosoftProviderTokenAdapter({
      ...options,
      fetchImpl,
    });

    await expect(
      adapter.exchangeAuthorizationCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['User.Read'],
      }),
    ).resolves.toEqual({
      accessToken: 'access-secret',
      accessTokenExpiresAt: new Date('2026-10-02T13:00:00.000Z'),
      refreshToken: 'refresh-secret',
      scopes: ['User.Read'],
    });
    expect(formBody(fetchImpl.mock.calls[0] as never).get('scope')).toBe(
      'User.Read offline_access',
    );

    await expect(
      adapter.refreshAccessToken({
        refreshToken: 'refresh-secret',
        scopes: ['User.Read'],
      }),
    ).resolves.toEqual({
      accessToken: 'fresh-access',
      accessTokenExpiresAt: new Date('2026-10-02T12:30:00.000Z'),
      refreshToken: 'rotated-refresh',
      scopes: ['User.Read'],
    });
    expect(formBody(fetchImpl.mock.calls[1] as never)).toEqual(
      new URLSearchParams({
        client_id: 'microsoft-client',
        client_secret: 'microsoft-secret',
        grant_type: 'refresh_token',
        refresh_token: 'refresh-secret',
        scope: 'User.Read offline_access',
      }),
    );
  });

  it('classifies invalid_grant as non-retryable and hides provider error text', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl.mockResolvedValue(
      response(
        {
          error: 'invalid_grant',
          error_description: 'sensitive-provider-detail',
        },
        400,
      ),
    );
    const adapter = new MicrosoftProviderTokenAdapter({
      ...options,
      fetchImpl,
    });

    let caught: unknown;
    try {
      await adapter.refreshAccessToken({
        refreshToken: 'expired-refresh',
        scopes: ['User.Read'],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'token-refresh-rejected',
      retryable: false,
    });
    expect(String(caught)).not.toContain('sensitive-provider-detail');
  });

  it('does not claim requested scopes when the provider omits scope confirmation', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl.mockResolvedValue(
      response({
        access_token: 'fresh-access',
        refresh_token: 'rotated-refresh',
        expires_in: 1800,
      }),
    );
    const adapter = new MicrosoftProviderTokenAdapter({
      ...options,
      fetchImpl,
    });

    await expect(
      adapter.refreshAccessToken({
        refreshToken: 'refresh-secret',
        scopes: ['User.Read'],
      }),
    ).resolves.toMatchObject({ scopes: undefined });
  });

  it('classifies temporary provider failures as retryable', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl.mockResolvedValue(
      new Response('upstream unavailable', { status: 503 }),
    );
    const adapter = new MicrosoftProviderTokenAdapter({
      ...options,
      fetchImpl,
    });

    await expect(
      adapter.refreshAccessToken({
        refreshToken: 'refresh-token',
        scopes: ['User.Read'],
      }),
    ).rejects.toMatchObject({
      code: 'provider-unavailable',
      retryable: true,
    });
  });
});
