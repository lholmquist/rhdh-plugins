/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type {
  AuthService,
  BackstageCredentials,
  BackstageServicePrincipal,
} from '@backstage/backend-plugin-api';
import type { ProviderTokenAccessTokenResult } from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type { ProviderTokenApi } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { createProviderTokenGrantResolver } from './resolver';

describe('Provider Token Orchestrator resolver', () => {
  const ownCredentials = {
    principal: { type: 'service', subject: 'plugin:orchestrator' },
  } as BackstageCredentials<BackstageServicePrincipal>;
  const auth = {
    getOwnServiceCredentials: jest.fn().mockResolvedValue(ownCredentials),
  } as unknown as jest.Mocked<AuthService>;
  const client = {
    getAccessToken: jest.fn(),
    resolveProviderTokenGrant: jest.fn(),
  } as unknown as jest.Mocked<ProviderTokenApi>;

  beforeEach(() => {
    jest.clearAllMocks();
    auth.getOwnServiceCredentials.mockResolvedValue(ownCredentials);
    client.resolveProviderTokenGrant.mockResolvedValue({
      grantId: 'grant-github',
      provider: 'github',
    });
    client.getAccessToken.mockResolvedValue({
      token: 'short-lived-token',
      expiresAt: new Date('2026-10-05T12:10:00.000Z'),
      scopes: ['read:user'],
      userEntityRef: 'user:default/alice',
    } satisfies ProviderTokenAccessTokenResult);
  });

  it('resolves an active grant using Orchestrator service credentials', async () => {
    const resolver = createProviderTokenGrantResolver({ auth, client });

    await expect(
      resolver.resolveProviderTokenGrant?.({
        userEntityRef: 'user:default/alice',
        provider: 'github',
      }),
    ).resolves.toEqual({ grantId: 'grant-github', provider: 'github' });
    expect(auth.getOwnServiceCredentials).toHaveBeenCalledTimes(1);
    expect(client.resolveProviderTokenGrant).toHaveBeenCalledWith({
      userEntityRef: 'user:default/alice',
      provider: 'github',
      credentials: ownCredentials,
    });
  });

  it('preserves an ambiguous or missing result from the backend', async () => {
    client.resolveProviderTokenGrant.mockResolvedValueOnce(undefined);
    const resolver = createProviderTokenGrantResolver({ auth, client });

    await expect(
      resolver.resolveProviderTokenGrant?.({
        userEntityRef: 'user:default/alice',
      }),
    ).resolves.toBeUndefined();
  });

  it('gets a fresh token with the verified caller credentials and provider', async () => {
    const caller = {
      principal: { type: 'service', subject: 'sonataflow' },
    } as BackstageCredentials<BackstageServicePrincipal>;
    const resolver = createProviderTokenGrantResolver({ auth, client });

    await expect(
      resolver.getAccessToken({
        grantId: 'grant-github',
        provider: 'github',
        caller,
      }),
    ).resolves.toEqual({
      accessToken: 'short-lived-token',
      expiresAt: new Date('2026-10-05T12:10:00.000Z'),
      scopes: ['read:user'],
    });
    expect(client.getAccessToken).toHaveBeenCalledWith({
      grantId: 'grant-github',
      provider: 'github',
      credentials: caller,
      context: 'Orchestrator workflow execution',
    });
  });
});
