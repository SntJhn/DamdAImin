import { resolve } from 'node:path';
import { loadEnvironment } from '@damdai/config';

import { createDatabase } from './client.js';
import { migrateDatabase } from './migrator.js';

loadEnvironment();

const { db, pool } = createDatabase();

try {
  await migrateDatabase(db, resolve(process.cwd(), 'drizzle'));
} finally {
  await pool.end();
}
