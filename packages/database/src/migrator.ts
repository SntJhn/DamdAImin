import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';

import type { Database } from './client.js';

export async function migrateDatabase(database: Database, migrationsFolder: string): Promise<void> {
  await runMigrations(database, { migrationsFolder });
}
