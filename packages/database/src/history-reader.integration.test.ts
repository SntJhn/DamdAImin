import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { listAnalysisHistory } from '@damdai/application';
import { loadEnvironment } from '@damdai/config';

import { createDatabase } from './client.js';
import { createAnalysisHistoryReader } from './history-reader.js';
import { analyses } from './schema.js';

loadEnvironment();

const databaseUrl =
  process.env.INTEGRATION_DATABASE_URL ??
  (process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true' ? process.env.DATABASE_URL : undefined);
const describeIntegration = describe.skipIf(!databaseUrl);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const resources: Array<{ close: () => Promise<void> }> = [];

afterAll(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

describeIntegration('real database history ownership boundary', () => {
  it('returns only Account A history and excludes canceled analyses', async () => {
    if (!databaseUrl) {
      throw new Error('integration database URL is required');
    }

    const accountA = randomUUID();
    const accountB = randomUUID();
    const accountAActive = randomUUID();
    const accountACanceled = randomUUID();
    const accountBActive = randomUUID();
    const database = createDatabase(databaseUrl);
    resources.push({ close: () => database.pool.end() });

    await migrate(database.db, { migrationsFolder });
    await database.db.insert(analyses).values([
      {
        id: accountAActive,
        accountId: accountA,
        status: 'queued',
        createdAt: new Date('2026-08-01T00:02:00.000Z'),
      },
      {
        id: accountACanceled,
        accountId: accountA,
        status: 'canceled',
        createdAt: new Date('2026-08-01T00:03:00.000Z'),
      },
      {
        id: accountBActive,
        accountId: accountB,
        status: 'completed',
        createdAt: new Date('2026-08-01T00:04:00.000Z'),
      },
    ]);

    try {
      const history = await listAnalysisHistory(accountA, createAnalysisHistoryReader(database.db));

      expect(history).toEqual([
        {
          id: accountAActive,
          status: 'queued',
          createdAt: new Date('2026-08-01T00:02:00.000Z'),
        },
      ]);
      expect(history.map((analysis) => analysis.id)).not.toContain(accountBActive);
      expect(history.map((analysis) => analysis.id)).not.toContain(accountACanceled);
    } finally {
      await database.db
        .delete(analyses)
        .where(inArray(analyses.id, [accountAActive, accountACanceled, accountBActive]));
    }
  });
});
