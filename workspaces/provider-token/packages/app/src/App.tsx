import { createApp } from '@backstage/frontend-defaults';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPage } from '@backstage/core-components';
import {
  SignInPageBlueprint,
  type SignInPageProps,
} from '@backstage/plugin-app-react';
import providerTokenPlugin from '@red-hat-developer-hub/backstage-plugin-provider-token';

const signInPageExtension = SignInPageBlueprint.make({
  params: {
    loader: async () => (props: SignInPageProps) =>
      <SignInPage {...props} auto providers={['guest']} />,
  },
});

const signInModule = createFrontendModule({
  pluginId: 'app',
  extensions: [signInPageExtension],
});

export default createApp({
  features: [providerTokenPlugin, signInModule],
});
