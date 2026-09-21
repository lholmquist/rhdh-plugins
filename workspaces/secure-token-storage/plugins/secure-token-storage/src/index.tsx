/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
/**
 * Secure token storage frontend plugin.
 *
 * @packageDocumentation
 */
import {
  createFrontendPlugin,
  createRouteRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import { unstable_ClassNameGenerator as ClassNameGenerator } from '@mui/material/className';

ClassNameGenerator.configure(componentName =>
  componentName.startsWith('v5-') ? componentName : `v5-${componentName}`,
);

const rootRouteRef = createRouteRef();

const secureTokenStoragePage = PageBlueprint.make({
  params: {
    path: '/secure-token-storage',
    title: 'Provider connections',
    icon: <VpnKeyIcon fontSize="inherit" />,
    routeRef: rootRouteRef,
    loader: () =>
      import('./components/SecureTokenStoragePage').then(
        ({ SecureTokenStoragePage: Page }) => <Page />,
      ),
  },
});

/**
 * The secure token storage plugin for the new Backstage frontend system.
 *
 * @public
 */
const secureTokenStoragePlugin = createFrontendPlugin({
  pluginId: 'secure-token-storage',
  info: { packageJson: () => import('../package.json') },
  extensions: [secureTokenStoragePage],
  routes: {
    root: rootRouteRef,
  },
});

export { secureTokenStoragePlugin };
export default secureTokenStoragePlugin;
