/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DatabaseService } from '@backstage/backend-plugin-api';
import type { ProviderTokenGrantSummary } from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type { EncryptedSecret } from '../crypto';

type DatabaseClient = Awaited<ReturnType<DatabaseService['getClient']>>;
type DatabaseDate = Date | string;

export interface StoredProviderSecret {
  id: string;
  userEntityRef: string;
  provider: string;
  refreshToken: EncryptedSecret;
  refreshTokenExpiresAt?: Date;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
}

export interface StoredGrant {
  id: string;
  userEntityRef: string;
  clientId: string;
  callerSubject: string;
  provider: string;
  secretId: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

export type ConnectSessionConsentStatus = 'pending' | 'approved' | 'denied';

export interface StoredConnectSession {
  id: string;
  stateHash: string;
  userEntityRef: string;
  clientId: string;
  callerSubject: string;
  provider: string;
  scopes: string[];
  providerScopes: string[];
  redirectUri: string;
  returnUrl: string;
  codeVerifier: EncryptedSecret;
  pendingRefreshToken?: EncryptedSecret;
  pendingRefreshTokenExpiresAt?: Date;
  pendingScopes?: string[];
  createdAt: Date;
  expiresAt: Date;
  stateConsumedAt?: Date;
  completedAt?: Date;
  consentStatus: ConnectSessionConsentStatus;
  consentDecidedAt?: Date;
  grantId?: string;
}

type ProviderSecretRow = {
  id: string;
  user_entity_ref: string;
  provider: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
  refresh_token_key_version: string;
  refresh_token_expires_at?: DatabaseDate | null;
  scopes_json: string;
  created_at: DatabaseDate;
  updated_at: DatabaseDate;
  revoked_at?: DatabaseDate | null;
};

type GrantRow = {
  id: string;
  user_entity_ref: string;
  client_id: string;
  caller_subject: string;
  provider: string;
  secret_id: string;
  scopes_json: string;
  created_at: DatabaseDate;
  expires_at: DatabaseDate;
  revoked_at?: DatabaseDate | null;
};

type ConnectSessionRow = {
  id: string;
  state_hash: string;
  user_entity_ref: string;
  client_id: string;
  caller_subject: string;
  provider: string;
  scopes_json: string;
  provider_scopes_json: string;
  redirect_uri: string;
  return_url: string;
  code_verifier_ciphertext: string;
  code_verifier_iv: string;
  code_verifier_auth_tag: string;
  code_verifier_key_version: string;
  pending_refresh_token_ciphertext?: string | null;
  pending_refresh_token_iv?: string | null;
  pending_refresh_token_auth_tag?: string | null;
  pending_refresh_token_key_version?: string | null;
  pending_refresh_token_expires_at?: DatabaseDate | null;
  pending_scopes_json?: string | null;
  created_at: DatabaseDate;
  expires_at: DatabaseDate;
  state_consumed_at?: DatabaseDate | null;
  completed_at?: DatabaseDate | null;
  consent_status: ConnectSessionConsentStatus;
  consent_decided_at?: DatabaseDate | null;
  grant_id?: string | null;
};

const asDate = (value: DatabaseDate | null | undefined): Date | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(value);
};

const fromSecretRow = (row: ProviderSecretRow): StoredProviderSecret => ({
  id: row.id,
  userEntityRef: row.user_entity_ref,
  provider: row.provider,
  refreshToken: {
    ciphertext: row.refresh_token_ciphertext,
    iv: row.refresh_token_iv,
    authTag: row.refresh_token_auth_tag,
    keyVersion: row.refresh_token_key_version,
  },
  refreshTokenExpiresAt: asDate(row.refresh_token_expires_at),
  scopes: JSON.parse(row.scopes_json) as string[],
  createdAt: asDate(row.created_at)!,
  updatedAt: asDate(row.updated_at)!,
  revokedAt: asDate(row.revoked_at),
});

const fromGrantRow = (row: GrantRow): StoredGrant => ({
  id: row.id,
  userEntityRef: row.user_entity_ref,
  clientId: row.client_id,
  callerSubject: row.caller_subject,
  provider: row.provider,
  secretId: row.secret_id,
  scopes: JSON.parse(row.scopes_json) as string[],
  createdAt: asDate(row.created_at)!,
  expiresAt: asDate(row.expires_at)!,
  revokedAt: asDate(row.revoked_at),
});

