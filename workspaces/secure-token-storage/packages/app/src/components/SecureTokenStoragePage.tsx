/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SecureTokenStorageClient } from '../api/SecureTokenStorageClient';
import type { ProviderTokenGrant } from '../api/SecureTokenStorageClient';

interface ConsentRequest {
  sessionId: string;
  provider: string;
  scopes: string[];
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

export function SecureTokenStoragePage() {
  const fetchApi = useApi(fetchApiRef);
  const client = useMemo(
    () => new SecureTokenStorageClient(fetchApi),
    [fetchApi],
  );
  const [consentRequest] = useState(readConsentRequest);
  const [grants, setGrants] = useState<ProviderTokenGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const loadGrants = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setGrants(await client.listGrants());
    } catch {
      setError('Unable to load provider grants.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const clearConsentRequest = () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  const approve = async () => {
    if (!consentRequest) return;
    setPendingAction('approve');
    setError(undefined);
    try {
      const grant = await client.approveConnection(consentRequest.sessionId);
      setMessage(
        `Connected ${grant.provider}. Grant ${grant.grantId} is ready.`,
      );
      clearConsentRequest();
      await loadGrants();
    } catch {
      setError('Unable to approve this provider connection.');
    } finally {
      setPendingAction(undefined);
    }
  };

  const reject = async () => {
    if (!consentRequest) return;
    setPendingAction('reject');
    setError(undefined);
    try {
      await client.rejectConnection(consentRequest.sessionId);
      setMessage('Provider connection rejected.');
      clearConsentRequest();
    } catch {
      setError('Unable to reject this provider connection.');
    } finally {
      setPendingAction(undefined);
    }
  };

  const revoke = async (grant: ProviderTokenGrant) => {
    setPendingAction(grant.grantId);
    setError(undefined);
    try {
      await client.revokeGrant(grant.grantId);
      setMessage(`Revoked the ${grant.provider} grant.`);
      await loadGrants();
    } catch {
      setError('Unable to revoke this grant.');
    } finally {
      setPendingAction(undefined);
    }
  };

  const disconnect = async (provider: string) => {
    setPendingAction(`disconnect:${provider}`);
    setError(undefined);
    try {
      await client.disconnectProvider(provider);
      setMessage(`Disconnected ${provider} and revoked its grants.`);
      await loadGrants();
    } catch {
      setError(`Unable to disconnect ${provider}.`);
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <Box sx={{ maxWidth: 960, p: 4 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Provider connections
      </Typography>
      <Typography color="text.secondary" paragraph>
        Review user-approved provider access used by trusted workflow services.
        Access and refresh tokens remain in the backend broker.
      </Typography>

      {message && <Alert severity="success">{message}</Alert>}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {consentRequest && (
        <Paper sx={{ mt: 3, p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Approve {consentRequest.provider} access
          </Typography>
          <Typography color="text.secondary" paragraph>
            A trusted workflow service requested access to this provider. Only
            approve scopes you expect this workflow to use.
          </Typography>
          <Typography variant="body2">
            Requested scopes:{' '}
            {consentRequest.scopes.length > 0
              ? consentRequest.scopes.join(', ')
              : 'provider-defined scopes'}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
            <Button
              variant="contained"
              onClick={approve}
              disabled={Boolean(pendingAction)}
            >
              {pendingAction === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              onClick={reject}
              disabled={Boolean(pendingAction)}
            >
              {pendingAction === 'reject' ? 'Rejecting…' : 'Reject'}
            </Button>
          </Stack>
        </Paper>
      )}

      <Paper sx={{ mt: 3, p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Active grants
        </Typography>
        <Typography color="text.secondary" paragraph>
          Connections are initiated by a trusted service. After the OAuth
          callback completes, Backstage redirects here for user consent.
        </Typography>
        {loading && <CircularProgress size={24} />}
        {!loading && grants.length === 0 && (
          <Typography color="text.secondary">No grants found.</Typography>
        )}
        {!loading && grants.length > 0 && (
          <List disablePadding>
            {grants.map(grant => (
              <Box key={grant.grantId}>
                <ListItem
                  disableGutters
                  secondaryAction={
                    <Button
                      color="error"
                      onClick={() => void revoke(grant)}
                      disabled={Boolean(pendingAction)}
                    >
                      Revoke
                    </Button>
                  }
                >
                  <ListItemText
                    primary={grant.provider}
                    secondary={`Scopes: ${grant.scopes.join(
                      ', ',
                    )} · Expires: ${new Date(
                      grant.expiresAt,
                    ).toLocaleString()}`}
                  />
                </ListItem>
                <Button
                  size="small"
                  onClick={() => void disconnect(grant.provider)}
                  disabled={Boolean(pendingAction)}
                >
                  Disconnect provider
                </Button>
                <Divider sx={{ my: 2 }} />
              </Box>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}
