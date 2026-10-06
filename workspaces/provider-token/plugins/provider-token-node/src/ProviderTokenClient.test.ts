/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import { ProviderTokenError } from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import { ProviderTokenClient } from './ProviderTokenClient';

const credentials = {
  principal: { type: 'service', subject: 'plugin:orchestrator' },
} as BackstageCredentials;

describe('ProviderTokenClient', () => {
  const discovery = {
    getBaseUrl: jest.fn().mockResolvedValue('http://provider-token/api'),
  } as unknown as DiscoveryService;
  const auth = {
    getPluginRequestToken: jest.fn().mockResolvedValue({
      token: 'backstage-service-token',
    }),
  } as unknown as AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    (discovery.getBaseUrl as jest.Mock).mockResolvedValue(
      'http://provider-token/api',
    );
    (auth.getPluginRequestToken as jest.Mock).mockResolvedValue({
      token: 'backstage-service-token',
    });
  });

  it('uses discovery and a fresh plugin request token for grant issuance', async () => {
    const fetchApi = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: 'short-lived-provider-token',
        expiresAt: '2026-10-02T12:10:00.000Z',
        scopes: ['read:user'],
      }),
    }) as unknown as typeof fetch;
    const client = new ProviderTokenClient({ auth, discovery, fetchApi });

    await expect(
      client.getAccessToken({
        grantId: 'grant-1',
        credentials,
        provider: 'github',
        context: 'workflow execution',
      }),
    ).resolves.toEqual({
      token: 'short-lived-provider-token',
      expiresAt: new Date('2026-10-02T12:10:00.000Z'),
      scopes: ['read:user'],
    });
    expect(discovery.getBaseUrl).toHaveBeenCalledWith('provider-token');
    expect(auth.getPluginRequestToken).toHaveBeenCalledWith({
      onBehalfOf: credentials,
      targetPluginId: 'provider-token',
    });
    expect(fetchApi).toHaveBeenCalledWith(
      'http://provider-token/api/v1/access-tokens',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer backstage-service-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          grantId: 'grant-1',
          provider: 'github',
          context: 'workflow execution',
        }),
      }),
    );
  });

  it('maps server errors to stable safe errors without exposing response details', async () => {
    const fetchApi = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: 'grant-revoked',
          message: 'raw provider response contained a secret value',
          retryable: false,
        },
      }),
    }) as unknown as typeof fetch;
    const client = new ProviderTokenClient({ auth, discovery, fetchApi });

    let error: unknown;
    try {
      await client.getAccessToken({ grantId: 'grant-1', credentials });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProviderTokenError);
    expect(error).toMatchObject({
      code: 'grant-revoked',
      retryable: false,
    });
    expect((error as Error).message).not.toContain('raw provider response');
  });

  it('resolves an eligible grant through the authenticated backend', async () => {
    const fetchApi = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        grant: { grantId: 'grant-1', provider: 'github' },
      }),
    }) as unknown as typeof fetch;
    const client = new ProviderTokenClient({ auth, discovery, fetchApi });

    await expect(
      client.resolveProviderTokenGrant({
        userEntityRef: 'user:default/alice',
        provider: 'github',
        credentials,
      }),
    ).resolves.toEqual({ grantId: 'grant-1', provider: 'github' });
    expect(fetchApi).toHaveBeenCalledWith(
      'http://provider-token/api/v1/grants/resolve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          userEntityRef: 'user:default/alice',
          provider: 'github',
        }),
      }),
    );
  });

  it('returns undefined when no unambiguous grant is available', async () => {
    const fetchApi = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ grant: null }),
    }) as unknown as typeof fetch;
    const client = new ProviderTokenClient({ auth, discovery, fetchApi });

    await expect(
      client.resolveProviderTokenGrant({
        userEntityRef: 'user:default/alice',
        credentials,
      }),
    ).resolves.toBeUndefined();
  });
});
