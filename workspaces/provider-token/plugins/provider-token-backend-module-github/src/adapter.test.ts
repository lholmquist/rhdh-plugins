/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { ProviderTokenError } from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import { GitHubProviderTokenAdapter } from './adapter';

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

describe('GitHubProviderTokenAdapter', () => {
  const options = {
    clientId: 'github-client',
    clientSecret: 'github-secret',
    now,
  };

  it('creates an authorization URL requesting expiring offline credentials', () => {
    const adapter = new GitHubProviderTokenAdapter(options);
    const url = new URL(
      adapter.createAuthorizationUrl({
        state: 'opaque-state',
        codeChallenge: 'pkce-challenge',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['read:user'],
      }),
    );

    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(url.searchParams.get('scope')).toBe('read:user offline_access');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });

  it('exchanges a code and parses comma-delimited scopes and both expirations', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl.mockResolvedValue(
      response({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_in: 28800,
        refresh_token_expires_in: 15552000,
        scope: 'read:user,user:email',
      }),
    );
    const adapter = new GitHubProviderTokenAdapter({ ...options, fetchImpl });

    await expect(
      adapter.exchangeAuthorizationCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['read:user'],
      }),
    ).resolves.toEqual({
      accessToken: 'access-secret',
      accessTokenExpiresAt: new Date('2026-10-02T20:00:00.000Z'),
      refreshToken: 'refresh-secret',
      refreshTokenExpiresAt: new Date('2027-03-31T12:00:00.000Z'),
      scopes: ['read:user', 'user:email'],
    });
    expect(formBody(fetchImpl.mock.calls[0] as never)).toMatchObject(
      new URLSearchParams({
        client_id: 'github-client',
        client_secret: 'github-secret',
        code: 'auth-code',
        code_verifier: 'verifier',
        redirect_uri: 'https://rhdh.example/callback',
      }),
    );
  });

  it('rotates the refresh token and classifies rejected and transient refreshes safely', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl
      .mockResolvedValueOnce(
        response({
          access_token: 'fresh-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          refresh_token_expires_in: 86400,
        }),
      )
      .mockResolvedValueOnce(response({ error: 'bad_refresh_token' }, 400))
      .mockResolvedValueOnce(
        new Response('upstream unavailable', { status: 503 }),
      );
    const adapter = new GitHubProviderTokenAdapter({ ...options, fetchImpl });

    await expect(
      adapter.refreshAccessToken({
        refreshToken: 'old-refresh',
        scopes: ['read:user'],
      }),
    ).resolves.toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'rotated-refresh',
      accessTokenExpiresAt: new Date('2026-10-02T13:00:00.000Z'),
      scopes: undefined,
    });
    expect(formBody(fetchImpl.mock.calls[0] as never).has('scope')).toBe(false);

    await expect(
      adapter.refreshAccessToken({
        refreshToken: 'bad-refresh',
        scopes: ['read:user'],
      }),
    ).rejects.toMatchObject<Partial<ProviderTokenError>>({
      code: 'token-refresh-rejected',
      retryable: false,
    });
    await expect(
      adapter.refreshAccessToken({
        refreshToken: 'temporary-failure',
        scopes: ['read:user'],
      }),
    ).rejects.toMatchObject<Partial<ProviderTokenError>>({
      code: 'provider-unavailable',
      retryable: true,
    });
    expect(JSON.stringify(fetchImpl.mock.results)).not.toContain(
      'github-secret',
    );
  });

  it('revokes the OAuth app grant with a freshly exchanged short-lived token', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl
      .mockResolvedValueOnce(
        response({
          access_token: 'short-lived-revocation-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
          refresh_token_expires_in: 86400,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const adapter = new GitHubProviderTokenAdapter({ ...options, fetchImpl });

    await expect(
      adapter.revokeRefreshToken!({ refreshToken: 'stored-refresh-token' }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, request] = fetchImpl.mock.calls[1];
    expect(String(url)).toBe(
      'https://api.github.com/applications/github-client/grant',
    );
    expect(request?.method).toBe('DELETE');
    expect(request?.headers).toMatchObject({
      accept: 'application/vnd.github+json',
      authorization: `Basic ${Buffer.from(
        'github-client:github-secret',
      ).toString('base64')}`,
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      access_token: 'short-lived-revocation-token',
    });
  });

  it('rejects non-refreshable credentials and does not expose provider diagnostics', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchImpl.mockResolvedValue(
      response({
        access_token: 'access-secret',
        error_description: 'sensitive-provider-detail',
        expires_in: 3600,
      }),
    );
    const adapter = new GitHubProviderTokenAdapter({ ...options, fetchImpl });

    let caught: unknown;
    try {
      await adapter.exchangeAuthorizationCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['read:user'],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'invalid-provider-response' });
    expect(String(caught)).not.toContain('sensitive-provider-detail');
  });

  it('does not include provider response details when code exchange is rejected', async () => {
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
    const adapter = new GitHubProviderTokenAdapter({ ...options, fetchImpl });

    let caught: unknown;
    try {
      await adapter.exchangeAuthorizationCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['read:user'],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'invalid-provider-response' });
    expect(String(caught)).not.toContain('sensitive-provider-detail');
  });
});
