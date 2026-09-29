/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { DefaultProviderSettings } from '@backstage/plugin-user-settings';
import { WorkflowProviderConnections } from './WorkflowProviderConnections';

/** Combines ordinary auth-provider rows with separate workflow connections. */
export function AuthenticationProvidersSettings() {
  const configApi = useApi(configApiRef);
  const configuredProviders =
    configApi.getOptionalConfig('auth.providers')?.keys() ?? [];

  return (
    <>
      <DefaultProviderSettings configuredProviders={configuredProviders} />
      <WorkflowProviderConnections variant="section" />
    </>
  );
}
