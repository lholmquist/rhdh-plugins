/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
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
import { useWorkflowProviderConnections } from '../hooks/useWorkflowProviderConnections';

export interface WorkflowProviderConnectionsProps {
  /**
   * Use `page` when this component owns a page, or `section` when it is
   * embedded in a larger page such as Settings.
   */
  variant?: 'page' | 'section';
}

/** Renders the reusable workflow connection, consent, and grant controls. */
export function WorkflowProviderConnections({
  variant = 'section',
}: WorkflowProviderConnectionsProps) {
  const {
    approve,
    connect,
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
  } = useWorkflowProviderConnections();
  const isPage = variant === 'page';
  const heading = isPage
    ? 'Provider connections'
    : 'Workflow provider connections';
  const headingId = 'workflow-provider-connections-heading';
  const providersToConnect = providers.filter(
    provider =>
      provider.configured &&
      (provider.reconnectRequired ||
        !provider.grants.some(grant => !grant.revokedAt)),
  );
  const providersNeedingAdminConfiguration = providers.filter(
    provider => provider.reconnectRequired && !provider.configured,
  );

  if (!loading && enabled === false) {
    if (!isPage) return null;

    return (
      <Box
        component="section"
        aria-labelledby={headingId}
        sx={{ maxWidth: 960, p: 4 }}
      >
        <Typography id={headingId} component="h1" variant="h4" gutterBottom>
          {heading}
        </Typography>
        <Alert severity="info">Secure token storage is disabled.</Alert>
      </Box>
    );
  }

  return (
    <Box
      component={isPage ? 'div' : 'li'}
      sx={isPage ? undefined : { listStyle: 'none', width: '100%' }}
    >
      <Box
        component="section"
        aria-labelledby={headingId}
        sx={isPage ? { maxWidth: 960, p: 4 } : { width: '100%' }}
      >
        <Typography
          id={headingId}
          component={isPage ? 'h1' : 'h2'}
          variant={isPage ? 'h4' : 'h5'}
          gutterBottom
        >
          {heading}
        </Typography>
        <Typography color="text.secondary" paragraph>
          These connections provide access to trusted workflow services and are
          separate from your RHDH sign-in session. Signing out of RHDH does not
          disconnect providers or revoke workflow grants. Access and refresh
          tokens remain in the backend broker.
        </Typography>

        {message && <Alert severity="success">{message}</Alert>}
        {error && (
          <Alert
            severity="error"
            sx={{ mt: 2 }}
            action={
              retryProvider ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => void connect(retryProvider)}
                  disabled={Boolean(pendingAction)}
                  aria-label={`Start a new ${retryProvider} connection`}
                >
                  Start new connection
                </Button>
              ) : undefined
            }
          >
            {error}
          </Alert>
        )}

        {!loading &&
          providersToConnect.length > 0 &&
          !consentRequest &&
          !retryProvider && (
            <Paper sx={{ mt: 3, p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Connect a provider
              </Typography>
              <Typography color="text.secondary" paragraph>
                Connect a configured provider for trusted workflow use. This
                authorization is separate from your RHDH sign-in.
              </Typography>
              <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
                {providersToConnect.map(provider => {
                  const providerName = providerDisplayName(provider.provider);
                  return (
                    <Button
                      key={provider.provider}
                      variant="contained"
                      onClick={() => void connect(provider.provider)}
                      disabled={Boolean(pendingAction)}
                      aria-label={`${
                        provider.reconnectRequired ? 'Reconnect' : 'Connect'
                      } ${providerName} for workflow access`}
                    >
                      {pendingAction === `connect:${provider.provider}`
                        ? `Opening ${providerName}…`
                        : `${
                            provider.reconnectRequired ? 'Reconnect' : 'Connect'
                          } ${providerName}`}
                    </Button>
                  );
                })}
              </Stack>
              {providersToConnect.map(provider => (
                <Typography
                  key={`${provider.provider}-status`}
                  color="text.secondary"
                  variant="body2"
                  sx={{ mt: 1 }}
                >
                  {providerDisplayName(provider.provider)}:{' '}
                  {provider.connected ? 'connected' : 'not connected'}
                  {provider.reconnectRequired ? ' · reconnection required' : ''}
                </Typography>
              ))}
            </Paper>
          )}

        {!loading && !providers.some(provider => provider.configured) && (
          <Alert severity="info" sx={{ mt: 3 }}>
            No OAuth providers are configured for workflow connections.
          </Alert>
        )}
        {!loading && providersNeedingAdminConfiguration.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Workflow access for{' '}
            {providersNeedingAdminConfiguration
              .map(provider => providerDisplayName(provider.provider))
              .join(', ')}{' '}
            needs reconnection, but the provider is not configured on the
            backend. Contact your RHDH administrator.
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
                onClick={() => void approve()}
                disabled={Boolean(pendingAction)}
                aria-label={`Approve ${consentRequest.provider} workflow access`}
              >
                {pendingAction === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => void reject()}
                disabled={Boolean(pendingAction)}
                aria-label={`Reject ${consentRequest.provider} workflow access`}
              >
                {pendingAction === 'reject' ? 'Rejecting…' : 'Reject'}
              </Button>
            </Stack>
          </Paper>
        )}

        <Paper
          component="section"
          aria-labelledby="active-workflow-grants"
          sx={{ mt: 3, p: 3 }}
        >
          <Typography id="active-workflow-grants" variant="h6" gutterBottom>
            Active workflow grants
          </Typography>
          <Typography color="text.secondary" paragraph>
            These grants authorize workflows to use a connected provider. They
            do not sign you in to RHDH. After OAuth completes, approve requested
            workflow access here.
          </Typography>
          {loading && (
            <CircularProgress size={24} aria-label="Loading workflow grants" />
          )}
          {!loading && grants.length === 0 && (
            <Typography color="text.secondary">No grants found.</Typography>
          )}
          {!loading && grants.length > 0 && (
            <List disablePadding>
              {grants.map(grant => (
                <Box
                  key={grant.grantId}
                  component="li"
                  sx={{ listStyle: 'none' }}
                >
                  <ListItem
                    component="div"
                    disableGutters
                    secondaryAction={
                      <Stack direction="row" spacing={1}>
                        {new Date(grant.expiresAt).getTime() <= Date.now() && (
                          <Button
                            onClick={() => void refresh(grant)}
                            disabled={Boolean(pendingAction)}
                            aria-label={`Refresh ${grant.provider} workflow grant ${grant.grantId}`}
                          >
                            {pendingAction === `refresh:${grant.grantId}`
                              ? 'Refreshing…'
                              : 'Refresh'}
                          </Button>
                        )}
                        <Button
                          color="error"
                          onClick={() => void revoke(grant)}
                          disabled={Boolean(pendingAction)}
                          aria-label={`Revoke ${grant.provider} workflow grant ${grant.grantId}`}
                        >
                          {pendingAction === grant.grantId
                            ? 'Revoking…'
                            : 'Revoke'}
                        </Button>
                      </Stack>
                    }
                  >
                    <ListItemText
                      primary={grant.provider}
                      secondary={`Grant ID: ${
                        grant.grantId
                      } · Scopes: ${grant.scopes.join(
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
                    aria-label={`Disconnect ${grant.provider} workflow connection`}
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
    </Box>
  );
}

function providerDisplayName(provider: string): string {
  const knownProviderNames: Record<string, string> = {
    github: 'GitHub',
    microsoft: 'Microsoft',
  };
  return (
    knownProviderNames[provider] ??
    provider
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}
