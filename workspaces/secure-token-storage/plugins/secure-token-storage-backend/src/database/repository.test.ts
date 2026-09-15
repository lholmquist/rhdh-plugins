/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import knex, { type Knex } from 'knex';
import { TokenStorageRepository } from './repository';

describe('TokenStorageRepository', () => {
  let database: Knex;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
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
});
