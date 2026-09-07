/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import '@backstage/cli/asset-types';
import ReactDOM from 'react-dom/client';
import '@backstage/ui/css/styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(App.createRoot());
