/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import request from 'supertest';
import { secureTokenStoragePlugin } from './plugin';
import { secureTokenStorageServiceFactory } from './service';

describe('secureTokenStoragePlugin', () => {
  it('registers an unauthenticated health endpoint and is disabled by default', async () => {
    const { server } = await startTestBackend({
      features: [secureTokenStoragePlugin, secureTokenStorageServiceFactory],
    });

    const response = await request(server).get(
      '/api/secure-token-storage/health',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false });
  });

  it('reports the explicit feature flag through the service boundary', async () => {
    const { server } = await startTestBackend({
      features: [
        secureTokenStoragePlugin,
        secureTokenStorageServiceFactory,
        mockServices.rootConfig.factory({
          data: { secureTokenStorage: { enabled: true } },
        }),
      ],
    });

    const response = await request(server).get(
      '/api/secure-token-storage/health',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: true });
  });
});
