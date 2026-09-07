/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-signals-backend'));
backend.add(
  import('@red-hat-developer-hub/backstage-plugin-orchestrator-backend'),
);
backend.add(
  import(
    '@red-hat-developer-hub/backstage-plugin-scaffolder-backend-module-orchestrator'
  ),
);
backend.add(
  import(
    '@red-hat-developer-hub/backstage-plugin-secure-token-storage-backend'
  ),
);

backend.start();
