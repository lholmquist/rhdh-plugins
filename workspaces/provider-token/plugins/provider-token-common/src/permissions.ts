import { createPermission } from '@backstage/plugin-permission-common';

/** Permission required to issue an access token from an approved grant. @public */
export const providerTokenTokenIssuePermission = createPermission({
  name: 'provider-token.token.issue',
  attributes: { action: 'create' },
});

/** Permission required to read grant metadata. @public */
export const providerTokenGrantReadPermission = createPermission({
  name: 'provider-token.grant.read',
  attributes: { action: 'read' },
});

/** Permission required to revoke a grant. @public */
export const providerTokenGrantRevokePermission = createPermission({
  name: 'provider-token.grant.revoke',
  attributes: { action: 'delete' },
});

/** Permission required to start a connection and decide user consent. @public */
export const providerTokenConnectPermission = createPermission({
  name: 'provider-token.connect',
  attributes: { action: 'create' },
});

/** Permission required to disconnect an owned provider connection. @public */
export const providerTokenProviderDisconnectPermission = createPermission({
  name: 'provider-token.provider.disconnect',
  attributes: { action: 'delete' },
});

/** All permissions exported by provider-token for backend registration. @public */
export const providerTokenPermissions = [
  providerTokenTokenIssuePermission,
  providerTokenGrantReadPermission,
  providerTokenGrantRevokePermission,
  providerTokenConnectPermission,
  providerTokenProviderDisconnectPermission,
];
