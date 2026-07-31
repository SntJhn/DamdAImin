import { and, desc, eq, ne } from 'drizzle-orm';
import type { AnalysisHistoryReader } from '@damdai/application';

import type { Database } from './client.js';
import { analyses } from './schema.js';

export function createAnalysisHistoryReader(db: Database): AnalysisHistoryReader {
  return {
    async listForAccount(accountId) {
      return db
        .select({
          id: analyses.id,
          status: analyses.status,
          createdAt: analyses.createdAt,
        })
        .from(analyses)
        .where(and(eq(analyses.accountId, accountId), ne(analyses.status, 'canceled')))
        .orderBy(desc(analyses.createdAt));
    },
  };
}
