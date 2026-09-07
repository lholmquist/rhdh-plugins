/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { ProviderOAuthAdapter, ProviderTokenRefresher } from './service';

type OAuthTokenResponse = Record<string, unknown>;

interface OAuthProviderOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface GitHubOAuthAdapterOptions extends OAuthProviderOptions {
  authorizationUrl?: string;
  tokenUrl?: string;
}

export interface MicrosoftOAuthAdapterOptions extends OAuthProviderOptions {
  tenant: string;
  authorizationUrl?: string;
  tokenUrl?: string;
}

class OAuthProviderError extends Error {
  constructor() {
    super('OAuth provider request failed');
    this.name = 'OAuthProviderError';
  }
}

function withOfflineAccess(scopes: string[]): string[] {
  return scopes.includes('offline_access')
    ? [...scopes]
    : [...scopes, 'offline_access'];
}

function getString(
  response: OAuthTokenResponse,
  key: string,
): string | undefined {
  const value = response[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getSeconds(
  response: OAuthTokenResponse,
  key: string,
): number | undefined {
  const value = response[key];
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function expiresAt(
  response: OAuthTokenResponse,
  now: () => Date,
): Date | undefined {
  const seconds = getSeconds(response, 'expires_in');
  return seconds === undefined
    ? undefined
    : new Date(now().getTime() + seconds * 1000);
}

function parseScopes(
  response: OAuthTokenResponse,
  fallback: string[],
  separator: string,
): string[] {
  const raw = getString(response, 'scope');
  if (!raw) return [...fallback];
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const scopes = decoded
    .split(separator)
    .map(scope => scope.trim())
    .filter(Boolean)
    .filter(scope => scope !== 'offline_access');
  return scopes.length > 0 ? scopes : [...fallback];
}

async function readTokenResponse(
  response: Response,
): Promise<OAuthTokenResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OAuthProviderError();
  }
  if (
    !response.ok ||
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new OAuthProviderError();
  }
  return body as OAuthTokenResponse;
}

function requireAccessToken(response: OAuthTokenResponse): string {
  const accessToken = getString(response, 'access_token');
  if (!accessToken) throw new OAuthProviderError();
  return accessToken;
}

function formRequest(body: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  };
}

export class GitHubOAuthAdapter
  implements ProviderOAuthAdapter, ProviderTokenRefresher
{
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly authorizationUrl: string;
  private readonly tokenUrl: string;

  constructor(private readonly options: GitHubOAuthAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.authorizationUrl =
      options.authorizationUrl ?? 'https://github.com/login/oauth/authorize';
    this.tokenUrl =
      options.tokenUrl ?? 'https://github.com/login/oauth/access_token';
  }

  createAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
  }): string {
    const url = new URL(this.authorizationUrl);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', withOfflineAccess(input.scopes).join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    scopes: string[];
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string[];
  }> {
    const response = await this.fetchImpl(
      this.tokenUrl,
      formRequest({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    );
    const tokenResponse = await readTokenResponse(response);
    return {
      accessToken: requireAccessToken(tokenResponse),
      refreshToken: getString(tokenResponse, 'refresh_token'),
      expiresAt: expiresAt(tokenResponse, this.now),
      scopes: parseScopes(tokenResponse, input.scopes, ','),
    };
  }

  async refresh(input: {
    provider: string;
    refreshToken: string;
    scopes: string[];
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    void input.provider;
    void input.scopes;
    const response = await this.fetchImpl(
      this.tokenUrl,
      formRequest({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      }),
    );
    const tokenResponse = await readTokenResponse(response);
    return {
      accessToken: requireAccessToken(tokenResponse),
      refreshToken: getString(tokenResponse, 'refresh_token'),
      expiresAt: expiresAt(tokenResponse, this.now),
    };
  }
}

export class MicrosoftOAuthAdapter
  implements ProviderOAuthAdapter, ProviderTokenRefresher
{
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly authorizationUrl: string;
  private readonly tokenUrl: string;

  constructor(private readonly options: MicrosoftOAuthAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.authorizationUrl =
      options.authorizationUrl ??
      `https://login.microsoftonline.com/${encodeURIComponent(
        options.tenant,
      )}/oauth2/v2.0/authorize`;
    this.tokenUrl =
      options.tokenUrl ??
      `https://login.microsoftonline.com/${encodeURIComponent(
        options.tenant,
      )}/oauth2/v2.0/token`;
  }

  createAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
  }): string {
    const url = new URL(this.authorizationUrl);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', withOfflineAccess(input.scopes).join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    scopes: string[];
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string[];
  }> {
    const response = await this.fetchImpl(
      this.tokenUrl,
      formRequest({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: input.redirectUri,
        scope: withOfflineAccess(input.scopes).join(' '),
      }),
    );
    const tokenResponse = await readTokenResponse(response);
    return {
      accessToken: requireAccessToken(tokenResponse),
      refreshToken: getString(tokenResponse, 'refresh_token'),
      expiresAt: expiresAt(tokenResponse, this.now),
      scopes: parseScopes(tokenResponse, input.scopes, ' ').filter(scope =>
        input.scopes.includes(scope),
      ),
    };
  }

  async refresh(input: {
    provider: string;
    refreshToken: string;
    scopes: string[];
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    void input.provider;
    const response = await this.fetchImpl(
      this.tokenUrl,
      formRequest({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        scope: withOfflineAccess(input.scopes).join(' '),
      }),
    );
    const tokenResponse = await readTokenResponse(response);
    return {
      accessToken: requireAccessToken(tokenResponse),
      refreshToken: getString(tokenResponse, 'refresh_token'),
      expiresAt: expiresAt(tokenResponse, this.now),
    };
  }
}
