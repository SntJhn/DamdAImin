import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  analysisHistoryDefaultLimit,
  type AnalysisHistoryFilters,
  type AnalysisHistoryReader,
} from '@damdai/application';
import { toAnalysisHistoryResult } from '@damdai/domain';

import type { Database } from './client.js';
import { analyses } from './schema.js';

export function createAnalysisHistoryReader(db: Database): AnalysisHistoryReader {
  return {
    async list(accountId, filters) {
      const limit = filters.limit ?? analysisHistoryDefaultLimit;
      const conditions = [
        eq(analyses.accountId, accountId),
        inArray(analyses.status, ['queued', 'processing', 'completed', 'failed']),
      ];

      if (filters.status) {
        conditions.push(eq(analyses.status, filters.status));
      }

      if (filters.language) {
        conditions.push(eq(analyses.language, filters.language));
      }

      if (filters.from) {
        conditions.push(gte(analyses.createdAt, filters.from));
      }

      if (filters.to) {
        conditions.push(lte(analyses.createdAt, filters.to));
      }

      if (filters.search) {
        conditions.push(transcriptSearchCondition(filters.search));
      }

      if (filters.result) {
        conditions.push(resultFilterCondition(filters.result));
      }

      const rows = await db
        .select({
          id: analyses.id,
          accountId: analyses.accountId,
          status: analyses.status,
          language: analyses.language,
          createdAt: analyses.createdAt,
          result: analyses.result,
        })
        .from(analyses)
        .where(and(...conditions))
        .orderBy(desc(analyses.createdAt), desc(analyses.id))
        .limit(limit + 1);

      return {
        analyses: rows.slice(0, limit).map((row) => ({
          id: row.id,
          accountId: row.accountId,
          status: row.status,
          language: row.language,
          createdAt: row.createdAt,
          result:
            row.status === 'completed' && row.result ? toAnalysisHistoryResult(row.result) : null,
        })),
        hasMore: rows.length > limit,
      };
    },
  };
}

function transcriptSearchCondition(search: string) {
  const escapedSearch = search.replace(/[\\%_]/g, '\\$&');
  return sql`(
    ${analyses.status} = 'completed'
    AND coalesce(${analyses.result}->>'transcript', '') ILIKE ${`%${escapedSearch}%`} ESCAPE '\\'
  )`;
}

function resultFilterCondition(filtersResult: NonNullable<AnalysisHistoryFilters['result']>) {
  if (isResultOutcome(filtersResult)) {
    return sql`(
      ${analyses.status} = 'completed'
      AND ${analyses.result}->>'outcome' = ${filtersResult}
    )`;
  }

  return sql`(
    ${analyses.status} = 'completed'
    AND ${analyses.result}->>'emotionClassification' = ${filtersResult}
  )`;
}

function isResultOutcome(value: NonNullable<AnalysisHistoryFilters['result']>): boolean {
  return value === 'definitive' || value === 'inconclusive';
}
