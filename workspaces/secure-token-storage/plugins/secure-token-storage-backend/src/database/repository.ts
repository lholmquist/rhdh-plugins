/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { DatabaseService } from '@backstage/backend-plugin-api';
import type { EncryptedSecret } from '../crypto';

type DatabaseClient = Awaited<ReturnType<DatabaseService['getClient']>>;

export interface StoredConnection {
  id: string;
  userEntityRef: string;
  provider: string;
  accessToken: EncryptedSecret;
  refreshToken?: EncryptedSecret;
  accessTokenExpiresAt?: Date;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export interface StoredGrant {
  id: string;
  userEntityRef: string;
  callerSubject: string;
  provider: string;
  scopes: string[];
  workflowInstanceId?: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

export type ConnectSessionConsentStatus = 'pending' | 'approved' | 'rejected';

export interface StoredConnectSession {
  id: string;
  stateHash: string;
  userEntityRef: string;
  callerSubject: string;
  provider: string;
  scopes: string[];
  redirectUri: string;
  codeVerifier: EncryptedSecret;
  createdAt: Date;
  expiresAt: Date;
  stateConsumedAt?: Date;
  completedAt?: Date;
  consentStatus: ConnectSessionConsentStatus;
  consentDecidedAt?: Date;
  grantId?: string;
}

export type AuditEventType =
  | 'grant-created'
  | 'grant-used'
  | 'grant-denied'
  | 'grant-revoked'
  | 'token-refreshed'
  | 'token-refresh-failed'
  | 'provider-disconnected'
  | 'consent-denied';

export interface StoredAuditEvent {
  id: string;
  eventType: AuditEventType;
  userEntityRef?: string;
  provider?: string;
  connectionId?: string;
  grantId?: string;
  callerSubject?: string;
  occurredAt: Date;
  metadata: Record<string, string | number | boolean>;
}

type ConnectionRow = {
  id: string;
  user_entity_ref: string;
  provider: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_auth_tag: string;
  access_token_key_version: string;
  refresh_token_ciphertext?: string;
  refresh_token_iv?: string;
  refresh_token_auth_tag?: string;
  refresh_token_key_version?: string;
  access_token_expires_at?: Date | string;
  scopes_json: string;
  created_at: Date | string;
  updated_at: Date | string;
  last_used_at?: Date | string;
  revoked_at?: Date | string;
};

type GrantRow = {
  id: string;
  user_entity_ref: string;
  caller_subject: string;
  provider: string;
  scopes_json: string;
  workflow_instance_id?: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at?: Date | string;
};

type ConnectSessionRow = {
  id: string;
  state_hash: string;
  user_entity_ref: string;
  caller_subject: string;
  provider: string;
  scopes_json: string;
  redirect_uri: string;
  code_verifier_ciphertext: string;
  code_verifier_iv: string;
  code_verifier_auth_tag: string;
  code_verifier_key_version: string;
  created_at: Date | string;
  expires_at: Date | string;
  state_consumed_at?: Date | string;
  completed_at?: Date | string;
  consent_status: ConnectSessionConsentStatus;
  consent_decided_at?: Date | string;
  grant_id?: string;
};

const asDate = (value: Date | string | undefined): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(value);
};

const asOptionalSecret = (
  row: ConnectionRow,
  prefix: 'access_token' | 'refresh_token',
): EncryptedSecret | undefined => {
  const ciphertext = row[`${prefix}_ciphertext`];
  const iv = row[`${prefix}_iv`];
  const authTag = row[`${prefix}_auth_tag`];
  const keyVersion = row[`${prefix}_key_version`];
  if (!ciphertext || !iv || !authTag || !keyVersion) return undefined;
  return { ciphertext, iv, authTag, keyVersion };
};

const fromConnectionRow = (row: ConnectionRow): StoredConnection => ({
  id: row.id,
  userEntityRef: row.user_entity_ref,
  provider: row.provider,
  accessToken: asOptionalSecret(row, 'access_token')!,
  refreshToken: asOptionalSecret(row, 'refresh_token'),
  accessTokenExpiresAt: asDate(row.access_token_expires_at),
  scopes: JSON.parse(row.scopes_json) as string[],
  createdAt: asDate(row.created_at)!,
  updatedAt: asDate(row.updated_at)!,
  lastUsedAt: asDate(row.last_used_at),
  revokedAt: asDate(row.revoked_at),
});

const fromGrantRow = (row: GrantRow): StoredGrant => ({
  id: row.id,
  userEntityRef: row.user_entity_ref,
  callerSubject: row.caller_subject,
  provider: row.provider,
  scopes: JSON.parse(row.scopes_json) as string[],
  workflowInstanceId: row.workflow_instance_id,
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
  callerSubject: row.caller_subject,
  provider: row.provider,
  scopes: JSON.parse(row.scopes_json) as string[],
  redirectUri: row.redirect_uri,
  codeVerifier: {
    ciphertext: row.code_verifier_ciphertext,
    iv: row.code_verifier_iv,
    authTag: row.code_verifier_auth_tag,
    keyVersion: row.code_verifier_key_version,
  },
  createdAt: asDate(row.created_at)!,
  expiresAt: asDate(row.expires_at)!,
  stateConsumedAt: asDate(row.state_consumed_at),
  completedAt: asDate(row.completed_at),
  consentStatus: row.consent_status,
  consentDecidedAt: asDate(row.consent_decided_at),
  grantId: row.grant_id,
});

/** @internal */
export class TokenStorageRepository {
  constructor(private readonly database: DatabaseClient) {}

