import 'dotenv/config';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';

import { createDatabase } from './client.js';

const { db, pool } = createDatabase();

try {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
} finally {
  await pool.end();
}
