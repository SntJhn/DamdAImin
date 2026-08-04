import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Analysis, AnalysisRepository, AnalysisUpload } from '@damdai/application';

import type { Database } from './client.js';
import { analyses, analysisUploads } from './schema.js';

export function createAnalysisRepository(db: Database): AnalysisRepository {
  return {
    async createUpload(upload) {
      const [row] = await db
        .insert(analysisUploads)
        .values({
          id: upload.id,
          accountId: upload.accountId,
          objectKey: upload.objectKey,
          language: upload.language,
          contractVersion: upload.contractVersion,
          contentType: upload.contentType,
          status: upload.status,
          expiresAt: upload.expiresAt,
          analysisId: upload.analysisId,
        })
        .returning();

      if (!row) {
        throw new Error('Analysis upload was not created');
      }

      return mapUpload(row);
    },

    async getUpload(accountId, uploadId) {
      const [row] = await db
        .select()
        .from(analysisUploads)
        .where(and(eq(analysisUploads.id, uploadId), eq(analysisUploads.accountId, accountId)))
        .limit(1);

      return row ? mapUpload(row) : null;
    },

    async finalizeUploadAndCreateAnalysis({ accountId, uploadId, analysis }) {
      return db.transaction(async (transaction) => {
        const [claimedUpload] = await transaction
          .update(analysisUploads)
          .set({ status: 'finalized', analysisId: analysis.id })
          .where(
            and(
              eq(analysisUploads.id, uploadId),
              eq(analysisUploads.accountId, accountId),
              isNull(analysisUploads.analysisId),
            ),
          )
          .returning();

        if (!claimedUpload) {
          const [existingUpload] = await transaction
            .select()
            .from(analysisUploads)
            .where(and(eq(analysisUploads.id, uploadId), eq(analysisUploads.accountId, accountId)))
            .limit(1);

          if (!existingUpload?.analysisId) {
            throw new Error('Analysis upload cannot be finalized');
          }

          const [existingAnalysis] = await transaction
            .select()
            .from(analyses)
            .where(eq(analyses.id, existingUpload.analysisId))
            .limit(1);

          if (!existingAnalysis) {
            throw new Error('Finalized Analysis is missing');
          }

          return mapAnalysis(existingAnalysis);
        }

        const [created] = await transaction
          .insert(analyses)
          .values({
            id: analysis.id,
            accountId: analysis.accountId,
            status: analysis.status,
            stage: analysis.stage,
            language: analysis.language,
            contractVersion: analysis.contractVersion,
            sourceAudioKey: analysis.sourceAudioKey,
            sourceAudioSize: analysis.sourceAudioSize,
            result: analysis.result,
            failureMessage: analysis.failureMessage,
            createdAt: analysis.createdAt,
            updatedAt: analysis.createdAt,
          })
          .returning();

        if (!created) {
          throw new Error('Analysis was not created');
        }

        return mapAnalysis(created);
      });
    },

    async getAnalysis(accountId, analysisId) {
      const [row] = await db
        .select()
        .from(analyses)
        .where(and(eq(analyses.id, analysisId), eq(analyses.accountId, accountId)))
        .limit(1);

      return row ? mapAnalysis(row) : null;
    },

    async getAnalysisForWorker(analysisId) {
      const [row] = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1);
      return row ? mapAnalysis(row) : null;
    },

    async beginProcessing(analysisId) {
      const [row] = await db
        .update(analyses)
        .set({ status: 'processing', stage: 'processing', updatedAt: new Date() })
        .where(and(eq(analyses.id, analysisId), inArray(analyses.status, ['queued', 'processing'])))
        .returning();

      return row ? mapAnalysis(row) : null;
    },

    async completeAnalysis(analysisId, result) {
      const updated = await db
        .update(analyses)
        .set({
          status: 'completed',
          stage: 'completed',
          result,
          failureMessage: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(analyses.id, analysisId),
            eq(analyses.status, 'processing'),
            isNull(analyses.result),
          ),
        )
        .returning({ id: analyses.id });

      return updated.length === 1;
    },

    async failAnalysis(analysisId, message) {
      const updated = await db
        .update(analyses)
        .set({
          status: 'failed',
          stage: 'failed',
          failureMessage: message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(analyses.id, analysisId),
            eq(analyses.status, 'processing'),
            isNull(analyses.result),
          ),
        )
        .returning({ id: analyses.id });

      return updated.length === 1;
    },
  } satisfies AnalysisRepository;
}

function mapUpload(row: typeof analysisUploads.$inferSelect): AnalysisUpload {
  return {
    id: row.id,
    accountId: row.accountId,
    objectKey: row.objectKey,
    language: row.language,
    contractVersion: row.contractVersion,
    contentType: row.contentType as 'audio/wav',
    status: row.status,
    expiresAt: row.expiresAt,
    analysisId: row.analysisId,
  };
}

function mapAnalysis(row: typeof analyses.$inferSelect): Analysis {
  return {
    id: row.id,
    accountId: row.accountId,
    status: row.status,
    stage: row.stage as Analysis['stage'],
    language: row.language,
    contractVersion: row.contractVersion,
    sourceAudioKey: row.sourceAudioKey,
    sourceAudioSize: row.sourceAudioSize,
    createdAt: row.createdAt,
    result: row.result,
    failureMessage: row.failureMessage,
  };
}
