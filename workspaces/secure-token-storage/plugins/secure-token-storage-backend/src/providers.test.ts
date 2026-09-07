/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { GitHubOAuthAdapter, MicrosoftOAuthAdapter } from './providers';

const now = () => new Date('2026-09-07T12:00:00Z');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyFromFetch(call: [RequestInfo | URL, RequestInit | undefined]) {
  return new URLSearchParams(String(call[1]?.body));
}

describe('GitHubOAuthAdapter', () => {
  it('builds a PKCE authorization URL and exchanges JSON token responses', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      response({
        access_token: 'github-access',
        refresh_token: 'github-refresh',
        expires_in: 28800,
        scope: 'repo,gist',
      }),
    );
    const fetchImpl = fetchMock as typeof fetch;
    const adapter = new GitHubOAuthAdapter({
      clientId: 'github-client',
      clientSecret: 'github-secret',
      fetchImpl,
      now,
    });

    const authorizationUrl = new URL(
      adapter.createAuthorizationUrl({
        state: 'state-value',
        codeChallenge: 'challenge-value',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['repo', 'gist'],
      }),
    );
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(authorizationUrl.searchParams.get('client_id')).toBe(
      'github-client',
    );
    expect(authorizationUrl.searchParams.get('scope')).toBe(
      'repo gist offline_access',
    );
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorizationUrl.toString()).not.toContain('github-secret');

    await expect(
      adapter.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: 'code-verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['repo', 'gist'],
      }),
    ).resolves.toEqual({
      accessToken: 'github-access',
      refreshToken: 'github-refresh',
      expiresAt: new Date('2026-09-07T20:00:00Z'),
      scopes: ['repo', 'gist'],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(bodyFromFetch(fetchMock.mock.calls[0] as never)).toEqual(
      new URLSearchParams({
        client_id: 'github-client',
        client_secret: 'github-secret',
        code: 'authorization-code',
        redirect_uri: 'https://rhdh.example/callback',
        code_verifier: 'code-verifier',
      }),
    );
  });

  it('rotates GitHub refresh tokens without sending scopes to the refresh request', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      response({
        access_token: 'github-fresh-access',
        refresh_token: 'github-rotated-refresh',
        expires_in: 28800,
      }),
    );
    const fetchImpl = fetchMock as typeof fetch;
    const adapter = new GitHubOAuthAdapter({
      clientId: 'github-client',
      clientSecret: 'github-secret',
      fetchImpl,
      now,
    });

    await expect(
      adapter.refresh({
        provider: 'github',
        refreshToken: 'github-refresh',
        scopes: ['repo'],
      }),
    ).resolves.toEqual({
      accessToken: 'github-fresh-access',
      refreshToken: 'github-rotated-refresh',
      expiresAt: new Date('2026-09-07T20:00:00Z'),
    });
    expect(bodyFromFetch(fetchMock.mock.calls[0] as never)).toEqual(
      new URLSearchParams({
        client_id: 'github-client',
        client_secret: 'github-secret',
        grant_type: 'refresh_token',
        refresh_token: 'github-refresh',
      }),
    );
  });
});

describe('MicrosoftOAuthAdapter', () => {
  it('uses the configured tenant, PKCE, and offline access for authorization', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      response({
        access_token: 'microsoft-access',
        refresh_token: 'microsoft-refresh',
        expires_in: 3600,
        scope: 'User.Read offline_access',
      }),
    );
    const fetchImpl = fetchMock as typeof fetch;
    const adapter = new MicrosoftOAuthAdapter({
      clientId: 'microsoft-client',
      clientSecret: 'microsoft-secret',
      tenant: 'contoso-tenant',
      fetchImpl,
      now,
    });

    const authorizationUrl = new URL(
      adapter.createAuthorizationUrl({
        state: 'state-value',
        codeChallenge: 'challenge-value',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['User.Read'],
      }),
    );
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://login.microsoftonline.com/contoso-tenant/oauth2/v2.0/authorize',
    );
    expect(authorizationUrl.searchParams.get('scope')).toBe(
      'User.Read offline_access',
    );
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );

    await expect(
      adapter.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: 'code-verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['User.Read'],
      }),
    ).resolves.toEqual({
      accessToken: 'microsoft-access',
      refreshToken: 'microsoft-refresh',
      expiresAt: new Date('2026-09-07T13:00:00Z'),
      scopes: ['User.Read'],
    });
    expect(bodyFromFetch(fetchMock.mock.calls[0] as never)).toEqual(
      new URLSearchParams({
        client_id: 'microsoft-client',
        client_secret: 'microsoft-secret',
        code: 'authorization-code',
        code_verifier: 'code-verifier',
        grant_type: 'authorization_code',
        redirect_uri: 'https://rhdh.example/callback',
        scope: 'User.Read offline_access',
      }),
    );
  });

  it('fails with a secret-safe error when the token endpoint rejects the request', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      response(
        {
          error: 'invalid_grant',
          error_description: 'contains-provider-diagnostics',
        },
        400,
      ),
    );
    const fetchImpl = fetchMock as typeof fetch;
    const adapter = new MicrosoftOAuthAdapter({
      clientId: 'microsoft-client',
      clientSecret: 'microsoft-secret',
      tenant: 'common',
      fetchImpl,
      now,
    });

    await expect(
      adapter.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: 'code-verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['User.Read'],
      }),
    ).rejects.toThrow('OAuth provider request failed');
    await expect(
      adapter.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: 'code-verifier',
        redirectUri: 'https://rhdh.example/callback',
        scopes: ['User.Read'],
      }),
    ).rejects.not.toThrow('contains-provider-diagnostics');
  });
});
