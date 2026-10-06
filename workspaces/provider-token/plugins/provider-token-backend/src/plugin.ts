import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { providerTokenPermissions } from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import {
  providerTokenOperationsRef,
  providerTokenExtensionPoint,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { addProviderTokenAdapter } from './adapters';
import { createRouter } from './router';

/**
 * Backend entry point for the provider-token prototype.
 *
 * @public
 */
const providerTokenPlugin = createBackendPlugin({
  pluginId: 'provider-token',
  register(env) {
    env.registerExtensionPoint(providerTokenExtensionPoint, {
      addProviderAdapter(adapter) {
        addProviderTokenAdapter(adapter);
      },
    });
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        providerToken: providerTokenOperationsRef,
      },
      async init({
        config,
        httpAuth,
        httpRouter,
        logger,
        permissions,
        permissionsRegistry,
        providerToken,
      }) {
        permissionsRegistry.addPermissions(providerTokenPermissions);
        const enabled =
          config.getOptionalBoolean('providerToken.enabled') ?? false;
        if (!enabled) {
          logger.info('Provider-token is disabled; storage schema is ready');
          return;
        }
        // OAuth redirects do not carry Backstage credentials; the service validates state and PKCE.
        httpRouter.addAuthPolicy({
          path: '/v1/connect/callback',
          allow: 'unauthenticated',
        });
        httpRouter.use(
          createRouter({
            httpAuth,
            permissions,
            service: providerToken,
          }),
        );
        logger.info('Provider-token storage and encryption are initialized');
      },
    });
  },
});

export default providerTokenPlugin;
