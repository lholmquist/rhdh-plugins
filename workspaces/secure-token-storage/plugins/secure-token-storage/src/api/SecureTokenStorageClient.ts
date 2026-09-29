/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';

export interface ProviderTokenGrant {
  grantId: string;
  provider: string;
  scopes: string[];
  createdAt?: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface SecureTokenStorageProviderStatus {
  provider: string;
  configured: boolean;
  connected: boolean;
  scopes: string[];
  accessTokenExpiresAt?: string;
  reconnectRequired: boolean;
  grants: ProviderTokenGrant[];
}

export interface ProviderConnectionGrant {
  grantId: string;
  provider: string;
  scopes: string[];
  expiresAt: string;
}

export interface ProviderConnectionStart {
  sessionId: string;
  authorizationUrl: string;
  expiresAt: string;
}

export interface SecureTokenStorageStatus {
  enabled: boolean;
}

/** Error returned by the secure token storage API, including its safe code. */
export class SecureTokenStorageApiError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`Secure token storage request failed (${status})`);
    this.name = 'SecureTokenStorageApiError';
  }
}

/** Client for the secure token storage backend endpoints used by the page. */
export class SecureTokenStorageClient {
  constructor(
    private readonly options: {
      discoveryApi: DiscoveryApi;
      fetchApi: FetchApi;
    },
  ) {}

  async listGrants(provider?: string): Promise<ProviderTokenGrant[]> {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.request<ProviderTokenGrant[]>(`/grants${query}`);
  }

  async listProviders(): Promise<SecureTokenStorageProviderStatus[]> {
    return this.request<SecureTokenStorageProviderStatus[]>('/providers');
  }

  async getStatus(): Promise<SecureTokenStorageStatus> {
    return this.request<SecureTokenStorageStatus>('/health');
  }

  async approveConnection(
    sessionId: string,
    expiresAt?: string,
  ): Promise<ProviderConnectionGrant> {
    return this.request<ProviderConnectionGrant>(
      `/connections/${encodeURIComponent(sessionId)}/consent`,
      {
        method: 'POST',
        body: JSON.stringify({
          decision: 'approve',
          ...(expiresAt ? { expiresAt } : {}),
        }),
      },
    );
  }

  async startConnection(provider: string): Promise<ProviderConnectionStart> {
    return this.request<ProviderConnectionStart>(
      `/connections/${encodeURIComponent(provider)}/start-user`,
      { method: 'POST' },
    );
  }

  async rejectConnection(sessionId: string): Promise<void> {
    await this.request<void>(
      `/connections/${encodeURIComponent(sessionId)}/consent`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'reject' }),
      },
    );
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.request<void>(`/grants/${encodeURIComponent(grantId)}/revoke`, {
      method: 'POST',
    });
  }

  async refreshGrant(grantId: string): Promise<ProviderTokenGrant> {
    return this.request<ProviderTokenGrant>(
      `/grants/${encodeURIComponent(grantId)}/refresh`,
      { method: 'POST' },
    );
  }

  async disconnectProvider(provider: string): Promise<void> {
    await this.request<void>(
      `/connections/${encodeURIComponent(provider)}/disconnect`,
      { method: 'POST' },
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const requestInit = init?.body
      ? {
          ...init,
          headers: {
            'content-type': 'application/json',
            ...init.headers,
          },
        }
      : init;
    const baseUrl = await this.options.discoveryApi.getBaseUrl(
      'secure-token-storage',
    );
    const response = await this.options.fetchApi.fetch(
      `${baseUrl}${path}`,
      requestInit,
    );

    if (!response.ok) {
      let code: string | undefined;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string') code = body.error;
      } catch {
        // Error responses can come from a proxy and may not contain JSON.
      }
      throw new SecureTokenStorageApiError(response.status, code);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