const fromConnectSessionRow = (
  row: ConnectSessionRow,
): StoredConnectSession => ({
  id: row.id,
  stateHash: row.state_hash,
  userEntityRef: row.user_entity_ref,
  clientId: row.client_id,
  callerSubject: row.caller_subject,
  provider: row.provider,
  scopes: JSON.parse(row.scopes_json) as string[],
  providerScopes: JSON.parse(row.provider_scopes_json) as string[],
  redirectUri: row.redirect_uri,
  returnUrl: row.return_url,
  codeVerifier: {
    ciphertext: row.code_verifier_ciphertext,
    iv: row.code_verifier_iv,
    authTag: row.code_verifier_auth_tag,
    keyVersion: row.code_verifier_key_version,
  },
  pendingRefreshToken:
    row.pending_refresh_token_ciphertext &&
    row.pending_refresh_token_iv &&
    row.pending_refresh_token_auth_tag &&
    row.pending_refresh_token_key_version
      ? {
          ciphertext: row.pending_refresh_token_ciphertext,
          iv: row.pending_refresh_token_iv,
          authTag: row.pending_refresh_token_auth_tag,
          keyVersion: row.pending_refresh_token_key_version,
        }
      : undefined,
  pendingRefreshTokenExpiresAt: asDate(row.pending_refresh_token_expires_at),
  pendingScopes: row.pending_scopes_json
    ? (JSON.parse(row.pending_scopes_json) as string[])
    : undefined,
  createdAt: asDate(row.created_at)!,
  expiresAt: asDate(row.expires_at)!,
  stateConsumedAt: asDate(row.state_consumed_at),
  completedAt: asDate(row.completed_at),
  consentStatus: row.consent_status,
  consentDecidedAt: asDate(row.consent_decided_at),
  grantId: row.grant_id ?? undefined,
});

/**
 * Knex-backed persistence for encrypted provider secrets, grants, and
 * one-use connection sessions. Access tokens deliberately have no storage
 * representation in this repository.
 *
 * @internal
 */
export class ProviderTokenRepository {
  constructor(private readonly database: DatabaseClient) {}

  async storeProviderSecret(
    secret: StoredProviderSecret,
  ): Promise<StoredProviderSecret> {
    const row = {
      id: secret.id,
      user_entity_ref: secret.userEntityRef,
      provider: secret.provider,
      refresh_token_ciphertext: secret.refreshToken.ciphertext,
      refresh_token_iv: secret.refreshToken.iv,
      refresh_token_auth_tag: secret.refreshToken.authTag,
      refresh_token_key_version: secret.refreshToken.keyVersion,
      refresh_token_expires_at: secret.refreshTokenExpiresAt ?? null,
      scopes_json: JSON.stringify(secret.scopes),
      created_at: secret.createdAt,
      updated_at: secret.updatedAt,
      revoked_at: secret.revokedAt ?? null,
    };

    return this.database.transaction(async transaction => {
      const existing = await transaction('provider_token_secrets')
        .where({
          user_entity_ref: secret.userEntityRef,
          provider: secret.provider,
        })
        .first<ProviderSecretRow>();

      if (existing) {
        const { id: _id, created_at: _createdAt, ...update } = row;
        void _id;
        void _createdAt;
        await transaction('provider_token_secrets')
          .where({ id: existing.id })
          .update(update);
        return fromSecretRow({ ...existing, ...update });
      }

      await transaction('provider_token_secrets').insert(row);
      return secret;
    });
  }

  async getProviderSecret(
    userEntityRef: string,
    provider: string,
  ): Promise<StoredProviderSecret | undefined> {
    const row = await this.database('provider_token_secrets')
      .where({ user_entity_ref: userEntityRef, provider })
      .first<ProviderSecretRow>();
    return row ? fromSecretRow(row) : undefined;
  }

  async getProviderSecretById(
    secretId: string,
  ): Promise<StoredProviderSecret | undefined> {
    const row = await this.database('provider_token_secrets')
      .where({ id: secretId })
      .first<ProviderSecretRow>();
    return row ? fromSecretRow(row) : undefined;
  }

  async listProviderConnectionsForUser(
    userEntityRef: string,
  ): Promise<Array<{ provider: string; scopes: string[]; connectedAt: Date }>> {
    const rows = await this.database('provider_token_secrets')
      .where({ user_entity_ref: userEntityRef })
      .whereNull('revoked_at')
      .orderBy('created_at', 'desc')
      .select<ProviderSecretRow[]>('*');
    return rows.map(row => ({
      provider: row.provider,
      scopes: JSON.parse(row.scopes_json) as string[],
      connectedAt: asDate(row.created_at)!,
    }));
  }

