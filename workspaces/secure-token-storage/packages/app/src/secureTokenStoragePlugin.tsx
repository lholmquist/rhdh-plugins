/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  createFrontendPlugin,
  createRouteRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import VpnKeyIcon from '@mui/icons-material/VpnKey';

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

export const secureTokenStoragePlugin = createFrontendPlugin({
  pluginId: 'secure-token-storage',
  extensions: [secureTokenStoragePage],
  routes: {
    root: rootRouteRef,
  },
});
