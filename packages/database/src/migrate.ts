import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { loadEnvironment } from '@damdai/config';

import { createDatabase } from './client.js';

loadEnvironment();

const { db, pool } = createDatabase();

try {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
} finally {
  await pool.end();
}
