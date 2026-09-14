/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createApp } from '@backstage/frontend-defaults';
import {
  createFrontendModule,
  githubAuthApiRef,
} from '@backstage/frontend-plugin-api';
import { SignInPage } from '@backstage/core-components';
import {
  SignInPageBlueprint,
  type SignInPageProps,
} from '@backstage/plugin-app-react';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import orchestratorPlugin, {
  orchestratorTranslationsModule,
} from '@red-hat-developer-hub/backstage-plugin-orchestrator';
import orchestratorFormWidgetsPlugin from '@red-hat-developer-hub/backstage-plugin-orchestrator-form-widgets';
import { rhdhThemeModule } from '@red-hat-developer-hub/backstage-plugin-theme/alpha';
import { secureTokenStoragePlugin } from './secureTokenStoragePlugin';

const signInPageExtension = SignInPageBlueprint.make({
  params: {
    loader: async () => (props: SignInPageProps) =>
      (
        <SignInPage
          {...props}
          auto
          providers={[
            'guest',
            {
              id: 'github-auth-provider',
              title: 'GitHub',
              message: 'Sign in using GitHub',
              apiRef: githubAuthApiRef,
            },
          ]}
        />
      ),
  },
});

const signInModule = createFrontendModule({
  pluginId: 'app',
  extensions: [signInPageExtension],
});

export default createApp({
  features: [
    rhdhThemeModule,
    catalogPlugin,
    userSettingsPlugin,
    orchestratorPlugin,
    orchestratorTranslationsModule,
    orchestratorFormWidgetsPlugin,
    signInModule,
    secureTokenStoragePlugin,
  ],
});
