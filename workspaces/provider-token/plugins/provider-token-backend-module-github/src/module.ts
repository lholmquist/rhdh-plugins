import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { providerTokenExtensionPoint } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { GitHubProviderTokenAdapter } from './adapter';

/**
 * @public
 */
const providerTokenGithubModule = createBackendModule({
  pluginId: 'provider-token',
  moduleId: 'github',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        providerToken: providerTokenExtensionPoint,
      },
      async init({ config, providerToken }) {
        if (!config.getOptionalBoolean('providerToken.enabled')) return;
        const providerConfig = config.getOptionalConfig(
          'providerToken.providers.github',
        );
        if (!providerConfig) return;
        providerToken.addProviderAdapter(
          new GitHubProviderTokenAdapter({
            clientId: providerConfig.getString('clientId'),
            clientSecret: providerConfig.getString('clientSecret'),
            authorizationUrl:
              providerConfig.getOptionalString('authorizationUrl'),
            tokenUrl: providerConfig.getOptionalString('tokenUrl'),
            revocationUrl: providerConfig.getOptionalString('revocationUrl'),
          }),
        );
      },
    });
  },
});

export default providerTokenGithubModule;
