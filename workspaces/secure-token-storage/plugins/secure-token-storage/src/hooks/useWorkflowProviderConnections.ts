/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  discoveryApiRef,
  fetchApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SecureTokenStorageApiError,
  SecureTokenStorageClient,
} from '../api/SecureTokenStorageClient';
import type {
  ProviderTokenGrant,
  SecureTokenStorageProviderStatus,
} from '../api/SecureTokenStorageClient';

export interface ConsentRequest {
  sessionId: string;
  provider: string;
  scopes: string[];
}

const CONSENT_QUERY_PARAMS = [
  'sessionId',
  'provider',
  'scopes',
  'connectionError',
];

function callbackErrorMessage(code: string, provider: string): string {
  switch (code) {
    case 'connect-session-expired':
      return 'This provider connection request expired.';
    case 'connect-session-consumed':
      return 'This OAuth callback was already used. Start a new provider connection to continue.';
    case 'connect-session-not-found':
      return 'This provider connection request is no longer available.';
    case 'oauth-consent-denied':
      return `${provider} authorization was canceled. Start a new connection to try again.`;
    case 'oauth-exchange-failed':
      return `Unable to complete ${provider} authorization. Start a new connection to try again.`;
    case 'provider-not-configured':
      return `Workflow access for ${provider} is not configured. Contact your RHDH administrator.`;
    default:
      return 'Unable to complete the provider connection. Start a new connection to try again.';
  }
}

function canRetryConnection(code: string): boolean {
  return [
    'connect-session-expired',
    'connect-session-consumed',
    'connect-session-not-found',
    'oauth-consent-denied',
    'oauth-exchange-failed',
  ].includes(code);
}

function readCallbackFailure(): { message?: string; provider?: string } {
  const query = new URLSearchParams(window.location.search);
  const code = query.get('connectionError');
  const provider = query.get('provider');
  if (!code || !provider) return {};
  return {
    message: callbackErrorMessage(code, provider),
    provider: canRetryConnection(code) ? provider : undefined,
  };
}

function errorMessage(
  error: unknown,
  fallback: string,
): {
  message: string;
  retryProvider?: string;
  clearRequest: boolean;
} {
  if (!(error instanceof SecureTokenStorageApiError) || !error.code) {
    return { message: fallback, clearRequest: false };
  }

  const provider = new URLSearchParams(window.location.search).get('provider');
  const request = readConsentRequest();
  const providerName = request?.provider ?? provider ?? 'provider';
  const retryProvider =
    canRetryConnection(error.code) && providerName !== 'provider'
      ? providerName
      : undefined;
  return {
    message: callbackErrorMessage(error.code, providerName),
    retryProvider,
    clearRequest: [
      'connect-session-not-found',
      'connect-session-expired',
      'connect-session-consumed',
    ].includes(error.code),
  };
}

function readConsentRequest(): ConsentRequest | undefined {
  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get('sessionId');
  if (!sessionId) return undefined;

  return {
    sessionId,
    provider: query.get('provider') ?? 'provider',
    scopes: (query.get('scopes') ?? '').split(',').filter(Boolean),
  };
}

