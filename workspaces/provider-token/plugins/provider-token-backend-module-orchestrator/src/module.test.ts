/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  createBackendPlugin,
  createExtensionPoint,
} from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import type { ProviderTokenGrantExtensionPoint } from './orchestrator-contract';
import providerTokenOrchestratorModule from './module';

describe('provider-token Orchestrator backend module', () => {
  it('registers against Orchestrator by its stable extension-point ID', async () => {
    const setResolver = jest.fn();
    // Intentionally create a distinct reference, as the Orchestrator plugin
    // does in its own package. Backend module wiring resolves these by ID.
    const orchestratorGrantExtensionPoint =
      createExtensionPoint<ProviderTokenGrantExtensionPoint>({
        id: 'orchestrator.provider-token-grants',
      });
    const orchestratorPlugin = createBackendPlugin({
      pluginId: 'orchestrator',
      register(reg) {
        reg.registerExtensionPoint(orchestratorGrantExtensionPoint, {
          setProviderTokenGrantResolver: setResolver,
        });
        reg.registerInit({
          deps: {},
          async init() {},
        });
      },
    });

    await startTestBackend({
      features: [
        mockServices.auth.factory(),
        mockServices.discovery.factory(),
        orchestratorPlugin,
        providerTokenOrchestratorModule,
      ],
    });

    expect(setResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        getAccessToken: expect.any(Function),
        resolveProviderTokenGrant: expect.any(Function),
      }),
    );
  });
});
