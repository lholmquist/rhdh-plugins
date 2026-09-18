/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { SecureTokenStorageClient } from './SecureTokenStorageClient';

describe('SecureTokenStorageClient', () => {
  const baseUrl = 'http://localhost:7007/api/secure-token-storage';

  const discoveryApi = {
    getBaseUrl: jest.fn().mockResolvedValue(baseUrl),
  } as DiscoveryApi;

  it('approves a consent session without sending token material', async () => {
    const fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          grantId: 'grant-1',
          provider: 'github',
          scopes: ['repo'],
          expiresAt: '2026-09-08T12:00:00.000Z',
        }),
        { status: 201 },
      ),
    );
    const client = new SecureTokenStorageClient({
      discoveryApi,
      fetchApi: { fetch } as FetchApi,
    });

    await expect(client.approveConnection('session-1')).resolves.toEqual({
      grantId: 'grant-1',
      provider: 'github',
      scopes: ['repo'],
      expiresAt: '2026-09-08T12:00:00.000Z',
    });

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/connections/session-1/consent`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    expect(fetch.mock.calls[0][1].body).not.toContain('accessToken');
    expect(fetch.mock.calls[0][1].body).not.toContain('refreshToken');
  });

  it('starts a browser connection and returns the provider authorization URL', async () => {
    const fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: 'session-1',
          authorizationUrl: 'https://github.example/authorize',
          expiresAt: '2026-09-08T12:00:00.000Z',
        }),
        { status: 201 },
      ),
    );
    const client = new SecureTokenStorageClient({
      discoveryApi,
      fetchApi: { fetch } as FetchApi,
    });

    await expect(client.startConnection('github')).resolves.toEqual({
      sessionId: 'session-1',
      authorizationUrl: 'https://github.example/authorize',
      expiresAt: '2026-09-08T12:00:00.000Z',
    });

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/connections/github/start-user`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lists grants and revokes a selected grant', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ grantId: 'grant-1' }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new SecureTokenStorageClient({
      discoveryApi,
      fetchApi: { fetch } as FetchApi,
    });

    await expect(client.listGrants()).resolves.toEqual([
      { grantId: 'grant-1' },
    ]);
    await expect(client.revokeGrant('grant-1')).resolves.toBeUndefined();

    expect(fetch).toHaveBeenNthCalledWith(1, `${baseUrl}/grants`, undefined);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${baseUrl}/grants/grant-1/revoke`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
