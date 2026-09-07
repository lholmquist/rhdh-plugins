/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable(
    'secure_token_storage_connect_sessions',
    table => {
      table.string('id').primary().notNullable();
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
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('state_consumed_at', { useTz: true });
      table.timestamp('completed_at', { useTz: true });
      table.string('consent_status').notNullable().defaultTo('pending');
      table.timestamp('consent_decided_at', { useTz: true });
      table.string('grant_id');
      table.index(['user_entity_ref', 'provider']);
      table.index(['expires_at', 'state_consumed_at']);
    },
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('secure_token_storage_connect_sessions');
};
