/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema
    .createTable('provider_token_secrets', table => {
      table.string('id').primary().notNullable();
      table.string('user_entity_ref').notNullable();
      table.string('provider').notNullable();
      table.text('refresh_token_ciphertext').notNullable();
      table.text('refresh_token_iv').notNullable();
      table.text('refresh_token_auth_tag').notNullable();
      table.string('refresh_token_key_version').notNullable();
      table.timestamp('refresh_token_expires_at', { useTz: true });
      table.text('scopes_json').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('updated_at', { useTz: true }).notNullable();
      table.timestamp('revoked_at', { useTz: true });
      table.unique(['user_entity_ref', 'provider']);
    })
    .createTable('provider_token_grants', table => {
      table.string('id').primary().notNullable();
      table.string('user_entity_ref').notNullable();
      table.string('client_id').notNullable();
      table.string('caller_subject').notNullable();
      table.string('provider').notNullable();
      table.string('secret_id').notNullable();
      table.text('scopes_json').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('revoked_at', { useTz: true });
      table.index(['user_entity_ref', 'provider', 'expires_at']);
      table.index(['user_entity_ref', 'client_id']);
      table.index(['caller_subject', 'provider', 'revoked_at']);
      table.index(['secret_id']);
    })
    .createTable('provider_token_connect_sessions', table => {
      table.string('id').primary().notNullable();
      table.string('state_hash').notNullable().unique();
      table.string('user_entity_ref').notNullable();
      table.string('client_id').notNullable();
      table.string('caller_subject').notNullable();
      table.string('provider').notNullable();
      table.text('scopes_json').notNullable();
      table.text('provider_scopes_json').notNullable();
      table.text('redirect_uri').notNullable();
      table.text('return_url').notNullable();
      table.text('code_verifier_ciphertext').notNullable();
      table.text('code_verifier_iv').notNullable();
      table.text('code_verifier_auth_tag').notNullable();
      table.string('code_verifier_key_version').notNullable();
      table.text('pending_refresh_token_ciphertext');
      table.text('pending_refresh_token_iv');
      table.text('pending_refresh_token_auth_tag');
      table.string('pending_refresh_token_key_version');
      table.timestamp('pending_refresh_token_expires_at', { useTz: true });
      table.text('pending_scopes_json');
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('state_consumed_at', { useTz: true });
      table.timestamp('completed_at', { useTz: true });
      table.string('consent_status').notNullable().defaultTo('pending');
      table.timestamp('consent_decided_at', { useTz: true });
      table.string('grant_id');
      table.index(['user_entity_ref', 'provider', 'created_at']);
      table.index(['expires_at']);
      table.index(['consent_status', 'expires_at']);
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema
    .dropTableIfExists('provider_token_connect_sessions')
    .dropTableIfExists('provider_token_grants')
    .dropTableIfExists('provider_token_secrets');
};
