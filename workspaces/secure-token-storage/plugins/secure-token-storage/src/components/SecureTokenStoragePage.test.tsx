/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { discoveryApiRef, useApi } from '@backstage/core-plugin-api';
import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SecureTokenStoragePage } from './SecureTokenStoragePage';
import { WorkflowProviderConnections } from './WorkflowProviderConnections';

jest.mock('@backstage/core-plugin-api', () => ({
  discoveryApiRef: Symbol('discoveryApiRef'),
  fetchApiRef: Symbol('fetchApiRef'),
  useApi: jest.fn(),
}));

function providerStatus(
  provider: string,
  grants: unknown[] = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    provider,
    configured: true,
    connected: true,
    scopes: provider === 'microsoft' ? ['User.Read'] : ['repo'],
    accessTokenExpiresAt: '2026-09-08T12:00:00.000Z',
    reconnectRequired: false,
    grants,
    ...overrides,
  };
}

function backendStatus(enabled = true) {
  return new Response(JSON.stringify({ enabled }), { status: 200 });
}

describe('SecureTokenStoragePage frontend plugin page', () => {
  const discoveryApi = {
    getBaseUrl: jest
      .fn()
      .mockResolvedValue('http://localhost:7007/api/secure-token-storage'),
  } as DiscoveryApi;
  const fetch = jest.fn();
  const fetchApi = { fetch } as FetchApi;
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
    window.history.replaceState(
      {},
      '',
      '/secure-token-storage?sessionId=session-1&provider=github&scopes=repo',
    );
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(backendStatus())
      .mockResolvedValueOnce(
        new Response(JSON.stringify([providerStatus('github')]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            grantId: 'grant-1',
            provider: 'github',
            scopes: ['repo'],
            expiresAt: '2026-09-08T12:00:00.000Z',
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            providerStatus('github', [
              {
                grantId: 'grant-1',
                provider: 'github',
                scopes: ['repo'],
                expiresAt: '2026-09-08T12:00:00.000Z',
              },
            ]),
          ]),
          { status: 200 },
        ),
      );
    (useApi as jest.Mock).mockImplementation((ref: unknown) =>
      ref === discoveryApiRef ? discoveryApi : fetchApi,
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('removes the consent card after approval succeeds', async () => {
    await act(async () => {
      root.render(<SecureTokenStoragePage />);
      await Promise.resolve();
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Approve',
    );
    expect(approveButton).toBeDefined();
    expect(approveButton?.getAttribute('aria-label')).toBe(
      'Approve github workflow access',
    );

    await act(async () => {
      approveButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('Approve github access');
    expect(container.textContent).not.toContain('Connect GitHub');
    expect(container.textContent).toContain('Connected github');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('approves the pending connection from the standalone provider page', async () => {
    window.history.replaceState(
      {},
      '',
      '/secure-token-storage?sessionId=session-1&provider=github&scopes=repo',
    );

    await act(async () => {
      root.render(<SecureTokenStoragePage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Provider connections');
    expect(container.textContent).toContain('Approve github access');

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Approve',
    );
    expect(approveButton).toBeDefined();

    await act(async () => {
      approveButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('Approve github access');
    expect(container.textContent).toContain('Connected github');
    expect(window.location.pathname).toBe('/secure-token-storage');
    expect(window.location.search).toBe('');
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `${await discoveryApi.getBaseUrl(
        'secure-token-storage',
      )}/connections/session-1/consent`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
  });

  it('renders as an embeddable workflow section with distinct sign-in wording', async () => {
    window.history.replaceState({}, '', '/settings/auth-providers');
    fetch.mockReset();
    fetch.mockResolvedValueOnce(backendStatus());
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          providerStatus('github'),
          providerStatus('microsoft', [], { reconnectRequired: true }),
          providerStatus('legacy-provider', [], {
            configured: false,
            reconnectRequired: true,
          }),
        ]),
        { status: 200 },
      ),
    );

    await act(async () => {
      root.render(<WorkflowProviderConnections />);
      await Promise.resolve();
    });

    expect(container.querySelector('h2')?.textContent).toBe(
      'Workflow provider connections',
    );
    expect(container.textContent).toContain(
      'separate from your RHDH sign-in session',
    );
    expect(container.textContent).toContain(
      'Signing out of RHDH does not disconnect providers or revoke workflow grants.',
    );
    expect(
      container.querySelector(
        'button[aria-label="Connect GitHub for workflow access"]',
      ),
    ).toBeDefined();
    expect(
      container.querySelector(
        'button[aria-label="Reconnect Microsoft for workflow access"]',
      ),
    ).toBeDefined();
    expect(container.textContent).toContain('reconnection required');
    expect(container.textContent).toContain(
      'Workflow access for Legacy Provider needs reconnection, but the provider is not configured on the backend.',
    );
    expect(fetch).toHaveBeenCalledWith(
      `${await discoveryApi.getBaseUrl('secure-token-storage')}/providers`,
      undefined,
    );
    expect(container.querySelector('h1')).toBeNull();
  });

  it('restores pending consent in Settings after reload and preserves other URL state', async () => {
    window.history.replaceState(
      { settingsState: true },
      '',
      '/settings/auth-providers?sessionId=session-1&provider=github&scopes=repo&tab=providers#auth',
    );
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(backendStatus())
      .mockResolvedValueOnce(
        new Response(JSON.stringify([providerStatus('github')]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            grantId: 'grant-1',
            provider: 'github',
            scopes: ['repo'],
            expiresAt: '2026-10-08T12:00:00.000Z',
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            providerStatus('github', [
              {
                grantId: 'grant-1',
                provider: 'github',
                scopes: ['repo'],
                expiresAt: '2026-10-08T12:00:00.000Z',
              },
            ]),
          ]),
          { status: 200 },
        ),
      );

    await act(async () => {
      root.render(<WorkflowProviderConnections variant="section" />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Approve github access');
    expect(window.location.search).toContain('sessionId=session-1');

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Approve',
    );
    expect(approveButton).toBeDefined();

    await act(async () => {
      approveButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Connected github');
    expect(container.textContent).toContain('Grant ID: grant-1');
    expect(window.location.pathname).toBe('/settings/auth-providers');
    expect(window.location.search).toBe('?tab=providers');
    expect(window.location.hash).toBe('#auth');
    expect(window.history.state).toEqual({ settingsState: true });
  });

  it('rejects pending consent in Settings and returns to grant management', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings/auth-providers?sessionId=session-1&provider=github&scopes=repo',
    );
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(backendStatus())
      .mockResolvedValueOnce(
        new Response(JSON.stringify([providerStatus('github')]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([providerStatus('github')]), {
          status: 200,
        }),
      );

    await act(async () => {
      root.render(<WorkflowProviderConnections variant="section" />);
      await Promise.resolve();
    });

    const rejectButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Reject',
    );
    expect(rejectButton).toBeDefined();

    await act(async () => {
      rejectButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Provider connection rejected.');
    expect(container.textContent).not.toContain('Approve github access');
    expect(window.location.pathname).toBe('/settings/auth-providers');
    expect(window.location.search).toBe('');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('offers a new connection after the consent session expires', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings/auth-providers?sessionId=session-1&provider=github&scopes=repo',
    );
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(backendStatus())
      .mockResolvedValueOnce(
        new Response(JSON.stringify([providerStatus('github')]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'connect-session-expired' }), {
          status: 410,
        }),
      );

    await act(async () => {
      root.render(<WorkflowProviderConnections variant="section" />);
      await Promise.resolve();
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Approve',
    );
    expect(approveButton).toBeDefined();

    await act(async () => {
      approveButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'This provider connection request expired.',
    );
    expect(
      container.querySelector(
        'button[aria-label="Start a new github connection"]',
      ),
    ).toBeDefined();
    expect(window.location.search).not.toContain('sessionId=session-1');
  });

  it('shows a recovery action for a consumed OAuth callback', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings/auth-providers?provider=github&connectionError=connect-session-consumed',
    );
    fetch.mockReset();
    fetch.mockResolvedValueOnce(backendStatus()).mockResolvedValueOnce(
      new Response(JSON.stringify([providerStatus('github')]), {
        status: 200,
      }),
    );

    await act(async () => {
      root.render(<WorkflowProviderConnections variant="section" />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'This OAuth callback was already used. Start a new provider connection to continue.',
    );
    expect(
      container.querySelector(
        'button[aria-label="Start a new github connection"]',
      ),
    ).toBeDefined();
  });

  it('hides the embedded workflow section when secure token storage is disabled', async () => {
    window.history.replaceState({}, '', '/settings/auth-providers');
    fetch.mockReset();
    fetch.mockResolvedValueOnce(backendStatus(false));

    await act(async () => {
      root.render(<WorkflowProviderConnections />);
      await Promise.resolve();
    });

    expect(container.textContent).toBe('');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${await discoveryApi.getBaseUrl('secure-token-storage')}/health`,
      undefined,
    );
  });

  it('shows a disabled notice on the standalone page when storage is disabled', async () => {
    window.history.replaceState({}, '', '/secure-token-storage');
    fetch.mockReset();
    fetch.mockResolvedValueOnce(backendStatus(false));

    await act(async () => {
      root.render(<SecureTokenStoragePage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'Secure token storage is disabled.',
    );
    expect(container.textContent).not.toContain('Active workflow grants');
  });

  it('does not show a revoked grant in the active grants list', async () => {
    window.history.replaceState({}, '', '/secure-token-storage');
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(backendStatus())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            providerStatus('github', [
              {
                grantId: 'grant-1',
                provider: 'github',
                scopes: ['repo'],
                expiresAt: '2026-09-08T12:00:00.000Z',
              },
            ]),
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            providerStatus(
              'github',
              [
                {
                  grantId: 'grant-1',
                  provider: 'github',
                  scopes: ['repo'],
                  expiresAt: '2026-09-08T12:00:00.000Z',
                  revokedAt: '2026-09-08T12:01:00.000Z',
                },
              ],
              { connected: false },
            ),
          ]),
          { status: 200 },
        ),
      );

    await act(async () => {
      root.render(<SecureTokenStoragePage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Grant ID: grant-1');
    expect(
      container.querySelector(
        'button[aria-label="Disconnect github workflow connection"]',
      ),
    ).toBeDefined();

    const revokeButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Revoke',
    );
    expect(revokeButton).toBeDefined();

    await act(async () => {
      revokeButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('Scopes: repo');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('shows refresh for an expired grant and reloads it after refreshing', async () => {
    window.history.replaceState({}, '', '/secure-token-storage');
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(backendStatus())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            providerStatus('github', [
              {
                grantId: 'grant-1',
                provider: 'github',
                scopes: ['repo'],
                expiresAt: '2026-09-08T12:00:00.000Z',
              },
            ]),
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            grantId: 'grant-1',
            provider: 'github',
            scopes: ['repo'],
            expiresAt: '2026-10-08T12:00:00.000Z',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            providerStatus('github', [
              {
                grantId: 'grant-1',
                provider: 'github',
                scopes: ['repo'],
                expiresAt: '2026-10-08T12:00:00.000Z',
              },
            ]),
          ]),
          { status: 200 },
        ),
      );

    await act(async () => {
      root.render(<SecureTokenStoragePage />);
      await Promise.resolve();
    });

    const refreshButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Refresh',
    );
    expect(refreshButton).toBeDefined();
    expect(refreshButton?.getAttribute('aria-label')).toBe(
      'Refresh github workflow grant grant-1',
    );

    await act(async () => {
      refreshButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Refreshed the github grant.');
    expect(container.textContent).toContain('Expires:');
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `${await discoveryApi.getBaseUrl(
        'secure-token-storage',
      )}/grants/grant-1/refresh`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
