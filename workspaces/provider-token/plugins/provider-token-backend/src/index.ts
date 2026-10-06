/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createBackendFeatureLoader } from '@backstage/backend-plugin-api';
import providerTokenPlugin from './plugin';
import { providerTokenOperationsFactory } from './service';

/**
 * Backend entry point for the provider-token plugin.
 *
 * @packageDocumentation
 */

/** Default backend feature loader for provider-token and its service. */
export default createBackendFeatureLoader({
  *loader() {
    yield providerTokenPlugin;
    yield providerTokenOperationsFactory;
  },
});

/** @public */
export { default as providerTokenPlugin } from './plugin';
/** @public */
export { providerTokenOperationsFactory } from './service';
