/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable(
    'secure_token_storage_connect_sessions',
    table => {
      table.string('session_type').notNullable().defaultTo('oauth');
    },
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable(
    'secure_token_storage_connect_sessions',
    table => {
      table.dropColumn('session_type');
    },
  );
};
