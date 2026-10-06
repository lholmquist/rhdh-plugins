/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import type {
  ProviderTokenConnectDecisionResult,
  ProviderTokenConnectOptions,
  ProviderTokenConnectSessionSummary,
  ProviderTokenConnectionSummary,
  ProviderTokenGrantSummary,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';

export type ProviderTokenUiGrant = Omit<
  ProviderTokenGrantSummary,
  'createdAt' | 'expiresAt' | 'revokedAt'
> & {
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
};

export type ProviderTokenUiConnection = Omit<
  ProviderTokenConnectionSummary,
  'connectedAt'
> & { connectedAt: Date };

export type ProviderTokenUiConsentSession = Omit<
  ProviderTokenConnectSessionSummary,
  'expiresAt'
> & { expiresAt: Date };

/** An HTTP failure with only the stable server error code retained. */
export class ProviderTokenUiError extends Error {
  constructor(readonly code: string) {
    super('Provider-token request failed.');
    this.name = 'ProviderTokenUiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function parseScopes(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every(scope => typeof scope === 'string' && scope.length > 0)
    ? [...value]
    : undefined;
}

function parseProviderScopes(
  value: unknown,
): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const providerScopes: Record<string, string[]> = {};
  for (const [provider, scopesValue] of Object.entries(value)) {
    const scopes = parseScopes(scopesValue);
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(provider) ||
      !scopes ||
      scopes.length === 0
    ) {
      return undefined;
    }
    providerScopes[provider] = scopes;
  }
  return Object.keys(providerScopes).length > 0 ? providerScopes : undefined;
}

function parseOptions(value: unknown): ProviderTokenConnectOptions {
  if (!isRecord(value)) throw new ProviderTokenUiError('invalid-response');
  const clients = Array.isArray(value.clients)
    ? value.clients.flatMap(client => {
        const providerScopes = isRecord(client)
          ? parseProviderScopes(client.providerScopes)
          : undefined;
        if (
          !isRecord(client) ||
          typeof client.id !== 'string' ||
          typeof client.title !== 'string' ||
          typeof client.purpose !== 'string' ||
          !providerScopes
        ) {
          return [];
        }
        return [
          {
            id: client.id,
            title: client.title,
            purpose: client.purpose,
            providerScopes,
          },
        ];
      })
    : undefined;
  if (
    !Array.isArray(value.providers) ||
    !value.providers.every(provider => typeof provider === 'string') ||
    !clients
  ) {
    throw new ProviderTokenUiError('invalid-response');
  }
  return { providers: [...value.providers], clients };
}

function parseConnections(value: unknown): ProviderTokenUiConnection[] {
  if (!Array.isArray(value)) throw new ProviderTokenUiError('invalid-response');
  return value.flatMap(connection => {
    if (!isRecord(connection)) return [];
    const connectedAt = parseDate(connection.connectedAt);
    const scopes = parseScopes(connection.scopes);
    if (typeof connection.provider !== 'string' || !connectedAt || !scopes) {
      return [];
    }
    return [{ provider: connection.provider, scopes, connectedAt }];
  });
}

function parseGrants(value: unknown): ProviderTokenUiGrant[] {
  if (!Array.isArray(value)) throw new ProviderTokenUiError('invalid-response');
  return value.flatMap(grant => {
    if (!isRecord(grant)) return [];
    const createdAt = parseDate(grant.createdAt);
    const expiresAt = parseDate(grant.expiresAt);
    const revokedAt =
      grant.revokedAt === undefined ? undefined : parseDate(grant.revokedAt);
    const scopes = parseScopes(grant.scopes);
    if (
      typeof grant.grantId !== 'string' ||
      typeof grant.provider !== 'string' ||
      typeof grant.clientId !== 'string' ||
      typeof grant.callerSubject !== 'string' ||
      !createdAt ||
      !expiresAt ||
      (grant.revokedAt !== undefined && !revokedAt) ||
      !scopes
    ) {
      return [];
    }
    return [
      {
        grantId: grant.grantId,
        provider: grant.provider,
        clientId: grant.clientId,
        callerSubject: grant.callerSubject,
        scopes,
        createdAt,
        expiresAt,
        ...(revokedAt && { revokedAt }),
      },
    ];
  });
}

