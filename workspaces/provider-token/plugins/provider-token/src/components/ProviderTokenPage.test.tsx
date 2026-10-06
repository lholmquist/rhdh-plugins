/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { discoveryApiRef, useApi } from '@backstage/core-plugin-api';
import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProviderTokenPage } from './ProviderTokenPage';

jest.mock('@backstage/core-plugin-api', () => ({
  discoveryApiRef: Symbol('discoveryApiRef'),
  fetchApiRef: Symbol('fetchApiRef'),
  useApi: jest.fn(),
}));

const apiBaseUrl = 'http://localhost:7007/api/provider-token';
const sessionId = '2f2866f2-93e0-4c98-a303-87883ba975a5';
const authorizationUrl =
  'https://github.com/login/oauth/authorize?state=opaque';

const options = {
  providers: ['github', 'microsoft'],
  clients: [
    {
      id: 'orchestrator',
      title: 'Orchestrator',
      purpose: 'Run queued workflows with approved provider access.',
      providerScopes: { github: ['read:user', 'repo'] },
    },
  ],
};

const pendingSession = {
  sessionId,
  clientId: 'orchestrator',
  clientTitle: 'Orchestrator',
  callerSubject: 'sonataflow',
  purpose: 'Run queued workflows with approved provider access.',
  provider: 'github',
  scopes: ['read:user', 'repo'],
  expiresAt: '2026-10-04T18:00:00.000Z',
  consentStatus: 'pending',
};

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ProviderTokenPage', () => {
  const discoveryApi = {
    getBaseUrl: jest.fn().mockResolvedValue(apiBaseUrl),
  } as DiscoveryApi;
  const fetch = jest.fn();
  const fetchApi = { fetch } as FetchApi;
  let container: HTMLDivElement;
  let root: Root;
  let grants: Array<Record<string, unknown>>;
  let connections: Array<Record<string, unknown>>;
  let consentSession: Record<string, unknown>;
  let locationDescriptor: PropertyDescriptor | undefined;

  const flushPromises = async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  };

  const button = (name: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find(
      item => item.textContent?.trim() === name,
    );

  const renderPage = async (path = '/provider-token') => {
    window.history.replaceState({}, '', path);
    await act(async () => {
      root.render(<ProviderTokenPage />);
      await flushPromises();
    });
  };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    grants = [];
    connections = [];
    consentSession = { ...pendingSession };
    fetch.mockReset();
    fetch.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.replace('/api/provider-token', '');
        const method = init?.method ?? 'GET';

        if (path === '/v1/connect/options') return response(options);
        if (path === '/v1/connections') return response(connections);
        if (path === '/v1/grants') return response(grants);
        if (path === `/v1/connect/sessions/${sessionId}`) {
          return response(consentSession);
        }
        if (path === '/v1/connect/sessions' && method === 'POST') {
          return response(
            {
              sessionId,
              authorizationUrl,
              expiresAt: '2026-10-04T18:00:00.000Z',
            },
            201,
          );
        }
        if (
          path === `/v1/connect/sessions/${sessionId}/decision` &&
          method === 'POST'
        ) {
          const decision = JSON.parse(String(init?.body)).decision;
          if (decision === 'approve') {
            consentSession = {
              ...pendingSession,
              consentStatus: 'approved',
              grantId: 'grant-123',
            };
            connections = [
              {
                provider: 'github',
                scopes: ['read:user', 'repo'],
                connectedAt: '2026-10-04T12:00:00.000Z',
              },
            ];
            grants = [
              {
                grantId: 'grant-123',
                provider: 'github',
                clientId: 'orchestrator',
                callerSubject: 'sonataflow',
                scopes: ['read:user', 'repo'],
                createdAt: '2026-10-04T12:00:00.000Z',
                expiresAt: '2026-11-03T12:00:00.000Z',
                accessToken: 'must-never-render-access-token',
                refreshToken: 'must-never-render-refresh-token',
              },
            ];
          } else {
            consentSession = { ...pendingSession, consentStatus: 'denied' };
          }
          return response({
            consentStatus: decision === 'approve' ? 'approved' : 'denied',
            ...(decision === 'approve' && { grantId: 'grant-123' }),
          });
        }
        if (path === '/v1/grants/grant-123' && method === 'DELETE') {
          grants = grants.map(grant => ({
            ...grant,
            revokedAt: '2026-10-04T13:00:00.000Z',
          }));
          return new Response(null, { status: 204 });
        }
        if (path === '/v1/providers/github' && method === 'DELETE') {
          connections = [];
          grants = grants.map(grant => ({
            ...grant,
            revokedAt: '2026-10-04T13:01:00.000Z',
          }));
          return new Response(null, { status: 204 });
        }
        return response({ error: { code: 'not-found' } }, 404);
      },
    );
    (useApi as jest.Mock).mockImplementation((ref: unknown) =>
      ref === discoveryApiRef ? discoveryApi : fetchApi,
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (locationDescriptor) {
      Object.defineProperty(window, 'location', locationDescriptor);
    }
    jest.restoreAllMocks();
  });

  it('starts a configured provider connection and navigates to OAuth', async () => {
    const assign = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        assign,
        origin: 'http://localhost:3000',
        pathname: '/provider-token',
      },
    });
    await renderPage();

    expect(container.textContent).toContain('read:user');
    expect(container.textContent).toContain('repo');

    await act(async () => {
      button('Connect provider')?.click();
      await flushPromises();
    });

    expect(fetch).toHaveBeenCalledWith(
      `${apiBaseUrl}/v1/connect/sessions`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          provider: 'github',
          clientId: 'orchestrator',
          returnUrl: 'http://localhost:3000/provider-token',
        }),
      }),
    );
    expect(assign).toHaveBeenCalledWith(authorizationUrl);
  });

  it('shows safe consent details, approves, and displays a token-free grant', async () => {
    await renderPage(
      `/provider-token?sessionId=${sessionId}&status=consent-required`,
    );

    expect(container.textContent).toContain('Approve provider access');
    expect(container.textContent).toContain('Orchestrator');
    expect(container.textContent).toContain('read:user, repo');
    expect(container.textContent).toContain('queued workflows');
    expect(container.textContent).toContain('Caller: sonataflow');

    await act(async () => {
      button('Approve')?.click();
      await flushPromises();
    });

    expect(container.textContent).toContain('Grant grant-123');
    expect(container.textContent).toContain('sonataflow');
    expect(container.textContent).toContain('read:user, repo');
    expect(container.textContent).not.toContain(
      'must-never-render-access-token',
    );
    expect(container.textContent).not.toContain(
      'must-never-render-refresh-token',
    );
    expect(fetch).toHaveBeenCalledWith(
      `${apiBaseUrl}/v1/connect/sessions/${sessionId}/decision`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
  });

  it('rejects a pending consent request without creating a grant', async () => {
    await renderPage(
      `/provider-token?sessionId=${sessionId}&status=consent-required`,
    );

    await act(async () => {
      button('Reject')?.click();
      await flushPromises();
    });

    expect(container.textContent).toContain('Provider access was rejected.');
    expect(container.textContent).not.toContain('Approve provider access');
    expect(container.textContent).toContain('No provider grants yet.');
    expect(fetch).toHaveBeenCalledWith(
      `${apiBaseUrl}/v1/connect/sessions/${sessionId}/decision`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'deny' }),
      }),
    );
  });

  it('revokes a grant and disconnects the provider from the owner view', async () => {
    grants = [
      {
        grantId: 'grant-123',
        provider: 'github',
        clientId: 'orchestrator',
        callerSubject: 'sonataflow',
        scopes: ['read:user', 'repo'],
        createdAt: '2026-10-04T12:00:00.000Z',
        expiresAt: '2026-11-03T12:00:00.000Z',
      },
    ];
    connections = [
      {
        provider: 'github',
        scopes: ['read:user', 'repo'],
        connectedAt: '2026-10-04T12:00:00.000Z',
      },
    ];
    await renderPage();

    expect(container.textContent).toContain('Grant grant-123');
    expect(container.textContent).toContain('Client: Orchestrator');
    expect(container.textContent).toContain('Caller: sonataflow');

    await act(async () => {
      button('Revoke grant')?.click();
      await flushPromises();
    });
    expect(container.textContent).toContain('Revoked');
    expect(container.textContent).toContain('Disconnect GitHub');

    await act(async () => {
      button('Disconnect GitHub')?.click();
      await flushPromises();
    });

    expect(container.textContent).toContain('Disconnected GitHub');
    expect(container.textContent).toContain('No provider connections yet.');
    expect(fetch).toHaveBeenCalledWith(
      `${apiBaseUrl}/v1/grants/grant-123`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetch).toHaveBeenCalledWith(
      `${apiBaseUrl}/v1/providers/github`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('shows loading feedback while the initial requests are pending', async () => {
    fetch.mockImplementation(() => new Promise<Response>(() => {}));
    await act(async () => {
      root.render(<ProviderTokenPage />);
      await Promise.resolve();
    });

    expect(
      container.querySelector('[aria-label="Loading provider connections"]'),
    ).toBeDefined();
    expect(
      container.querySelector('[aria-label="Loading provider grants"]'),
    ).toBeDefined();
    expect(container.textContent).not.toContain('No provider grants yet.');
  });

  it('shows actionable empty and error states', async () => {
    await renderPage();
    expect(container.textContent).toContain('No provider grants yet.');
    expect(container.textContent).toContain('No provider connections yet.');

    fetch.mockRejectedValueOnce(new Error('backend unavailable'));
    await act(async () => {
      button('Refresh')?.click();
      await flushPromises();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load provider-token data',
    );
    expect(container.textContent).not.toContain('backend unavailable');
  });
});
