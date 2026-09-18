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

jest.mock('@backstage/core-plugin-api', () => ({
  discoveryApiRef: Symbol('discoveryApiRef'),
  fetchApiRef: Symbol('fetchApiRef'),
  useApi: jest.fn(),
}));

describe('SecureTokenStoragePage', () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
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
            {
              grantId: 'grant-1',
              provider: 'github',
              scopes: ['repo'],
              expiresAt: '2026-09-08T12:00:00.000Z',
            },
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

    await act(async () => {
      approveButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('Approve github access');
    expect(container.textContent).not.toContain('Connect GitHub');
    expect(container.textContent).toContain('Connected github');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not show a revoked grant in the active grants list', async () => {
    window.history.replaceState({}, '', '/secure-token-storage');
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              grantId: 'grant-1',
              provider: 'github',
              scopes: ['repo'],
              expiresAt: '2026-09-08T12:00:00.000Z',
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              grantId: 'grant-1',
              provider: 'github',
              scopes: ['repo'],
              expiresAt: '2026-09-08T12:00:00.000Z',
              revokedAt: '2026-09-08T12:01:00.000Z',
            },
          ]),
          { status: 200 },
        ),
      );

    await act(async () => {
      root.render(<SecureTokenStoragePage />);
      await Promise.resolve();
    });

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
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