function parseConsentSession(value: unknown): ProviderTokenUiConsentSession {
  if (!isRecord(value)) throw new ProviderTokenUiError('invalid-response');
  const expiresAt = parseDate(value.expiresAt);
  const scopes = parseScopes(value.scopes);
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.clientId !== 'string' ||
    typeof value.clientTitle !== 'string' ||
    typeof value.callerSubject !== 'string' ||
    typeof value.purpose !== 'string' ||
    typeof value.provider !== 'string' ||
    !scopes ||
    !expiresAt ||
    (value.consentStatus !== 'pending' &&
      value.consentStatus !== 'approved' &&
      value.consentStatus !== 'denied') ||
    (value.grantId !== undefined && typeof value.grantId !== 'string')
  ) {
    throw new ProviderTokenUiError('invalid-response');
  }
  return {
    sessionId: value.sessionId,
    clientId: value.clientId,
    clientTitle: value.clientTitle,
    callerSubject: value.callerSubject,
    purpose: value.purpose,
    provider: value.provider,
    scopes,
    expiresAt,
    consentStatus: value.consentStatus,
    ...(typeof value.grantId === 'string' && { grantId: value.grantId }),
  };
}

/** Browser client for the token-free provider connection and grant API. */
export class ProviderTokenClient {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly fetchApi: FetchApi,
  ) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      const baseUrl = await this.discoveryApi.getBaseUrl('provider-token');
      response = await this.fetchApi.fetch(
        `${baseUrl.replace(/\/$/, '')}${path}`,
        init,
      );
    } catch {
      throw new ProviderTokenUiError('provider-unavailable');
    }

    if (response.status === 204) return undefined;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderTokenUiError('invalid-response');
    }
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : {};
      throw new ProviderTokenUiError(
        typeof error.code === 'string' ? error.code : 'request-failed',
      );
    }
    return body;
  }

  async getConnectOptions(): Promise<ProviderTokenConnectOptions> {
    return parseOptions(await this.request('/v1/connect/options'));
  }

  async listConnections(): Promise<ProviderTokenUiConnection[]> {
    return parseConnections(await this.request('/v1/connections'));
  }

  async listGrants(): Promise<ProviderTokenUiGrant[]> {
    return parseGrants(await this.request('/v1/grants'));
  }

  async startConnect(input: {
    provider: string;
    clientId: string;
    returnUrl: string;
  }): Promise<{ authorizationUrl: string }> {
    const value = await this.request('/v1/connect/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!isRecord(value) || typeof value.authorizationUrl !== 'string') {
      throw new ProviderTokenUiError('invalid-response');
    }
    let authorizationUrl: URL;
    try {
      authorizationUrl = new URL(value.authorizationUrl);
    } catch {
      throw new ProviderTokenUiError('invalid-response');
    }
    if (
      authorizationUrl.username ||
      authorizationUrl.password ||
      authorizationUrl.hash ||
      (authorizationUrl.protocol !== 'https:' &&
        !(
          authorizationUrl.protocol === 'http:' &&
          authorizationUrl.hostname === 'localhost'
        ))
    ) {
      throw new ProviderTokenUiError('invalid-response');
    }
    return { authorizationUrl: authorizationUrl.toString() };
  }

  async getConnectSession(
    sessionId: string,
  ): Promise<ProviderTokenUiConsentSession> {
    return parseConsentSession(
      await this.request(
        `/v1/connect/sessions/${encodeURIComponent(sessionId)}`,
      ),
    );
  }

  async decideConnectSession(
    sessionId: string,
    decision: 'approve' | 'deny',
  ): Promise<ProviderTokenConnectDecisionResult> {
    const value = await this.request(
      `/v1/connect/sessions/${encodeURIComponent(sessionId)}/decision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      },
    );
    if (
      !isRecord(value) ||
      (value.consentStatus !== 'approved' &&
        value.consentStatus !== 'denied') ||
      (value.grantId !== undefined && typeof value.grantId !== 'string')
    ) {
      throw new ProviderTokenUiError('invalid-response');
    }
    return {
      consentStatus: value.consentStatus,
      ...(typeof value.grantId === 'string' && { grantId: value.grantId }),
    };
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.request(`/v1/grants/${encodeURIComponent(grantId)}`, {
      method: 'DELETE',
    });
  }

  async disconnectProvider(provider: string): Promise<void> {
    await this.request(`/v1/providers/${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    });
  }
}
