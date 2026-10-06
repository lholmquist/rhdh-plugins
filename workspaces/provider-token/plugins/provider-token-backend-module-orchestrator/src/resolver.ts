/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { ProviderTokenGrantResolver } from './orchestrator-contract';
import type { AuthService } from '@backstage/backend-plugin-api';
import type { ProviderTokenApi } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';

/** Builds the resolver shared with Orchestrator's workflow execution service. */
export function createProviderTokenGrantResolver(options: {
  auth: AuthService;
  client: ProviderTokenApi;
}): ProviderTokenGrantResolver {
  return {
    async getAccessToken({ grantId, provider, caller }) {
      const result = await options.client.getAccessToken({
        grantId,
        credentials: caller,
        provider,
        context: 'Orchestrator workflow execution',
      });
      return {
        accessToken: result.token,
        expiresAt: result.expiresAt,
        scopes: result.scopes,
      };
    },

    async resolveProviderTokenGrant({ userEntityRef, provider }) {
      return options.client.resolveProviderTokenGrant({
        userEntityRef,
        provider,
        credentials: await options.auth.getOwnServiceCredentials(),
      });
    },
  };
}
