/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(
  import(
    '@red-hat-developer-hub/backstage-plugin-secure-token-storage-backend'
  ),
);

backend.start();
