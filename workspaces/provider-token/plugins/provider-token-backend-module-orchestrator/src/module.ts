/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { ProviderTokenClient } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { providerTokenGrantExtensionPoint } from './orchestrator-contract';
import { createProviderTokenGrantResolver } from './resolver';

/**
 * Registers Provider Token as Orchestrator's workflow grant resolver.
 *
 * @public
 */
const providerTokenOrchestratorModule = createBackendModule({
  pluginId: 'orchestrator',
  moduleId: 'provider-token',
  register(reg) {
    reg.registerInit({
      deps: {
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        providerTokenGrants: providerTokenGrantExtensionPoint,
      },
      async init({ auth, discovery, providerTokenGrants }) {
        providerTokenGrants.setProviderTokenGrantResolver(
          createProviderTokenGrantResolver({
            auth,
            client: new ProviderTokenClient({ auth, discovery }),
          }),
        );
      },
    });
  },
});

export default providerTokenOrchestratorModule;
