/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createBackendFeatureLoader } from '@backstage/backend-plugin-api';
import { secureTokenStoragePlugin } from './plugin';
import { secureTokenStorageServiceFactory } from './service';
import { secureTokenStorageOrchestratorModule } from './orchestrator-module';

/**
 * Default backend feature loader for dynamic plugin installation.
 *
 * @public
 */
export default createBackendFeatureLoader({
  *loader() {
    yield secureTokenStoragePlugin;
    yield secureTokenStorageServiceFactory;
    yield secureTokenStorageOrchestratorModule;
  },
});

export { secureTokenStoragePlugin } from './plugin';
export { secureTokenStorageServiceFactory } from './service';
export { secureTokenStorageOrchestratorModule } from './orchestrator-module';
