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
  expiresAt: string;
  revokedAt?: string;
}

export interface ProviderConnectionGrant {
  grantId: string;
  provider: string;
  scopes: string[];
  expiresAt: string;
}

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
      throw new Error(
        `Secure token storage request failed (${response.status})`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
