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
import Router from 'express-promise-router';

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
        secureTokenStorage: secureTokenStorageServiceRef,
      },
      async init({ httpRouter, secureTokenStorage }) {
        const router = Router();
        router.get('/health', async (_req, res) => {
          res.json(await secureTokenStorage.getStatus());
        });

        httpRouter.use(router);
        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
