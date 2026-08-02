import { desc } from 'drizzle-orm';
import type { AnalysisHistoryReader } from '@damdai/application';

import type { Database } from './client.js';
import { analyses } from './schema.js';

export function createAnalysisHistoryReader(db: Database): AnalysisHistoryReader {
  return {
    async listAll() {
      return db
        .select({
          id: analyses.id,
          accountId: analyses.accountId,
          status: analyses.status,
          createdAt: analyses.createdAt,
        })
        .from(analyses)
        .orderBy(desc(analyses.createdAt));
    },
  };
}
