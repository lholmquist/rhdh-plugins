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

export interface MicrosoftProviderTokenAdapterOptions {
  clientId: string;
  clientSecret: string;
  tenant: string;
  authorizationUrl?: string;
  tokenUrl?: string;
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
  const scopes = raw
    ? raw
        .split(' ')
        .map(scope => scope.trim())
        .filter(scope => scope && scope !== 'offline_access')
    : [];
  return scopes.length
    ? scopes
    : fallback.filter(scope => scope !== 'offline_access');
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
  if (refreshing && errorCode === 'invalid_grant') {
    return new ProviderTokenError(
      providerTokenErrorCodes.tokenRefreshRejected,
      'The Microsoft refresh token was rejected; reconnect the provider.',
    );
  }
  if (response.status === 429 || response.status >= 500) {
    return new ProviderTokenError(
      providerTokenErrorCodes.providerUnavailable,
      'Microsoft identity is temporarily unavailable.',
      { retryable: true },
    );
  }
  return new ProviderTokenError(
    providerTokenErrorCodes.invalidProviderResponse,
    'Microsoft identity returned an invalid OAuth response.',
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

/** Microsoft identity platform OAuth adapter for a configured tenant. */
export class MicrosoftProviderTokenAdapter implements ProviderTokenAdapter {
  readonly id = 'microsoft';
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly authorizationUrl: string;
  private readonly tokenUrl: string;

  constructor(private readonly options: MicrosoftProviderTokenAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    const tenant = encodeURIComponent(options.tenant);
    this.authorizationUrl =
      options.authorizationUrl ??
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
    this.tokenUrl =
      options.tokenUrl ??
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
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
  }): Promise<ProviderTokenSet> {
    const body = await this.request(
      {
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: input.redirectUri,
        scope: withOfflineAccess(input.scopes).join(' '),
      },
      false,
    );
    return this.parseTokenSet(body, input.scopes, true);
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
        scope: withOfflineAccess(input.scopes).join(' '),
      },
      true,
    );
    return this.parseTokenSet(body, input.scopes, false);
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
        'Microsoft identity is temporarily unavailable.',
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
        'Microsoft identity returned an invalid OAuth response.',
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

  private parseTokenSet(
    body: TokenResponse,
    requestedScopes: string[],
    requireRefreshToken: true,
  ): ProviderTokenSet;
  private parseTokenSet(
    body: TokenResponse,
    requestedScopes: string[],
    requireRefreshToken: false,
  ): ProviderTokenRefreshResult;
  private parseTokenSet(
    body: TokenResponse,
    requestedScopes: string[],
    requireRefreshToken: boolean,
  ): ProviderTokenSet | ProviderTokenRefreshResult {
    const accessToken = stringField(body, 'access_token');
    const refreshToken = stringField(body, 'refresh_token');
    const accessTokenSeconds = secondsField(body, 'expires_in');
    if (
      !accessToken ||
      !accessTokenSeconds ||
      (requireRefreshToken && !refreshToken)
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'Microsoft identity did not return the required expiring OAuth credentials.',
      );
    }
    const issuedAt = this.now().getTime();
    const tokenSet = {
      accessToken,
      accessTokenExpiresAt: new Date(issuedAt + accessTokenSeconds * 1000),
      refreshToken,
    };
    if (requireRefreshToken) {
      return { ...tokenSet, scopes: parseScopes(body, requestedScopes) };
    }
    return {
      ...tokenSet,
      scopes: stringField(body, 'scope')
        ? parseScopes(body, requestedScopes)
        : undefined,
    };
  }
}
