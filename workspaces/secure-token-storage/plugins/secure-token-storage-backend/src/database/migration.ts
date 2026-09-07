/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  DatabaseService,
  resolvePackagePath,
} from '@backstage/backend-plugin-api';

const migrationsDir = resolvePackagePath(
  '@red-hat-developer-hub/backstage-plugin-secure-token-storage-backend',
  'migrations',
);

export async function migrate(database: DatabaseService): Promise<void> {
  const knex = await database.getClient();
  if (!database.migrations?.skip) {
    await knex.migrate.latest({ directory: migrationsDir });
  }
}
