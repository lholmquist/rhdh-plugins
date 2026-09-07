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
        providerTokenGrants.setProviderTokenGrantResolver(secureTokenStorage);
      },
    });
  },
});
