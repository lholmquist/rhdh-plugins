import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { providerTokenExtensionPoint } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { MicrosoftProviderTokenAdapter } from './adapter';

/**
 * @public
 */
const providerTokenMicrosoftModule = createBackendModule({
  pluginId: 'provider-token',
  moduleId: 'microsoft',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        providerToken: providerTokenExtensionPoint,
      },
      async init({ config, providerToken }) {
        if (!config.getOptionalBoolean('providerToken.enabled')) return;
        const providerConfig = config.getOptionalConfig(
          'providerToken.providers.microsoft',
        );
        if (!providerConfig) return;
        providerToken.addProviderAdapter(
          new MicrosoftProviderTokenAdapter({
            clientId: providerConfig.getString('clientId'),
            clientSecret: providerConfig.getString('clientSecret'),
            tenant: providerConfig.getString('tenant'),
            authorizationUrl:
              providerConfig.getOptionalString('authorizationUrl'),
            tokenUrl: providerConfig.getOptionalString('tokenUrl'),
          }),
        );
      },
    });
  },
});

export default providerTokenMicrosoftModule;