  async upsertConnection(connection: StoredConnection): Promise<void> {
    const row = {
      id: connection.id,
      user_entity_ref: connection.userEntityRef,
      provider: connection.provider,
      access_token_ciphertext: connection.accessToken.ciphertext,
      access_token_iv: connection.accessToken.iv,
      access_token_auth_tag: connection.accessToken.authTag,
      access_token_key_version: connection.accessToken.keyVersion,
      refresh_token_ciphertext: connection.refreshToken?.ciphertext,
      refresh_token_iv: connection.refreshToken?.iv,
      refresh_token_auth_tag: connection.refreshToken?.authTag,
      refresh_token_key_version: connection.refreshToken?.keyVersion,
      access_token_expires_at: connection.accessTokenExpiresAt,
      scopes_json: JSON.stringify(connection.scopes),
      created_at: connection.createdAt,
      updated_at: connection.updatedAt,
      last_used_at: connection.lastUsedAt,
      revoked_at: connection.revokedAt,
    };

    await this.database.transaction(async transaction => {
      const existing = await transaction('secure_token_storage_connections')
        .select('id')
        .where({
          user_entity_ref: connection.userEntityRef,
          provider: connection.provider,
        })
        .first();
      if (existing) {
        const { id: _id, created_at: _createdAt, ...connectionUpdate } = row;
        void _id;
        void _createdAt;
        await transaction('secure_token_storage_connections')
          .where({ id: existing.id })
          .update(connectionUpdate);
      } else {
        await transaction('secure_token_storage_connections').insert(row);
      }
    });
  }

  async findConnection(
    userEntityRef: string,
    provider: string,
  ): Promise<StoredConnection | undefined> {
    const row = await this.database('secure_token_storage_connections')
      .where({ user_entity_ref: userEntityRef, provider })
      .first<ConnectionRow>();
    return row ? fromConnectionRow(row) : undefined;
  }

  async markConnectionUsed(id: string, usedAt: Date): Promise<void> {
    await this.database('secure_token_storage_connections')
      .where({ id })
      .update({ last_used_at: usedAt, updated_at: usedAt });
  }

  async updateConnectionTokens(
    id: string,
    values: Pick<
      StoredConnection,
      'accessToken' | 'refreshToken' | 'accessTokenExpiresAt'
    >,
    updatedAt: Date,
  ): Promise<void> {
    await this.database('secure_token_storage_connections')
      .where({ id })
      .update({
        access_token_ciphertext: values.accessToken.ciphertext,
        access_token_iv: values.accessToken.iv,
        access_token_auth_tag: values.accessToken.authTag,
        access_token_key_version: values.accessToken.keyVersion,
        refresh_token_ciphertext: values.refreshToken?.ciphertext ?? null,
        refresh_token_iv: values.refreshToken?.iv ?? null,
        refresh_token_auth_tag: values.refreshToken?.authTag ?? null,
        refresh_token_key_version: values.refreshToken?.keyVersion ?? null,
        access_token_expires_at: values.accessTokenExpiresAt,
        updated_at: updatedAt,
        last_used_at: updatedAt,
      });
  }

  async createGrant(grant: StoredGrant): Promise<void> {
    await this.database('secure_token_storage_grants').insert({
      id: grant.id,
      user_entity_ref: grant.userEntityRef,
      caller_subject: grant.callerSubject,
      provider: grant.provider,
      scopes_json: JSON.stringify(grant.scopes),
      workflow_instance_id: grant.workflowInstanceId,
      created_at: grant.createdAt,
      expires_at: grant.expiresAt,
      revoked_at: grant.revokedAt,
    });
  }

  async findGrant(id: string): Promise<StoredGrant | undefined> {
    const row = await this.database('secure_token_storage_grants')
      .where({ id })
      .first<GrantRow>();
    return row ? fromGrantRow(row) : undefined;
  }

  async listGrants(
    userEntityRef: string,
    provider?: string,
  ): Promise<StoredGrant[]> {
    const query = this.database('secure_token_storage_grants').where({
      user_entity_ref: userEntityRef,
    });
    if (provider) query.andWhere({ provider });
    const rows = await query
      .orderBy('created_at', 'desc')
      .select<GrantRow[]>('*');
    return rows.map(fromGrantRow);
  }

  async revokeGrant(
    id: string,
    userEntityRef: string,
    revokedAt: Date,
  ): Promise<boolean> {
    const updated = await this.database('secure_token_storage_grants')
      .where({ id, user_entity_ref: userEntityRef })
      .whereNull('revoked_at')
      .update({ revoked_at: revokedAt });
    return updated === 1;
  }

