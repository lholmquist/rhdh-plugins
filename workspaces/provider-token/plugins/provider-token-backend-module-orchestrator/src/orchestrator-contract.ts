/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  createExtensionPoint,
  type BackstageCredentials,
  type BackstageServicePrincipal,
} from '@backstage/backend-plugin-api';

/** The opaque grant reference accepted by the Orchestrator workflow contract. */
export interface ProviderTokenGrantReference {
  grantId: string;
  provider: string;
}

/** Resolver contract registered by the provider-token backend module. */
export interface ProviderTokenGrantResolver {
  getAccessToken(options: {
    grantId: string;
    provider: string;
    caller: BackstageCredentials<BackstageServicePrincipal>;
  }): Promise<{
    accessToken: string;
    expiresAt?: Date;
    scopes: string[];
  }>;
  resolveProviderTokenGrant?(options: {
    userEntityRef: string;
    provider?: string;
  }): Promise<ProviderTokenGrantReference | undefined>;
}

/** Extension-point contract owned by Orchestrator's backend plugin. */
export interface ProviderTokenGrantExtensionPoint {
  setProviderTokenGrantResolver(resolver: ProviderTokenGrantResolver): void;
}

/**
 * Uses Orchestrator's stable extension-point ID. The currently pinned
 * orchestrator-node package does not yet export this in-repository addition;
 * keep this structural contract synchronized with that package's extensions.
 */
export const providerTokenGrantExtensionPoint =
  createExtensionPoint<ProviderTokenGrantExtensionPoint>({
    id: 'orchestrator.provider-token-grants',
  });
