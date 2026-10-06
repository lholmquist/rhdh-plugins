import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
backend.add(
  import('@red-hat-developer-hub/backstage-plugin-provider-token-backend'),
);
backend.add(
  import(
    '@red-hat-developer-hub/backstage-plugin-provider-token-backend-module-github'
  ),
);
backend.add(
  import(
    '@red-hat-developer-hub/backstage-plugin-provider-token-backend-module-microsoft'
  ),
);

backend.start();
