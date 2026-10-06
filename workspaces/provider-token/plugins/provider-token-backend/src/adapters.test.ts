/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { ProviderTokenAdapter } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { addProviderTokenAdapter, providerTokenAdapters } from './adapters';

describe('provider-token adapter registry', () => {
  const adapter = (id: string): ProviderTokenAdapter => ({
    id,
    createAuthorizationUrl: () => 'https://provider.example/authorize',
    exchangeAuthorizationCode: async () => {
      throw new Error('not used');
    },
    refreshAccessToken: async () => {
      throw new Error('not used');
    },
  });

  afterEach(() => {
    providerTokenAdapters.delete('test-provider');
  });

  it('rejects duplicate and invalid provider IDs', () => {
    addProviderTokenAdapter(adapter('test-provider'));
    expect(() => addProviderTokenAdapter(adapter('test-provider'))).toThrow(
      'already registered',
    );
    expect(() => addProviderTokenAdapter(adapter('../invalid'))).toThrow(
      'ID is invalid',
    );
  });
});
