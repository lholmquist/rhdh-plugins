/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema
    .createTable('secure_token_storage_connections', table => {
      table.string('id').primary().notNullable();
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
      table.timestamp('access_token_expires_at', { useTz: true });
      table.text('scopes_json').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('updated_at', { useTz: true }).notNullable();
      table.timestamp('last_used_at', { useTz: true });
      table.timestamp('revoked_at', { useTz: true });
      table.unique(['user_entity_ref', 'provider']);
    })
    .createTable('secure_token_storage_grants', table => {
      table.string('id').primary().notNullable();
      table.string('user_entity_ref').notNullable();
      table.string('caller_subject').notNullable();
      table.string('provider').notNullable();
      table.text('scopes_json').notNullable();
      table.string('workflow_instance_id');
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('revoked_at', { useTz: true });
      table.index(['user_entity_ref', 'provider']);
      table.index(['caller_subject', 'provider']);
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('secure_token_storage_grants');
  await knex.schema.dropTableIfExists('secure_token_storage_connections');
};
