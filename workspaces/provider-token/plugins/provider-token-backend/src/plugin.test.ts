/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  createServiceMock,
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { providerTokenOperationsRef } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import providerTokenPlugin from './plugin';

const providerTokenOperationsMock = createServiceMock(
  providerTokenOperationsRef,
  () => ({
    assertProviderConfigured: jest.fn(),
    listGrants: jest.fn(),
    listConnections: jest.fn(),
    getConnectOptions: jest.fn(),
    startConnect: jest.fn(),
    completeConnectCallback: jest.fn(),
    getConnectSession: jest.fn(),
    decideConnectSession: jest.fn(),
    disconnectProvider: jest.fn(),
    revokeGrant: jest.fn(),
    issueAccessToken: jest.fn(),
    invalidate: jest.fn(),
  }),
);

describe('providerTokenPlugin', () => {
  it('allows anonymous requests to the OAuth callback only', async () => {
    const operations = providerTokenOperationsMock({
      completeConnectCallback: async () => ({
        redirectUrl: 'http://localhost:3000/provider-token',
      }),
    });
    const { server } = await startTestBackend({
      features: [
        mockServices.rootConfig.factory({
          data: { providerToken: { enabled: true } },
        }),
        mockServices.httpAuth.factory({
          defaultCredentials: mockCredentials.none(),
        }),
        providerTokenPlugin,
        operations.factory,
      ],
    });

    const callbackResponse = await fetch(
      `http://localhost:${server.port()}/api/provider-token/v1/connect/callback?state=diagnostic-state`,
      { redirect: 'manual' },
    );
    const grantsResponse = await fetch(
      `http://localhost:${server.port()}/api/provider-token/v1/grants`,
    );

    expect(callbackResponse.status).toBe(303);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:3000/provider-token',
    );
    expect(operations.completeConnectCallback).toHaveBeenCalledWith({
      state: 'diagnostic-state',
      code: undefined,
      providerError: undefined,
    });
    expect(grantsResponse.status).toBe(401);
  });
});
