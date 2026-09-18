/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import knex, { type Knex } from 'knex';
import { TokenStorageRepository, type StoredConnection } from './repository';

describe('TokenStorageRepository', () => {
  let database: Knex;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await database.schema.createTable(
      'secure_token_storage_connections',
      table => {
        table.string('id').primary();
        table.string('user_entity_ref').notNullable();
        table.string('provider').notNullable();
        table.text('access_token_ciphertext').notNullable();
        table.text('access_token_iv').notNullable();
        table.text('access_token_auth_tag').notNullable();
        table.string('access_token_key_version').notNullable();
        table.text('refresh_token_ciphertext');
        table.text('refresh_token_iv');
        table.text('refresh_token_auth_tag');
        table.string('refresh_token_key_version');
        table.timestamp('access_token_expires_at');
        table.text('scopes_json').notNullable();
        table.timestamp('created_at').notNullable();
        table.timestamp('updated_at').notNullable();
        table.timestamp('last_used_at');
        table.timestamp('revoked_at');
        table.unique(['user_entity_ref', 'provider']);
      },
    );
    await database.schema.createTable(
      'secure_token_storage_connect_sessions',
      table => {
        table.string('id').primary();
        table.string('state_hash').notNullable().unique();
        table.string('user_entity_ref').notNullable();
        table.string('caller_subject').notNullable();
        table.string('provider').notNullable();
        table.text('scopes_json').notNullable();
        table.text('redirect_uri').notNullable();
        table.text('code_verifier_ciphertext').notNullable();
        table.text('code_verifier_iv').notNullable();
        table.text('code_verifier_auth_tag').notNullable();
        table.string('code_verifier_key_version').notNullable();
        table.timestamp('created_at').notNullable();
        table.timestamp('expires_at').notNullable();
        table.timestamp('state_consumed_at');
        table.timestamp('completed_at');
        table.string('consent_status').notNullable();
        table.timestamp('consent_decided_at');
        table.string('grant_id');
      },
    );
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('maps nullable SQLite session fields to absent optional values', async () => {
    await database('secure_token_storage_connect_sessions').insert({
      id: 'session-1',
      state_hash: 'state-hash',
      user_entity_ref: 'user:default/luke',
      caller_subject: 'sonataflow',
      provider: 'github',
      scopes_json: JSON.stringify(['repo']),
      redirect_uri: 'http://localhost/callback',
      code_verifier_ciphertext: 'ciphertext',
      code_verifier_iv: 'iv',
      code_verifier_auth_tag: 'auth-tag',
      code_verifier_key_version: 'v1',
      created_at: new Date('2026-09-07T12:00:00Z'),
      expires_at: new Date('2026-09-07T12:05:00Z'),
      state_consumed_at: null,
      completed_at: null,
      consent_status: 'pending',
      consent_decided_at: null,
      grant_id: null,
    });

    const session = await new TokenStorageRepository(
      database as never,
    ).findConnectSessionByStateHash('state-hash');

    expect(session).toMatchObject({
      stateConsumedAt: undefined,
      completedAt: undefined,
      consentDecidedAt: undefined,
      grantId: undefined,
    });
  });

  it('clears a prior connection revocation when the connection is reused', async () => {
    const repository = new TokenStorageRepository(database as never);
    const encryptedSecret = {
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'auth-tag',
      keyVersion: 'v1',
    };
    await database('secure_token_storage_connections').insert({
      id: 'connection-1',
      user_entity_ref: 'user:default/luke',
      provider: 'github',
      access_token_ciphertext: encryptedSecret.ciphertext,
      access_token_iv: encryptedSecret.iv,
      access_token_auth_tag: encryptedSecret.authTag,
      access_token_key_version: encryptedSecret.keyVersion,
      scopes_json: JSON.stringify(['read:user']),
      created_at: new Date('2026-09-07T12:00:00Z'),
      updated_at: new Date('2026-09-07T12:00:00Z'),
      revoked_at: new Date('2026-09-07T12:05:00Z'),
    });

    await repository.upsertConnection({
      id: 'connection-1',
      userEntityRef: 'user:default/luke',
      provider: 'github',
      accessToken: encryptedSecret,
      accessTokenExpiresAt: new Date('2026-09-07T13:00:00Z'),
      scopes: ['read:user'],
      createdAt: new Date('2026-09-07T12:00:00Z'),
      updatedAt: new Date('2026-09-07T12:10:00Z'),
    } satisfies StoredConnection);

    await expect(
      repository.findConnection('user:default/luke', 'github'),
    ).resolves.toMatchObject({ revokedAt: undefined });
  });
});
