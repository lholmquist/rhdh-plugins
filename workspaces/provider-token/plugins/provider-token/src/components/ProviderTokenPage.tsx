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
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ProviderTokenClient,
  ProviderTokenUiError,
  type ProviderTokenUiConsentSession,
  type ProviderTokenUiConnection,
  type ProviderTokenUiGrant,
} from '../api/ProviderTokenClient';

interface CallbackState {
  sessionId?: string;
  status?: string;
}

function readCallbackState(): CallbackState {
  const query = new URLSearchParams(window.location.search);
  return {
    sessionId: query.get('sessionId') ?? undefined,
    status: query.get('status') ?? undefined,
  };
}

function providerTitle(provider: string): string {
  switch (provider) {
    case 'github':
      return 'GitHub';
    case 'microsoft':
      return 'Microsoft';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

function errorMessage(error: unknown, action: string): string {
  const code =
    error instanceof ProviderTokenUiError ? error.code : 'provider-unavailable';
  switch (code) {
    case 'permission-denied':
      return 'You do not have permission to perform this action. Contact your administrator.';
    case 'provider-not-configured':
      return 'This provider-token feature or provider is not configured. Ask your administrator to enable it.';
    case 'connect-session-expired':
      return 'This connection request expired. Start a new provider connection.';
    case 'connect-session-consumed':
      return 'This connection request was already used. Refresh the page to see its current status.';
    case 'connection-not-found':
      return 'This connection is no longer available. Refresh the page and try again.';
    case 'invalid-request':
      return 'The request is invalid. Check the selected provider, client, and scopes.';
    case 'provider-unavailable':
      return `Unable to ${action} because the provider-token backend is unavailable. Check that it is running and enabled, then retry.`;
    default:
      return `Unable to ${action}. Refresh the page and try again.`;
  }
}

function grantStatus(
  grant: ProviderTokenUiGrant,
): 'Active' | 'Expired' | 'Revoked' {
  if (grant.revokedAt) return 'Revoked';
  return grant.expiresAt.getTime() <= Date.now() ? 'Expired' : 'Active';
}

function grantStatusColor(
  status: 'Active' | 'Expired' | 'Revoked',
): 'success' | 'warning' | 'default' {
  if (status === 'Active') return 'success';
  if (status === 'Expired') return 'warning';
  return 'default';
}

/** Renders safe provider connection, consent, and grant management controls. */
export function ProviderTokenPage() {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const client = useMemo(
    () => new ProviderTokenClient(discoveryApi, fetchApi),
    [discoveryApi, fetchApi],
  );
  const [callbackState, setCallbackState] = useState(readCallbackState);
  const [consentSession, setConsentSession] = useState<
    ProviderTokenUiConsentSession | undefined
  >();
  const [providers, setProviders] = useState<string[]>([]);
  const [clients, setClients] = useState<
    Array<{
      id: string;
      title: string;
      purpose: string;
      providerScopes: Record<string, string[]>;
    }>
  >([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [connections, setConnections] = useState<ProviderTokenUiConnection[]>(
    [],
  );
  const [grants, setGrants] = useState<ProviderTokenUiGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const selectedClientOption = clients.find(
    clientOption => clientOption.id === selectedClient,
  );
  const requestedScopes =
    selectedClientOption?.providerScopes[selectedProvider] ?? [];

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [options, loadedConnections, loadedGrants] = await Promise.all([
        client.getConnectOptions(),
        client.listConnections(),
        client.listGrants(),
      ]);
      setProviders(options.providers);
      setClients(options.clients);
      setSelectedProvider(current =>
        options.providers.includes(current)
          ? current
          : options.providers[0] ?? '',
      );
      setSelectedClient(current =>
        options.clients.some(option => option.id === current)
          ? current
          : options.clients[0]?.id ?? '',
      );
      setConnections(loadedConnections);
      setGrants(loadedGrants);
    } catch (loadError) {
      setError(errorMessage(loadError, 'load provider-token data'));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    if (callbackState.status === 'provider-denied') {
      setMessage(
        'The provider authorization was cancelled. No grant was created.',
      );
    } else if (callbackState.status === 'callback-error') {
      setError(
        'Provider authorization could not be completed. Start a new connection.',
      );
    } else if (
      callbackState.status === 'consent-required' &&
      callbackState.sessionId
    ) {
      client
        .getConnectSession(callbackState.sessionId)
        .then(session => {
          if (!cancelled) setConsentSession(session);
        })
        .catch(sessionError => {
          if (!cancelled) {
            setError(errorMessage(sessionError, 'load the consent request'));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [callbackState, client]);

  const clearCallback = () => {
    window.history.replaceState({}, document.title, window.location.pathname);
    setCallbackState({});
  };

  const connect = async () => {
    setPendingAction('connect');
    setError(undefined);
    setMessage(undefined);
    if (!selectedProvider || !selectedClient || requestedScopes.length === 0) {
      setError(
        'Choose a provider and workflow client with scopes configured in app-config.',
      );
      setPendingAction(undefined);
      return;
    }
    try {
      const result = await client.startConnect({
        provider: selectedProvider,
        clientId: selectedClient,
        returnUrl: `${window.location.origin}${window.location.pathname}`,
      });
      window.location.assign(result.authorizationUrl);
    } catch (connectError) {
      setError(errorMessage(connectError, 'start the provider connection'));
      setPendingAction(undefined);
    }
  };

  const decide = async (decision: 'approve' | 'deny') => {
    if (!consentSession) return;
    setPendingAction(decision);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await client.decideConnectSession(
        consentSession.sessionId,
        decision,
      );
      setConsentSession(current =>
        current
          ? {
              ...current,
              consentStatus: result.consentStatus,
              ...(result.grantId && { grantId: result.grantId }),
            }
          : current,
      );
      setMessage(
        decision === 'approve'
          ? `Provider access approved${
              result.grantId ? `. Grant ${result.grantId} is ready.` : '.'
            }`
          : 'Provider access was rejected.',
      );
      clearCallback();
      await loadData();
    } catch (decisionError) {
      setError(
        errorMessage(
          decisionError,
          decision === 'approve'
            ? 'approve provider access'
            : 'reject provider access',
        ),
      );
    } finally {
      setPendingAction(undefined);
    }
  };

  const revoke = async (grant: ProviderTokenUiGrant) => {
    setPendingAction(`revoke:${grant.grantId}`);
    setError(undefined);
    setMessage(undefined);
    try {
      await client.revokeGrant(grant.grantId);
      setMessage(`Revoked the ${providerTitle(grant.provider)} grant.`);
      await loadData();
    } catch (revokeError) {
      setError(errorMessage(revokeError, 'revoke this grant'));
    } finally {
      setPendingAction(undefined);
    }
  };

  const disconnect = async (provider: string) => {
    setPendingAction(`disconnect:${provider}`);
    setError(undefined);
    setMessage(undefined);
    try {
      await client.disconnectProvider(provider);
      setMessage(
        `Disconnected ${providerTitle(provider)} and revoked its grants.`,
      );
      await loadData();
    } catch (disconnectError) {
      setError(errorMessage(disconnectError, 'disconnect this provider'));
    } finally {
      setPendingAction(undefined);
    }
  };

  const activeConsent = consentSession?.consentStatus === 'pending';
  const showConsentLoad =
    callbackState.status === 'consent-required' && !consentSession && !error;

  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={2}
      >
        <Box>
          <Typography component="h1" variant="h4" gutterBottom>
            Provider connections
          </Typography>
          <Typography color="text.secondary">
            Manage provider access that trusted background workflows may use.
            Tokens stay in the backend and are never shown here.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          onClick={() => void loadData()}
          disabled={loading || Boolean(pendingAction)}
        >
          Refresh
        </Button>
      </Stack>

      {message && (
        <Alert severity="success" role="status" sx={{ mt: 2 }}>
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" role="alert" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {callbackState.status &&
        callbackState.status !== 'consent-required' &&
        callbackState.status !== 'provider-denied' &&
        callbackState.status !== 'callback-error' && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            This provider response could not be verified. Start a new
            connection.
          </Alert>
        )}

      {activeConsent && consentSession && (
        <Paper
          component="section"
          aria-labelledby="consent-heading"
          sx={{ mt: 3, p: 3 }}
        >
          <Typography
            id="consent-heading"
            component="h2"
            variant="h5"
            gutterBottom
          >
            Approve provider access
          </Typography>
          <Typography>
            <strong>{consentSession.clientTitle}</strong> is requesting access
            to <strong>{providerTitle(consentSession.provider)}</strong>.
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {consentSession.purpose}
          </Typography>
          <Typography sx={{ mt: 2 }}>
            Requested scopes: {consentSession.scopes.join(', ')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Client: {consentSession.clientTitle} ({consentSession.clientId}) ·
            Caller: {consentSession.callerSubject} · Request expires:{' '}
            {consentSession.expiresAt.toLocaleString()}
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
            <Button
              variant="contained"
              onClick={() => void decide('approve')}
              disabled={Boolean(pendingAction)}
            >
              {pendingAction === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => void decide('deny')}
              disabled={Boolean(pendingAction)}
            >
              {pendingAction === 'deny' ? 'Rejecting…' : 'Reject'}
            </Button>
          </Stack>
        </Paper>
      )}

      {consentSession?.consentStatus === 'approved' && (
        <Alert severity="success" sx={{ mt: 3 }}>
          This request was already approved
          {consentSession.grantId ? ` · Grant ${consentSession.grantId}` : ''}.
        </Alert>
      )}
      {consentSession?.consentStatus === 'denied' && (
        <Alert severity="info" sx={{ mt: 3 }}>
          Provider access was rejected. No grant was created.
        </Alert>
      )}
      {showConsentLoad && (
        <Paper sx={{ mt: 3, p: 3 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <CircularProgress size={22} />
            <Typography>Loading provider consent details…</Typography>
          </Stack>
        </Paper>
      )}

      <Paper
        component="section"
        aria-labelledby="connect-heading"
        sx={{ mt: 3, p: 3 }}
      >
        <Typography
          id="connect-heading"
          component="h2"
          variant="h5"
          gutterBottom
        >
          Connect a provider
        </Typography>
        {providers.length === 0 || clients.length === 0 ? (
          <Typography color="text.secondary">
            No provider adapters or workflow clients are configured. Ask your
            administrator to enable the feature and configure a provider and
            client before connecting.
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ maxWidth: 680 }}>
            <FormControl fullWidth>
              <InputLabel id="provider-select-label">Provider</InputLabel>
              <Select
                labelId="provider-select-label"
                label="Provider"
                value={selectedProvider}
                onChange={event => setSelectedProvider(event.target.value)}
                disabled={Boolean(pendingAction)}
              >
                {providers.map(provider => (
                  <MenuItem key={provider} value={provider}>
                    {providerTitle(provider)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="client-select-label">Workflow client</InputLabel>
              <Select
                labelId="client-select-label"
                label="Workflow client"
                value={selectedClient}
                onChange={event => setSelectedClient(event.target.value)}
                disabled={Boolean(pendingAction)}
              >
                {clients.map(clientOption => (
                  <MenuItem key={clientOption.id} value={clientOption.id}>
                    {clientOption.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Requested scopes
              </Typography>
              {requestedScopes.length > 0 ? (
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {requestedScopes.map(scope => (
                    <Chip key={scope} label={scope} size="small" />
                  ))}
                </Stack>
              ) : (
                <Alert severity="warning">
                  No scopes are configured for this provider and workflow
                  client. Ask your administrator to add{' '}
                  <code>providerScopes.{selectedProvider}</code> under this
                  client in app-config.
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                These scopes are managed by the application administrator. You
                can review them again before approving access.
              </Typography>
            </Box>
            <Box>
              <Button
                variant="contained"
                onClick={() => void connect()}
                disabled={
                  loading ||
                  Boolean(pendingAction) ||
                  requestedScopes.length === 0
                }
              >
                {pendingAction === 'connect'
                  ? 'Opening provider…'
                  : 'Connect provider'}
              </Button>
            </Box>
          </Stack>
        )}
      </Paper>

      <Paper
        component="section"
        aria-labelledby="connections-heading"
        sx={{ mt: 3, p: 3 }}
      >
        <Typography
          id="connections-heading"
          component="h2"
          variant="h5"
          gutterBottom
        >
          Connected providers
        </Typography>
        {loading && (
          <CircularProgress
            size={24}
            aria-label="Loading provider connections"
          />
        )}
        {!loading && !error && connections.length === 0 && (
          <Typography color="text.secondary">
            No provider connections yet.
          </Typography>
        )}
        {!loading && connections.length > 0 && (
          <Stack spacing={2}>
            {connections.map(connection => (
              <Box
                key={connection.provider}
                sx={{
                  display: 'flex',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  justifyContent: 'space-between',
                  gap: 2,
                  flexDirection: { xs: 'column', sm: 'row' },
                }}
              >
                <Box>
                  <Typography fontWeight="bold">
                    {providerTitle(connection.provider)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Scopes: {connection.scopes.join(', ')} · Connected:{' '}
                    {connection.connectedAt.toLocaleString()}
                  </Typography>
                </Box>
                <Button
                  color="error"
                  variant="outlined"
                  onClick={() => void disconnect(connection.provider)}
                  disabled={Boolean(pendingAction)}
                >
                  {pendingAction === `disconnect:${connection.provider}`
                    ? 'Disconnecting…'
                    : `Disconnect ${providerTitle(connection.provider)}`}
                </Button>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper
        component="section"
        aria-labelledby="grants-heading"
        sx={{ mt: 3, p: 3 }}
      >
        <Typography
          id="grants-heading"
          component="h2"
          variant="h5"
          gutterBottom
        >
          Provider grants
        </Typography>
        {loading && (
          <CircularProgress size={24} aria-label="Loading provider grants" />
        )}
        {!loading && !error && grants.length === 0 && (
          <Typography color="text.secondary">
            No provider grants yet.
          </Typography>
        )}
        {!loading && grants.length > 0 && (
          <Stack spacing={2}>
            {grants.map(grant => {
              const status = grantStatus(grant);
              const clientTitle =
                clients.find(option => option.id === grant.clientId)?.title ??
                grant.clientId;
              return (
                <Box
                  key={grant.grantId}
                  sx={{
                    display: 'flex',
                    alignItems: { xs: 'flex-start', sm: 'center' },
                    justifyContent: 'space-between',
                    gap: 2,
                    flexDirection: { xs: 'column', sm: 'row' },
                    borderBottom: 1,
                    borderColor: 'divider',
                    pb: 2,
                  }}
                >
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography fontWeight="bold">
                        {providerTitle(grant.provider)} · Grant {grant.grantId}
                      </Typography>
                      <Chip
                        label={status}
                        size="small"
                        color={grantStatusColor(status)}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Client: {clientTitle} ({grant.clientId}) · Caller:{' '}
                      {grant.callerSubject}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Scopes: {grant.scopes.join(', ')} · Expires:{' '}
                      {grant.expiresAt.toLocaleString()}
                    </Typography>
                  </Box>
                  {status !== 'Revoked' && (
                    <Button
                      color="error"
                      variant="outlined"
                      onClick={() => void revoke(grant)}
                      disabled={Boolean(pendingAction)}
                    >
                      {pendingAction === `revoke:${grant.grantId}`
                        ? 'Revoking…'
                        : 'Revoke grant'}
                    </Button>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