  async disconnectProvider(
    userEntityRef: string,
    provider: string,
    revokedAt: Date,
  ): Promise<{ connectionId: string; revokedGrantCount: number } | undefined> {
    return this.database.transaction(async transaction => {
      const connection = await transaction('secure_token_storage_connections')
        .select('id', 'revoked_at')
        .where({ user_entity_ref: userEntityRef, provider })
        .first<{ id: string; revoked_at?: Date | string }>();
      if (!connection || connection.revoked_at) return undefined;

      await transaction('secure_token_storage_connections')
        .where({ id: connection.id })
        .update({ revoked_at: revokedAt, updated_at: revokedAt });
      const revokedGrantCount = await transaction('secure_token_storage_grants')
        .where({ user_entity_ref: userEntityRef, provider })
        .whereNull('revoked_at')
        .update({ revoked_at: revokedAt });
      return { connectionId: connection.id, revokedGrantCount };
    });
  }

  async recordAuditEvent(event: StoredAuditEvent): Promise<void> {
    await this.database('secure_token_storage_audit_events').insert({
      id: event.id,
      event_type: event.eventType,
      user_entity_ref: event.userEntityRef,
      provider: event.provider,
      connection_id: event.connectionId,
      grant_id: event.grantId,
      caller_subject: event.callerSubject,
      occurred_at: event.occurredAt,
      metadata_json: JSON.stringify(event.metadata),
    });
  }

  async createConnectSession(session: StoredConnectSession): Promise<void> {
    await this.database('secure_token_storage_connect_sessions').insert({
      id: session.id,
      state_hash: session.stateHash,
      user_entity_ref: session.userEntityRef,
      caller_subject: session.callerSubject,
      provider: session.provider,
      scopes_json: JSON.stringify(session.scopes),
      redirect_uri: session.redirectUri,
      code_verifier_ciphertext: session.codeVerifier.ciphertext,
      code_verifier_iv: session.codeVerifier.iv,
      code_verifier_auth_tag: session.codeVerifier.authTag,
      code_verifier_key_version: session.codeVerifier.keyVersion,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
      state_consumed_at: session.stateConsumedAt,
      completed_at: session.completedAt,
      consent_status: session.consentStatus,
      consent_decided_at: session.consentDecidedAt,
      grant_id: session.grantId,
    });
  }

  async findConnectSessionByStateHash(
    stateHash: string,
  ): Promise<StoredConnectSession | undefined> {
    const row = await this.database('secure_token_storage_connect_sessions')
      .where({ state_hash: stateHash })
      .first<ConnectSessionRow>();
    return row ? fromConnectSessionRow(row) : undefined;
  }

  async findConnectSession(
    id: string,
  ): Promise<StoredConnectSession | undefined> {
    const row = await this.database('secure_token_storage_connect_sessions')
      .where({ id })
      .first<ConnectSessionRow>();
    return row ? fromConnectSessionRow(row) : undefined;
  }

  async consumeConnectSession(id: string, consumedAt: Date): Promise<boolean> {
    const updated = await this.database('secure_token_storage_connect_sessions')
      .where({ id })
      .whereNull('state_consumed_at')
      .where('expires_at', '>', consumedAt)
      .update({ state_consumed_at: consumedAt });
    return updated === 1;
  }

  async completeConnectSession(
    id: string,
    completedAt: Date,
    scopes?: string[],
  ): Promise<void> {
    await this.database('secure_token_storage_connect_sessions')
      .where({ id })
      .update({
        completed_at: completedAt,
        ...(scopes ? { scopes_json: JSON.stringify(scopes) } : {}),
      });
  }

  async approveConnectSession(
    id: string,
    userEntityRef: string,
    grant: StoredGrant,
    decidedAt: Date,
  ): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const row = await transaction('secure_token_storage_connect_sessions')
        .where({
          id,
          user_entity_ref: userEntityRef,
          consent_status: 'pending',
        })
        .whereNotNull('completed_at')
        .first<ConnectSessionRow>();
      if (!row) return false;

      await transaction('secure_token_storage_grants').insert({
        id: grant.id,
        user_entity_ref: grant.userEntityRef,
        caller_subject: grant.callerSubject,
        provider: grant.provider,
        scopes_json: JSON.stringify(grant.scopes),
        workflow_instance_id: grant.workflowInstanceId,
        created_at: grant.createdAt,
        expires_at: grant.expiresAt,
        revoked_at: grant.revokedAt,
      });
      await transaction('secure_token_storage_connect_sessions')
        .where({
          id,
          user_entity_ref: userEntityRef,
          consent_status: 'pending',
        })
        .update({
          consent_status: 'approved',
          consent_decided_at: decidedAt,
          grant_id: grant.id,
        });
      return true;
    });
  }

  async rejectConnectSession(
    id: string,
    userEntityRef: string,
    decidedAt: Date,
  ): Promise<boolean> {
    const updated = await this.database('secure_token_storage_connect_sessions')
      .where({
        id,
        user_entity_ref: userEntityRef,
        consent_status: 'pending',
      })
      .whereNotNull('completed_at')
      .update({
        consent_status: 'rejected',
        consent_decided_at: decidedAt,
      });
    return updated === 1;
  }
}