/** Owns the API calls and state for trusted workflow provider connections. */
export function useWorkflowProviderConnections() {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const client = useMemo(
    () => new SecureTokenStorageClient({ discoveryApi, fetchApi }),
    [discoveryApi, fetchApi],
  );
  const [consentRequest, setConsentRequest] = useState<
    ConsentRequest | undefined
  >(readConsentRequest);
  const [providers, setProviders] = useState<
    SecureTokenStorageProviderStatus[]
  >([]);
  const [grants, setGrants] = useState<ProviderTokenGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean>();
  const [pendingAction, setPendingAction] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [initialCallbackFailure] = useState(readCallbackFailure);
  const [error, setError] = useState<string | undefined>(
    initialCallbackFailure.message,
  );
  const [retryProvider, setRetryProvider] = useState<string | undefined>(
    initialCallbackFailure.provider,
  );
  const enabledRef = useRef<boolean | undefined>(undefined);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      let backendEnabled = enabledRef.current;
      if (backendEnabled === undefined) {
        const status = await client.getStatus();
        backendEnabled = status.enabled;
        enabledRef.current = backendEnabled;
        setEnabled(backendEnabled);
      }

      if (!backendEnabled) {
        setProviders([]);
        setGrants([]);
        return;
      }

      const loadedProviders = await client.listProviders();
      setProviders(loadedProviders);
      setGrants(
        loadedProviders
          .flatMap(provider => provider.grants)
          .filter(grant => !grant.revokedAt),
      );
    } catch {
      setError('Unable to load workflow provider status.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const clearConsentRequest = useCallback(() => {
    setConsentRequest(undefined);
    const url = new URL(window.location.href);
    CONSENT_QUERY_PARAMS.forEach(parameter =>
      url.searchParams.delete(parameter),
    );
    window.history.replaceState(
      window.history.state,
      document.title,
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const showConsentRequest = useCallback((request: ConsentRequest) => {
    setConsentRequest(request);
    const url = new URL(window.location.href);
    url.searchParams.delete('connectionError');
    url.searchParams.set('sessionId', request.sessionId);
    url.searchParams.set('provider', request.provider);
    url.searchParams.set('scopes', request.scopes.join(','));
    window.history.replaceState(
      window.history.state,
      document.title,
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const connect = useCallback(
    async (provider: string) => {
      setPendingAction(`connect:${provider}`);
      setError(undefined);
      setRetryProvider(undefined);
      clearConsentRequest();
      try {
        const connection = await client.startConnection(provider);
        // The backend creates the PKCE session and returns a one-time provider
        // URL. Navigation starts the normal provider login and consent flow
        // without requiring the user to copy a URL from a service response.
        window.location.assign(connection.authorizationUrl);
      } catch {
        setError(`Unable to start the ${provider} connection.`);
        setPendingAction(undefined);
      }
    },
    [client, clearConsentRequest],
  );

  const requestGrant = useCallback(
    async (provider: string) => {
      setPendingAction(`grant:${provider}`);
      setError(undefined);
      setMessage(undefined);
      try {
        const request = await client.requestGrantConsentFromConnection(
          provider,
        );
        showConsentRequest({
          sessionId: request.sessionId,
          provider: request.provider,
          scopes: request.scopes,
        });
      } catch (caughtError) {
        const code =
          caughtError instanceof SecureTokenStorageApiError
            ? caughtError.code
            : undefined;
        setError(
          code === 'connection-scopes-mismatch' ||
            code === 'connection-reconnect-required'
            ? `The ${provider} connection needs updated scopes or reauthorization. Reconnect the provider to continue.`
            : `Unable to request approval for a new ${provider} grant.`,
        );
        await loadProviders();
      } finally {
        setPendingAction(undefined);
      }
    },
    [client, loadProviders, showConsentRequest],
  );

  const approve = useCallback(async () => {
    if (!consentRequest) return;
    setPendingAction('approve');
    setError(undefined);
    try {
      const grant = await client.approveConnection(consentRequest.sessionId);
      setMessage(
        `Connected ${grant.provider}. Grant ${grant.grantId} is ready.`,
      );
      setRetryProvider(undefined);
      clearConsentRequest();
      await loadProviders();
    } catch (caughtError) {
      const recovery = errorMessage(
        caughtError,
        'Unable to approve this provider connection.',
      );
      if (recovery.clearRequest) clearConsentRequest();
      setError(recovery.message);
      setRetryProvider(recovery.retryProvider);
    } finally {
      setPendingAction(undefined);
    }
  }, [client, clearConsentRequest, consentRequest, loadProviders]);

  const reject = useCallback(async () => {
    if (!consentRequest) return;
    setPendingAction('reject');
    setError(undefined);
    try {
      await client.rejectConnection(consentRequest.sessionId);
      setMessage('Provider connection rejected.');
      setRetryProvider(undefined);
      clearConsentRequest();
      await loadProviders();
    } catch (caughtError) {
      const recovery = errorMessage(
        caughtError,
        'Unable to reject this provider connection.',
      );
      if (recovery.clearRequest) clearConsentRequest();
      setError(recovery.message);
      setRetryProvider(recovery.retryProvider);
    } finally {
      setPendingAction(undefined);
    }
  }, [client, clearConsentRequest, consentRequest, loadProviders]);

  const revoke = useCallback(
    async (grant: ProviderTokenGrant) => {
      setPendingAction(grant.grantId);
      setError(undefined);
      setMessage(undefined);
      let revoked = false;
      try {
        await client.revokeGrant(grant.grantId);
        revoked = true;
        const request = await client.requestGrantConsentFromConnection(
          grant.provider,
        );
        showConsentRequest({
          sessionId: request.sessionId,
          provider: request.provider,
          scopes: request.scopes,
        });
        setMessage(
          `Revoked the ${grant.provider} grant. Review the new approval request below.`,
        );
        await loadProviders();
      } catch {
        setError(
          revoked
            ? `The ${grant.provider} grant was revoked, but a new approval request could not be prepared. Reconnect if the configured scopes have changed, or request approval below.`
            : `Unable to revoke the ${grant.provider} grant.`,
        );
        await loadProviders();
      } finally {
        setPendingAction(undefined);
      }
    },
    [client, loadProviders, showConsentRequest],
  );

  const refresh = useCallback(
    async (grant: ProviderTokenGrant) => {
      setPendingAction(`refresh:${grant.grantId}`);
      setError(undefined);
      try {
        await client.refreshGrant(grant.grantId);
        setMessage(`Refreshed the ${grant.provider} grant.`);
        await loadProviders();
      } catch {
        setError('Unable to refresh this grant.');
      } finally {
        setPendingAction(undefined);
      }
    },
    [client, loadProviders],
  );

  const disconnect = useCallback(
    async (provider: string) => {
      setPendingAction(`disconnect:${provider}`);
      setError(undefined);
      setMessage(undefined);
      try {
        await client.disconnectProvider(provider);
        clearConsentRequest();
        setRetryProvider(undefined);
        setMessage(`Disconnected ${provider} and revoked its grants.`);
        await loadProviders();
      } catch {
        setError(`Unable to disconnect ${provider}.`);
      } finally {
        setPendingAction(undefined);
      }
    },
    [clearConsentRequest, client, loadProviders],
  );

  return {
    approve,
    connect,
    requestGrant,
    consentRequest,
    disconnect,
    enabled,
    error,
    grants,
    loading,
    message,
    pendingAction,
    providers,
    refresh,
    reject,
    retryProvider,
    revoke,
  };
}
