/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createServiceRef } from '@backstage/backend-plugin-api';

/**
 * The health state exposed by the secure token storage foundation.
 *
 * @public
 */
export interface SecureTokenStorageStatus {
  /** Whether the broker is enabled by configuration. */
  enabled: boolean;
}

/**
 * Root-scoped service contract for secure provider token storage.
 *
 * Token persistence and provider-specific behavior remain behind this small
 * interface so consumers do not depend on the storage implementation.
 *
 * @public
 */
export interface SecureTokenStorageService {
  /** Returns the current feature status. */
  getStatus(): Promise<SecureTokenStorageStatus>;
}

/**
 * The canonical service reference used by the backend plugin and consumers.
 *
 * @public
 */
export const secureTokenStorageServiceRef =
  createServiceRef<SecureTokenStorageService>({
    id: 'secure-token-storage',
    scope: 'root',
  });