  /**
   * Runs an operation while holding a row lock for a provider secret. On
   * PostgreSQL this serializes refresh-token rotation across backend instances;
   * SQLite's lock is supplemented by ProviderTokenService single-flight.
   */
  async withLockedProviderSecret<T>(
    secretId: string,
    operation: (
      secret: StoredProviderSecret,
      persist: (updatedSecret: StoredProviderSecret) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T | undefined> {
    return this.database.transaction(async transaction => {
      const query = transaction('provider_token_secrets').where({
        id: secretId,
      });
      const client = String(
        (transaction.client.config as { client?: string }).client,
      );
      const rowQuery =
        client === 'pg' || client === 'postgres' || client === 'postgresql'
          ? query.forUpdate()
          : query;
      const row = await rowQuery.first<ProviderSecretRow>();
      if (!row) {
        return undefined;
      }

      const secret = fromSecretRow(row);
      const persist = async (updatedSecret: StoredProviderSecret) => {
        if (updatedSecret.id !== secretId) {
          throw new Error('A provider secret update cannot change its ID');
        }
        await transaction('provider_token_secrets')
          .where({ id: secretId })
          .update({
            refresh_token_ciphertext: updatedSecret.refreshToken.ciphertext,
            refresh_token_iv: updatedSecret.refreshToken.iv,
            refresh_token_auth_tag: updatedSecret.refreshToken.authTag,
            refresh_token_key_version: updatedSecret.refreshToken.keyVersion,
            refresh_token_expires_at:
              updatedSecret.refreshTokenExpiresAt ?? null,
            scopes_json: JSON.stringify(updatedSecret.scopes),
            updated_at: updatedSecret.updatedAt,
            revoked_at: updatedSecret.revokedAt ?? null,
          });
      };

      return operation(secret, persist);
    });
  }

  async deleteProviderSecret(secretId: string): Promise<boolean> {
    const deleted = await this.database('provider_token_secrets')
      .where({ id: secretId })
      .delete();
    return deleted > 0;
  }

  async createGrant(grant: StoredGrant): Promise<void> {
    await this.database('provider_token_grants').insert({
      id: grant.id,
      user_entity_ref: grant.userEntityRef,
      client_id: grant.clientId,
      caller_subject: grant.callerSubject,
      provider: grant.provider,
      secret_id: grant.secretId,
      scopes_json: JSON.stringify(grant.scopes),
      created_at: grant.createdAt,
      expires_at: grant.expiresAt,
      revoked_at: grant.revokedAt ?? null,
    });
  }

  async getGrant(grantId: string): Promise<StoredGrant | undefined> {
    const row = await this.database('provider_token_grants')
      .where({ id: grantId })
      .first<GrantRow>();
    return row ? fromGrantRow(row) : undefined;
  }

  async listGrantsForUser(userEntityRef: string): Promise<StoredGrant[]> {
    const rows = await this.database('provider_token_grants')
      .where({ user_entity_ref: userEntityRef })
      .orderBy('created_at', 'desc')
      .select<GrantRow[]>('*');
    return rows.map(fromGrantRow);
  }

  async listActiveGrantsForUser(
    userEntityRef: string,
    provider: string,
    now: Date,
  ): Promise<StoredGrant[]> {
    const rows = await this.database('provider_token_grants')
      .where({ user_entity_ref: userEntityRef, provider })
      .whereNull('revoked_at')
      .where('expires_at', '>', now)
      .orderBy('created_at', 'desc')
      .select<GrantRow[]>('*');
    return rows.map(fromGrantRow);
  }

  async revokeGrant(
    grantId: string,
    userEntityRef: string,
    revokedAt: Date,
  ): Promise<boolean> {
    const updated = await this.database('provider_token_grants')
      .where({ id: grantId, user_entity_ref: userEntityRef })
      .whereNull('revoked_at')
      .update({ revoked_at: revokedAt });
    return updated > 0;
  }

  async createConnectSession(session: StoredConnectSession): Promise<void> {
    await this.database('provider_token_connect_sessions').insert({
      id: session.id,
      state_hash: session.stateHash,
      user_entity_ref: session.userEntityRef,
      client_id: session.clientId,
      caller_subject: session.callerSubject,
      provider: session.provider,
      scopes_json: JSON.stringify(session.scopes),
      provider_scopes_json: JSON.stringify(session.providerScopes),
      redirect_uri: session.redirectUri,
      return_url: session.returnUrl,
      code_verifier_ciphertext: session.codeVerifier.ciphertext,
      code_verifier_iv: session.codeVerifier.iv,
      code_verifier_auth_tag: session.codeVerifier.authTag,
      code_verifier_key_version: session.codeVerifier.keyVersion,
      pending_refresh_token_ciphertext:
        session.pendingRefreshToken?.ciphertext ?? null,
      pending_refresh_token_iv: session.pendingRefreshToken?.iv ?? null,
      pending_refresh_token_auth_tag:
        session.pendingRefreshToken?.authTag ?? null,
      pending_refresh_token_key_version:
        session.pendingRefreshToken?.keyVersion ?? null,
      pending_refresh_token_expires_at:
        session.pendingRefreshTokenExpiresAt ?? null,
      pending_scopes_json: session.pendingScopes
        ? JSON.stringify(session.pendingScopes)
        : null,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
      state_consumed_at: session.stateConsumedAt ?? null,
      completed_at: session.completedAt ?? null,
      consent_status: session.consentStatus,
      consent_decided_at: session.consentDecidedAt ?? null,
      grant_id: session.grantId ?? null,
    });
  }

  async getConnectSessionById(
    sessionId: string,
  ): Promise<StoredConnectSession | undefined> {
    const row = await this.database('provider_token_connect_sessions')
      .where({ id: sessionId })
      .first<ConnectSessionRow>();
    return row ? fromConnectSessionRow(row) : undefined;
  }

  async getConnectSessionByStateHash(
    stateHash: string,
  ): Promise<StoredConnectSession | undefined> {
    const row = await this.database('provider_token_connect_sessions')
      .where({ state_hash: stateHash })
      .first<ConnectSessionRow>();
    return row ? fromConnectSessionRow(row) : undefined;
  }

  /** Atomically consumes an unexpired session at most once. */
  async consumeConnectSession(
    sessionId: string,
    consumedAt: Date,
  ): Promise<boolean> {
    const updated = await this.database('provider_token_connect_sessions')
      .where({ id: sessionId })
      .whereNull('state_consumed_at')
      .where('expires_at', '>', consumedAt)
      .where('consent_status', 'pending')
      .whereNull('completed_at')
      .update({ state_consumed_at: consumedAt });
    return updated > 0;
  }

  /** Stores encrypted OAuth refresh material without persisting the access token. */
  async storePendingConnectCredentials(input: {
    sessionId: string;
    refreshToken: EncryptedSecret;
    refreshTokenExpiresAt?: Date;
    providerScopes: string[];
  }): Promise<boolean> {
    const updated = await this.database('provider_token_connect_sessions')
      .where({ id: input.sessionId, consent_status: 'pending' })
      .whereNotNull('state_consumed_at')
      .whereNull('completed_at')
      .whereNull('pending_refresh_token_ciphertext')
      .update({
        pending_refresh_token_ciphertext: input.refreshToken.ciphertext,
        pending_refresh_token_iv: input.refreshToken.iv,
        pending_refresh_token_auth_tag: input.refreshToken.authTag,
        pending_refresh_token_key_version: input.refreshToken.keyVersion,
        pending_refresh_token_expires_at: input.refreshTokenExpiresAt ?? null,
        pending_scopes_json: JSON.stringify(input.providerScopes),
      });
    return updated > 0;
  }

  /**
   * Atomically records denial or persists the provider secret and grant. A
   * failed secret/grant write leaves the consent session pending and retryable.
   */
  async decideConnectSession(input: {
    sessionId: string;
    userEntityRef: string;
    decision: 'approve' | 'deny';
    now: Date;
    secret?: StoredProviderSecret;
    grant?: Omit<StoredGrant, 'secretId'>;
  }): Promise<
    | { kind: 'missing' }
    | { kind: 'expired' }
    | { kind: 'consumed' }
    | { kind: 'denied' }
    | { kind: 'approved'; grantId: string; secretId: string }
  > {
    return this.database.transaction(async transaction => {
      const query = transaction('provider_token_connect_sessions').where({
        id: input.sessionId,
        user_entity_ref: input.userEntityRef,
      });
      const client = String(
        (transaction.client.config as { client?: string }).client,
      );
      const rowQuery =
        client === 'pg' || client === 'postgres' || client === 'postgresql'
          ? query.forUpdate()
          : query;
      const row = await rowQuery.first<ConnectSessionRow>();
      if (!row) return { kind: 'missing' };
      if (new Date(row.expires_at).getTime() <= input.now.getTime()) {
        return { kind: 'expired' };
      }
      if (
        !row.state_consumed_at ||
        row.consent_status !== 'pending' ||
        row.completed_at
      ) {
        return { kind: 'consumed' };
      }

      const clearPendingCredentials = {
        pending_refresh_token_ciphertext: null,
        pending_refresh_token_iv: null,
        pending_refresh_token_auth_tag: null,
        pending_refresh_token_key_version: null,
        pending_refresh_token_expires_at: null,
        pending_scopes_json: null,
      };

      if (input.decision === 'deny') {
        await transaction('provider_token_connect_sessions')
          .where({ id: input.sessionId })
          .update({
            consent_status: 'denied',
            consent_decided_at: input.now,
            completed_at: input.now,
            ...clearPendingCredentials,
          });
        return { kind: 'denied' };
      }

      if (
        !input.secret ||
        !input.grant ||
        !row.pending_refresh_token_ciphertext
      ) {
        return { kind: 'consumed' };
      }

      const secretRow = {
        id: input.secret.id,
        user_entity_ref: input.secret.userEntityRef,
        provider: input.secret.provider,
        refresh_token_ciphertext: input.secret.refreshToken.ciphertext,
        refresh_token_iv: input.secret.refreshToken.iv,
        refresh_token_auth_tag: input.secret.refreshToken.authTag,
        refresh_token_key_version: input.secret.refreshToken.keyVersion,
        refresh_token_expires_at: input.secret.refreshTokenExpiresAt ?? null,
        scopes_json: JSON.stringify(input.secret.scopes),
        created_at: input.secret.createdAt,
        updated_at: input.secret.updatedAt,
        revoked_at: input.secret.revokedAt ?? null,
      };
      const existingSecret = await transaction('provider_token_secrets')
        .where({
          user_entity_ref: input.secret.userEntityRef,
          provider: input.secret.provider,
        })
        .first<ProviderSecretRow>();
      const secretId = existingSecret?.id ?? input.secret.id;
      if (existingSecret) {
        const { id: _id, created_at: _createdAt, ...update } = secretRow;
        void _id;
        void _createdAt;
        await transaction('provider_token_secrets')
          .where({ id: existingSecret.id })
          .update(update);
      } else {
        await transaction('provider_token_secrets').insert(secretRow);
      }

      await transaction('provider_token_grants').insert({
        id: input.grant.id,
        user_entity_ref: input.grant.userEntityRef,
        client_id: input.grant.clientId,
        caller_subject: input.grant.callerSubject,
        provider: input.grant.provider,
        secret_id: secretId,
        scopes_json: JSON.stringify(input.grant.scopes),
        created_at: input.grant.createdAt,
        expires_at: input.grant.expiresAt,
        revoked_at: input.grant.revokedAt ?? null,
      });
      await transaction('provider_token_connect_sessions')
        .where({ id: input.sessionId })
        .update({
          consent_status: 'approved',
          consent_decided_at: input.now,
          completed_at: input.now,
          grant_id: input.grant.id,
          ...clearPendingCredentials,
        });
      return { kind: 'approved', grantId: input.grant.id, secretId };
    });
  }

  /** Removes one user's provider secret and revokes its grants atomically. */
  async disconnectProvider(
    userEntityRef: string,
    provider: string,
    revokedAt: Date,
  ): Promise<StoredProviderSecret | undefined> {
    return this.database.transaction(async transaction => {
      const row = await transaction('provider_token_secrets')
        .where({ user_entity_ref: userEntityRef, provider })
        .whereNull('revoked_at')
        .first<ProviderSecretRow>();
      if (!row) return undefined;
      await transaction('provider_token_grants')
        .where({ user_entity_ref: userEntityRef, provider })
        .whereNull('revoked_at')
        .update({ revoked_at: revokedAt });
      await transaction('provider_token_secrets')
        .where({ id: row.id })
        .delete();
      return fromSecretRow(row);
    });
  }

  /** Removes connect sessions past their configured TTL. */
  async cleanupExpiredConnectSessions(now: Date): Promise<number> {
    return this.database('provider_token_connect_sessions')
      .where('expires_at', '<=', now)
      .delete();
  }

  /** Removes completed connect sessions beyond the configured retention. */
  async cleanupCompletedConnectSessionsBefore(
    completedBefore: Date,
  ): Promise<number> {
    return this.database('provider_token_connect_sessions')
      .whereNotNull('completed_at')
      .andWhere('completed_at', '<=', completedBefore)
      .delete();
  }
}

/** Projects internal grant storage to the token-free shared response shape. */
export function toGrantSummary(grant: StoredGrant): ProviderTokenGrantSummary {
  return {
    grantId: grant.id,
    provider: grant.provider,
    clientId: grant.clientId,
    callerSubject: grant.callerSubject,
    scopes: [...grant.scopes],
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
  };
}
