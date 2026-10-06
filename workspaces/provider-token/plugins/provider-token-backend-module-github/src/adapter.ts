/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  ProviderTokenError,
  providerTokenErrorCodes,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type {
  ProviderTokenAdapter,
  ProviderTokenRefreshResult,
  ProviderTokenSet,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-node';

type TokenResponse = Record<string, unknown>;

export interface GitHubProviderTokenAdapterOptions {
  clientId: string;
  clientSecret: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  revocationUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const withOfflineAccess = (scopes: string[]) =>
  scopes.includes('offline_access')
    ? [...scopes]
    : [...scopes, 'offline_access'];

const stringField = (body: TokenResponse, key: string): string | undefined =>
  typeof body[key] === 'string' && body[key]
    ? (body[key] as string)
    : undefined;

const secondsField = (body: TokenResponse, key: string): number | undefined => {
  const value = body[key];
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

const parseScopes = (body: TokenResponse, fallback: string[]): string[] => {
  const raw = stringField(body, 'scope');
  if (!raw) return fallback.filter(scope => scope !== 'offline_access');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Scope syntax remains provider-delimited when it is not URI-encoded.
  }
  const scopes = decoded
    .split(',')
    .map(scope => scope.trim())
    .filter(scope => scope && scope !== 'offline_access');
  return scopes.length ? scopes : fallback.filter(s => s !== 'offline_access');
};

const safeProviderFailure = (
  response: Response,
  body: unknown,
  refreshing: boolean,
): ProviderTokenError => {
  const errorCode =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as TokenResponse).error
      : undefined;
  if (
    refreshing &&
    (errorCode === 'bad_refresh_token' || errorCode === 'invalid_grant')
  ) {
    return new ProviderTokenError(
      providerTokenErrorCodes.tokenRefreshRejected,
      'The GitHub refresh token was rejected; reconnect the provider.',
    );
  }
  if (response.status === 429 || response.status >= 500) {
    return new ProviderTokenError(
      providerTokenErrorCodes.providerUnavailable,
      'GitHub is temporarily unavailable.',
      { retryable: true },
    );
  }
  return new ProviderTokenError(
    providerTokenErrorCodes.invalidProviderResponse,
    'GitHub returned an invalid OAuth response.',
  );
};

const tokenRequest = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams(fields),
});

/** GitHub OAuth App adapter requiring expiring, refreshable user credentials. */
export class GitHubProviderTokenAdapter implements ProviderTokenAdapter {
  readonly id = 'github';
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly authorizationUrl: string;
  private readonly tokenUrl: string;
  private readonly revocationUrl: string;

  constructor(private readonly options: GitHubProviderTokenAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.authorizationUrl =
      options.authorizationUrl ?? 'https://github.com/login/oauth/authorize';
    this.tokenUrl =
      options.tokenUrl ?? 'https://github.com/login/oauth/access_token';
    this.revocationUrl =
      options.revocationUrl ??
      `https://api.github.com/applications/${encodeURIComponent(
        options.clientId,
      )}/grant`;
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
  }): Promise<ProviderTokenSet> {
    const body = await this.request(
      {
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
      },
      false,
    );
    return this.parseRefreshableTokenSet(body, input.scopes);
  }

  async refreshAccessToken(input: {
    refreshToken: string;
    scopes: string[];
  }): Promise<ProviderTokenRefreshResult> {
    const body = await this.request(
      {
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      },
      true,
    );
    const tokenSet = this.parseRefreshableTokenSet(body, input.scopes);
    return {
      ...tokenSet,
      scopes: stringField(body, 'scope') ? tokenSet.scopes : undefined,
    };
  }

  /** Best-effort revocation of the OAuth app authorization for disconnect. */
  async revokeRefreshToken(input: { refreshToken: string }): Promise<void> {
    const refreshed = await this.refreshAccessToken({
      refreshToken: input.refreshToken,
      scopes: [],
    });
    let response: Response;
    try {
      response = await this.fetchImpl(this.revocationUrl, {
        method: 'DELETE',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Basic ${Buffer.from(
            `${this.options.clientId}:${this.options.clientSecret}`,
          ).toString('base64')}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: refreshed.accessToken }),
      });
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerUnavailable,
        'GitHub authorization revocation is temporarily unavailable.',
        { retryable: true },
      );
    }
    if (!response.ok && response.status !== 404) {
      throw new ProviderTokenError(
        response.status >= 500 || response.status === 429
          ? providerTokenErrorCodes.providerUnavailable
          : providerTokenErrorCodes.invalidProviderResponse,
        'GitHub authorization revocation failed.',
        { retryable: response.status >= 500 || response.status === 429 },
      );
    }
  }

  private async request(
    fields: Record<string, string>,
    refreshing: boolean,
  ): Promise<TokenResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.tokenUrl, tokenRequest(fields));
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerUnavailable,
        'GitHub is temporarily unavailable.',
        { retryable: true },
      );
    }

    if (response.status === 429 || response.status >= 500) {
      throw safeProviderFailure(response, undefined, refreshing);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'GitHub returned an invalid OAuth response.',
      );
    }
    if (
      !response.ok ||
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      throw safeProviderFailure(response, body, refreshing);
    }
    return body as TokenResponse;
  }

  private parseRefreshableTokenSet(
    body: TokenResponse,
    requestedScopes: string[],
  ): ProviderTokenSet {
    const accessToken = stringField(body, 'access_token');
    const refreshToken = stringField(body, 'refresh_token');
    const accessTokenSeconds = secondsField(body, 'expires_in');
    const refreshTokenSeconds = secondsField(body, 'refresh_token_expires_in');
    if (
      !accessToken ||
      !refreshToken ||
      !accessTokenSeconds ||
      !refreshTokenSeconds
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'GitHub did not return refreshable expiring OAuth credentials.',
      );
    }
    const issuedAt = this.now().getTime();
    return {
      accessToken,
      accessTokenExpiresAt: new Date(issuedAt + accessTokenSeconds * 1000),
      refreshToken,
      refreshTokenExpiresAt: new Date(issuedAt + refreshTokenSeconds * 1000),
      scopes: parseScopes(body, requestedScopes),
    };
  }
}
