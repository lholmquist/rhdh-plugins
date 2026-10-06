import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';

import { rootRouteRef } from './routes';

const ProviderTokenIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
    <path
      fill="currentColor"
      d="M7 14a5 5 0 1 1 4.9-6h9.1v4h-2v2h-3v-2h-4.1A5 5 0 0 1 7 14Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
    />
  </svg>
);

const providerTokenPage = PageBlueprint.make({
  params: {
    path: '/provider-token',
    routeRef: rootRouteRef,
    title: 'Provider tokens',
    icon: <ProviderTokenIcon />,
    loader: () =>
      import('./components/ProviderTokenPage').then(({ ProviderTokenPage }) => (
        <ProviderTokenPage />
      )),
  },
});

/**
 * Frontend entry point for the provider-token prototype.
 *
 * @public
 */
const providerTokenPlugin = createFrontendPlugin({
  pluginId: 'provider-token',
  extensions: [providerTokenPage],
  routes: {
    root: rootRouteRef,
  },
});

export default providerTokenPlugin;
