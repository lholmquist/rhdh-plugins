/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { DefaultProviderSettings } from '@backstage/plugin-user-settings';
import { WorkflowProviderConnections } from './WorkflowProviderConnections';
import { AuthenticationProvidersSettings } from './AuthenticationProvidersSettings';

jest.mock('@backstage/core-plugin-api', () => ({
  configApiRef: Symbol('configApiRef'),
  useApi: jest.fn(),
}));

jest.mock('@backstage/plugin-user-settings', () => ({
  DefaultProviderSettings: jest.fn(() => null),
}));

jest.mock('./WorkflowProviderConnections', () => ({
  WorkflowProviderConnections: jest.fn(() => null),
}));

describe('AuthenticationProvidersSettings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    (useApi as jest.Mock).mockReturnValue({
      getOptionalConfig: jest.fn().mockReturnValue({
        keys: () => ['github', 'guest'],
      }),
    });
    (DefaultProviderSettings as jest.Mock).mockClear();
    (WorkflowProviderConnections as jest.Mock).mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps default authentication rows separate from workflow connections', async () => {
    await act(async () => {
      root.render(<AuthenticationProvidersSettings />);
    });

    expect(useApi).toHaveBeenCalledWith(configApiRef);
    expect((DefaultProviderSettings as jest.Mock).mock.calls[0][0]).toEqual({
      configuredProviders: ['github', 'guest'],
    });
    expect((WorkflowProviderConnections as jest.Mock).mock.calls[0][0]).toEqual(
      { variant: 'section' },
    );
  });
});
