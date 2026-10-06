/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type {
  AuthService,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import {
  ProviderTokenError,
  providerTokenErrorCodes,
  type ProviderTokenAccessTokenResult,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type { ProviderTokenApi } from './index';

const knownErrorCodes = new Set<string>(Object.values(providerTokenErrorCodes));

function asAccessTokenResult(value: unknown): ProviderTokenAccessTokenResult {
  if (!value || typeof value !== 'object') {
    throw new ProviderTokenError(
      providerTokenErrorCodes.invalidProviderResponse,
      'Provider-token returned an invalid response.',
    );
  }
  const result = value as Record<string, unknown>;
  const expiresAt =
    typeof result.expiresAt === 'string' || result.expiresAt instanceof Date
      ? new Date(result.expiresAt)
      : undefined;
  if (
    typeof result.accessToken !== 'string' ||
    !result.accessToken ||
    !expiresAt ||
    !Number.isFinite(expiresAt.getTime()) ||
    !Array.isArray(result.scopes) ||
    !result.scopes.every(
      scope => typeof scope === 'string' && scope.length > 0,
    ) ||
    (result.userEntityRef !== undefined &&
      typeof result.userEntityRef !== 'string')
  ) {
    throw new ProviderTokenError(
      providerTokenErrorCodes.invalidProviderResponse,
      'Provider-token returned an invalid response.',
    );
  }

  return {
    token: result.accessToken,
    expiresAt,
    scopes: [...result.scopes],
    ...(typeof result.userEntityRef === 'string' && {
      userEntityRef: result.userEntityRef,
    }),
  };
}

/**
 * Node client for authenticated provider-token requests. It discovers the
 * backend URL and issues a fresh plugin request token for every call.
 *
 * @public
 */
export class ProviderTokenClient implements ProviderTokenApi {
  private readonly auth: AuthService;
  private readonly discovery: DiscoveryService;
  private readonly fetchApi: typeof fetch;

  constructor(options: {
    auth: AuthService;
    discovery: DiscoveryService;
    fetchApi?: typeof fetch;
  }) {
    this.auth = options.auth;
    this.discovery = options.discovery;
    this.fetchApi = options.fetchApi ?? fetch;
  }

  /** Requests an access token for a grant without constructing route paths. */
  async getAccessToken(input: {
    grantId: string;
    credentials: Parameters<
      AuthService['getPluginRequestToken']
    >[0]['onBehalfOf'];
    provider?: string;
    context?: string;
  }): Promise<ProviderTokenAccessTokenResult> {
    const [{ token }, baseUrl] = await Promise.all([
      this.auth.getPluginRequestToken({
        onBehalfOf: input.credentials,
        targetPluginId: 'provider-token',
      }),
      this.discovery.getBaseUrl('provider-token'),
    ]);

    let response: Response;
    try {
      response = await this.fetchApi(`${baseUrl}/v1/access-tokens`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grantId: input.grantId,
          ...(input.provider !== undefined && { provider: input.provider }),
          ...(input.context !== undefined && { context: input.context }),
        }),
      });
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerUnavailable,
        'Provider-token is temporarily unavailable.',
        { retryable: true },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'Provider-token returned an invalid response.',
      );
    }

    if (!response.ok) {
      const error =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>).error
          : undefined;
      const details =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : {};
      let code: string;
      if (
        typeof details.code === 'string' &&
        knownErrorCodes.has(details.code)
      ) {
        code = details.code;
      } else if (response.status >= 500) {
        code = providerTokenErrorCodes.providerUnavailable;
      } else {
        code = providerTokenErrorCodes.invalidRequest;
      }
      throw new ProviderTokenError(
        code as (typeof providerTokenErrorCodes)[keyof typeof providerTokenErrorCodes],
        'Provider-token request failed.',
        { retryable: details.retryable === true },
      );
    }

    return asAccessTokenResult(body);
  }

  /** Resolves a safe active grant reference through the authenticated backend. */
  async resolveProviderTokenGrant(input: {
    userEntityRef: string;
    credentials: Parameters<
      AuthService['getPluginRequestToken']
    >[0]['onBehalfOf'];
    provider?: string;
  }): Promise<{ grantId: string; provider: string } | undefined> {
    const [{ token }, baseUrl] = await Promise.all([
      this.auth.getPluginRequestToken({
        onBehalfOf: input.credentials,
        targetPluginId: 'provider-token',
      }),
      this.discovery.getBaseUrl('provider-token'),
    ]);

    let response: Response;
    try {
      response = await this.fetchApi(`${baseUrl}/v1/grants/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userEntityRef: input.userEntityRef,
          ...(input.provider !== undefined && { provider: input.provider }),
        }),
      });
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.providerUnavailable,
        'Provider-token is temporarily unavailable.',
        { retryable: true },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'Provider-token returned an invalid response.',
      );
    }

    if (!response.ok) {
      const error =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>).error
          : undefined;
      const details =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : {};
      let code: string;
      if (
        typeof details.code === 'string' &&
        knownErrorCodes.has(details.code)
      ) {
        code = details.code;
      } else if (response.status >= 500) {
        code = providerTokenErrorCodes.providerUnavailable;
      } else {
        code = providerTokenErrorCodes.invalidRequest;
      }
      throw new ProviderTokenError(
        code as (typeof providerTokenErrorCodes)[keyof typeof providerTokenErrorCodes],
        'Provider-token grant resolution failed.',
        { retryable: details.retryable === true },
      );
    }

    if (!body || typeof body !== 'object') {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'Provider-token returned an invalid response.',
      );
    }
    const grant = (body as Record<string, unknown>).grant;
    if (grant === null) return undefined;
    if (
      !grant ||
      typeof grant !== 'object' ||
      typeof (grant as Record<string, unknown>).grantId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(
        (grant as Record<string, unknown>).grantId as string,
      ) ||
      typeof (grant as Record<string, unknown>).provider !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(
        (grant as Record<string, unknown>).provider as string,
      )
    ) {
      throw new ProviderTokenError(
        providerTokenErrorCodes.invalidProviderResponse,
        'Provider-token returned an invalid response.',
      );
    }

    return {
      grantId: (grant as Record<string, string>).grantId,
      provider: (grant as Record<string, string>).provider,
    };
  }
}
