/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import {
  secureTokenStorageServiceRef,
  type SecureTokenStorageService,
  type SecureTokenStorageStatus,
} from '@red-hat-developer-hub/backstage-plugin-secure-token-storage-node';

/** @internal */
export class DefaultSecureTokenStorageService
  implements SecureTokenStorageService
{
  private readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  async getStatus(): Promise<SecureTokenStorageStatus> {
    return { enabled: this.enabled };
  }
}

/**
 * Root-scoped service factory for the secure token storage foundation.
 *
 * The feature is disabled unless explicitly enabled in configuration. The
 * persistence implementation will be added behind this service in a later
 * acceptance-criteria slice.
 *
 * @public
 */
export const secureTokenStorageServiceFactory = createServiceFactory({
  service: secureTokenStorageServiceRef,
  deps: {
    config: coreServices.rootConfig,
  },
  async factory({ config }) {
    return new DefaultSecureTokenStorageService(
      config.getOptionalBoolean('secureTokenStorage.enabled') ?? false,
    );
  },
});
