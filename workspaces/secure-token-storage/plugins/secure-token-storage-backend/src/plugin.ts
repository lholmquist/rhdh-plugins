/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { secureTokenStorageServiceRef } from '@red-hat-developer-hub/backstage-plugin-secure-token-storage-node';
import { createRouter } from './router';

/**
 * Backend plugin for the secure token storage foundation.
 *
 * @public
 */
export const secureTokenStoragePlugin = createBackendPlugin({
  pluginId: 'secure-token-storage',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        config: coreServices.rootConfig,
        secureTokenStorage: secureTokenStorageServiceRef,
      },
      async init({ httpRouter, httpAuth, config, secureTokenStorage }) {
        httpRouter.use(
          await createRouter({
            httpAuth,
            service: secureTokenStorage,
            consentUrl: config.getOptionalString(
              'secureTokenStorage.oauth.consentUrl',
            ),
          }),
        );
        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });
        httpRouter.addAuthPolicy({
          path: '/connections/:provider/callback',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
