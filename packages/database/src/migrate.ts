import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';

import { createDatabase } from './client.js';
import { loadEnvironment } from './load-env.js';

loadEnvironment();

const { db, pool } = createDatabase();

try {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
} finally {
  await pool.end();
}
