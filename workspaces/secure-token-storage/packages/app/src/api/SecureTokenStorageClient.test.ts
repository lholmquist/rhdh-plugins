/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { FetchApi } from '@backstage/core-plugin-api';
import { SecureTokenStorageClient } from './SecureTokenStorageClient';

describe('SecureTokenStorageClient', () => {
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
    const client = new SecureTokenStorageClient({ fetch } as FetchApi);

    await expect(client.approveConnection('session-1')).resolves.toEqual({
      grantId: 'grant-1',
      provider: 'github',
      scopes: ['repo'],
      expiresAt: '2026-09-08T12:00:00.000Z',
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/secure-token-storage/connections/session-1/consent',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    expect(fetch.mock.calls[0][1].body).not.toContain('accessToken');
    expect(fetch.mock.calls[0][1].body).not.toContain('refreshToken');
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
    const client = new SecureTokenStorageClient({ fetch } as FetchApi);

    await expect(client.listGrants()).resolves.toEqual([
      { grantId: 'grant-1' },
    ]);
    await expect(client.revokeGrant('grant-1')).resolves.toBeUndefined();

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/secure-token-storage/grants',
      undefined,
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/secure-token-storage/grants/grant-1/revoke',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
