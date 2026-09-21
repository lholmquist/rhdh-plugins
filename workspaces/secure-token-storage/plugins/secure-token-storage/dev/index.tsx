/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import '@backstage/cli/asset-types';

import { createApp } from '@backstage/frontend-defaults';
import ReactDOM from 'react-dom/client';
import secureTokenStoragePlugin from '../src';

const app = createApp({
  features: [secureTokenStoragePlugin],
});

if (window.location.pathname === '/') {
  window.location.pathname = '/secure-token-storage';
}

ReactDOM.createRoot(document.getElementById('root')!).render(app.createRoot());
