/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { ProviderTokenAdapter } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';

/** Process-local registry shared by the backend plugin and optional modules. */
export const providerTokenAdapters = new Map<string, ProviderTokenAdapter>();

/** Adds a provider adapter and rejects invalid or duplicate provider IDs. */
export function addProviderTokenAdapter(adapter: ProviderTokenAdapter): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(adapter.id)) {
    throw new Error('Provider-token adapter ID is invalid');
  }
  if (providerTokenAdapters.has(adapter.id)) {
    throw new Error(
      `Provider-token adapter ${adapter.id} is already registered`,
    );
  }
  providerTokenAdapters.set(adapter.id, adapter);
}
