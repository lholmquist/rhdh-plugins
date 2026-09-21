/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createBackendModule } from '@backstage/backend-plugin-api';
import { providerTokenGrantExtensionPoint } from '@red-hat-developer-hub/backstage-plugin-orchestrator-node';
import { secureTokenStorageServiceRef } from '@red-hat-developer-hub/backstage-plugin-secure-token-storage-node';

/**
 * Registers secure token storage as the provider-token grant resolver for
 * Orchestrator workflows.
 *
 * @public
 */
export const secureTokenStorageOrchestratorModule = createBackendModule({
  pluginId: 'orchestrator',
  moduleId: 'secure-token-storage',
  register(reg) {
    reg.registerInit({
      deps: {
        providerTokenGrants: providerTokenGrantExtensionPoint,
        secureTokenStorage: secureTokenStorageServiceRef,
      },
      async init({ providerTokenGrants, secureTokenStorage }) {
        providerTokenGrants.setProviderTokenGrantResolver({
          getAccessToken: options => secureTokenStorage.getAccessToken(options),
          resolveProviderTokenGrant: async ({ userEntityRef, provider }) => {
            const grants = await secureTokenStorage.listGrants({
              userEntityRef,
              provider,
            });
            const activeGrants = grants.filter(
              grant =>
                !grant.revokedAt && grant.expiresAt.getTime() > Date.now(),
            );

            if (!provider) {
              const providers = new Set(
                activeGrants.map(grant => grant.provider),
              );
              if (providers.size !== 1) {
                return undefined;
              }
            }

            const grant = activeGrants[0];
            return grant
              ? { grantId: grant.grantId, provider: grant.provider }
              : undefined;
          },
        });
      },
    });
  },
});
