/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('secure_token_storage_audit_events', table => {
    table.string('id').primary().notNullable();
    table.string('event_type').notNullable();
    table.string('user_entity_ref');
    table.string('provider');
    table.string('connection_id');
    table.string('grant_id');
    table.string('caller_subject');
    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.text('metadata_json').notNullable();
    table.index(['user_entity_ref', 'occurred_at']);
    table.index(['event_type', 'occurred_at']);
    table.index(['grant_id', 'occurred_at']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('secure_token_storage_audit_events');
};
