/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  coreExtensionData,
  createExtension,
  createFrontendModule,
} from '@backstage/frontend-plugin-api';
import { AuthenticationProvidersSettings } from './components/AuthenticationProvidersSettings';

const workflowProviderSettings = createExtension({
  kind: 'provider-settings',
  name: 'secure-token-storage',
  attachTo: {
    id: 'sub-page:user-settings/auth-providers',
    input: 'providerSettings',
  },
  output: [coreExtensionData.reactElement],
  factory() {
    return [
      coreExtensionData.reactElement(<AuthenticationProvidersSettings />),
    ];
  },
});

/** Adds workflow provider controls to the Settings Authentication Providers tab.
 *
 * @public
 */
export const secureTokenStorageSettingsModule = createFrontendModule({
  pluginId: 'user-settings',
  extensions: [workflowProviderSettings],
});

export default secureTokenStorageSettingsModule;
