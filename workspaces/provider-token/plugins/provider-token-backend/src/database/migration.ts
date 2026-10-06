/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  type DatabaseService,
  resolvePackagePath,
} from '@backstage/backend-plugin-api';

const migrationsDir = resolvePackagePath(
  '@red-hat-developer-hub/backstage-plugin-provider-token-backend',
  'migrations',
);

export async function migrate(database: DatabaseService): Promise<void> {
  if (database.migrations?.skip) {
    return;
  }
  const knex = await database.getClient();
  await knex.migrate.latest({ directory: migrationsDir });
}
