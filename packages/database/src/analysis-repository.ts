import { and, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';

import type { Analysis, AnalysisRepository, AnalysisUpload } from '@damdai/application';

import type { Database } from './client.js';
import { analyses, analysisUploads } from './schema.js';

const processingLeaseMs = 5 * 60 * 1000;

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
          retainSourceAudio: upload.retainSourceAudio ?? false,
          sourceAudioRetentionUntil: upload.sourceAudioRetentionUntil ?? null,
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
            retainSourceAudio: analysis.retainSourceAudio ?? false,
            sourceAudioRetentionUntil: analysis.sourceAudioRetentionUntil ?? null,
            sourceAudioCleanupKey: analysis.sourceAudioCleanupKey ?? null,
            retryOfAnalysisId: analysis.retryOfAnalysisId,
            retryAnalysisId: analysis.retryAnalysisId,
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

    async deleteAnalysis(accountId, analysisId) {
      return db.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(analyses)
          .where(and(eq(analyses.id, analysisId), eq(analyses.accountId, accountId)))
          .for('update');

        if (!current) return null;

        const sourceAudioKey = current.sourceAudioKey ?? current.sourceAudioCleanupKey;
        let sourceAudioIsShared = false;
        if (sourceAudioKey) {
          const [reference] = await transaction
            .select({ id: analyses.id })
            .from(analyses)
            .where(sourceAudioReferenceCondition(sourceAudioKey, analysisId, new Date()))
            .limit(1);
          sourceAudioIsShared = Boolean(reference);
        }

        await transaction.delete(analysisUploads).where(eq(analysisUploads.analysisId, analysisId));

        if (current.retryOfAnalysisId) {
          await transaction
            .update(analyses)
            .set({ retryAnalysisId: null, updatedAt: new Date() })
            .where(
              and(
                eq(analyses.id, current.retryOfAnalysisId),
                eq(analyses.retryAnalysisId, analysisId),
              ),
            );
        }

        await transaction
          .update(analyses)
          .set({ retryOfAnalysisId: null, updatedAt: new Date() })
          .where(eq(analyses.retryOfAnalysisId, analysisId));

        await transaction.delete(analyses).where(eq(analyses.id, analysisId));

        return {
          analysis: mapAnalysis(current),
          sourceAudioKey: sourceAudioIsShared ? null : sourceAudioKey,
        };
      });
    },

    async beginProcessing(analysisId, at = new Date()) {
      const staleBefore = new Date(at.getTime() - processingLeaseMs);
      const [row] = await db
        .update(analyses)
        .set({ status: 'processing', stage: 'processing', updatedAt: at })
        .where(
          and(
            eq(analyses.id, analysisId),
            or(
              eq(analyses.status, 'queued'),
              and(eq(analyses.status, 'processing'), lt(analyses.updatedAt, staleBefore)),
            ),
          ),
        )
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
          result: null,
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

    async cancelAnalysis(accountId, analysisId) {
      return db.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(analyses)
          .where(and(eq(analyses.id, analysisId), eq(analyses.accountId, accountId)))
          .for('update');

        if (!current) return null;

        if (current.status !== 'queued' && current.status !== 'processing') {
          return {
            analysis: mapAnalysis(current),
            sourceAudioKey: current.status === 'canceled' ? current.sourceAudioCleanupKey : null,
            changed: false,
          };
        }

        const sourceAudioKey = current.sourceAudioKey;
        let sourceAudioIsShared = false;
        if (sourceAudioKey) {
          const [reference] = await transaction
            .select({ id: analyses.id })
            .from(analyses)
            .where(sourceAudioReferenceCondition(sourceAudioKey, analysisId, new Date()))
            .limit(1);
          sourceAudioIsShared = Boolean(reference);
        }

        const [canceled] = await transaction
          .update(analyses)
          .set({
            status: 'canceled',
            stage: 'canceled',
            sourceAudioKey: null,
            sourceAudioSize: null,
            retainSourceAudio: false,
            sourceAudioRetentionUntil: null,
            sourceAudioCleanupKey: sourceAudioIsShared ? null : sourceAudioKey,
            result: null,
            failureMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(analyses.id, analysisId))
          .returning();

        if (!canceled) return null;

        await transaction.delete(analysisUploads).where(eq(analysisUploads.analysisId, analysisId));

        if (current.retryOfAnalysisId) {
          await transaction
            .update(analyses)
            .set({ retryAnalysisId: null, updatedAt: new Date() })
            .where(
              and(
                eq(analyses.id, current.retryOfAnalysisId),
                eq(analyses.retryAnalysisId, analysisId),
              ),
            );
        }

        return {
          analysis: mapAnalysis(canceled),
          sourceAudioKey: sourceAudioIsShared ? null : sourceAudioKey,
          changed: true,
        };
      });
    },

    async clearSourceAudio(analysisId) {
      const updated = await db
        .update(analyses)
        .set({
          sourceAudioKey: null,
          sourceAudioSize: null,
          retainSourceAudio: false,
          sourceAudioRetentionUntil: null,
          sourceAudioCleanupKey: null,
          updatedAt: new Date(),
        })
        .where(eq(analyses.id, analysisId))
        .returning({ id: analyses.id });

      return updated.length === 1;
    },

    async hasSourceAudioReference(objectKey, excludingAnalysisId, at = new Date()) {
      const [row] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(sourceAudioReferenceCondition(objectKey, excludingAnalysisId, at))
        .limit(1);

      return Boolean(row);
    },

    async retryFailedAnalysis({ accountId, failedAnalysisId, analysis }) {
      return db.transaction(async (transaction) => {
        const [failed] = await transaction
          .select()
          .from(analyses)
          .where(and(eq(analyses.id, failedAnalysisId), eq(analyses.accountId, accountId)))
          .for('update');

        if (!failed) return null;

        if (failed.retryAnalysisId) {
          const [existingRetry] = await transaction
            .select()
            .from(analyses)
            .where(eq(analyses.id, failed.retryAnalysisId))
            .limit(1);

          return existingRetry ? { analysis: mapAnalysis(existingRetry), created: false } : null;
        }

        if (failed.status !== 'failed' || !failed.retainSourceAudio || !failed.sourceAudioKey) {
          return null;
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
            retainSourceAudio: analysis.retainSourceAudio ?? true,
            sourceAudioRetentionUntil: analysis.sourceAudioRetentionUntil ?? null,
            sourceAudioCleanupKey: null,
            retryOfAnalysisId: failed.id,
            retryAnalysisId: null,
            result: null,
            failureMessage: null,
            createdAt: analysis.createdAt,
            updatedAt: analysis.createdAt,
          })
          .returning();

        if (!created) return null;

        await transaction
          .update(analyses)
          .set({ retryAnalysisId: created.id, updatedAt: new Date() })
          .where(eq(analyses.id, failed.id));

        return { analysis: mapAnalysis(created), created: true };
      });
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
    retainSourceAudio: row.retainSourceAudio,
    sourceAudioRetentionUntil: row.sourceAudioRetentionUntil,
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
    retainSourceAudio: row.retainSourceAudio,
    sourceAudioRetentionUntil: row.sourceAudioRetentionUntil,
    sourceAudioCleanupKey: row.sourceAudioCleanupKey,
    retryOfAnalysisId: row.retryOfAnalysisId,
    retryAnalysisId: row.retryAnalysisId,
    createdAt: row.createdAt,
    result: row.result,
    failureMessage: row.failureMessage,
  };
}

function sourceAudioReferenceCondition(objectKey: string, excludingAnalysisId: string, at: Date) {
  return and(
    eq(analyses.sourceAudioKey, objectKey),
    ne(analyses.id, excludingAnalysisId),
    or(
      inArray(analyses.status, ['queued', 'processing']),
      and(
        eq(analyses.retainSourceAudio, true),
        or(isNull(analyses.sourceAudioRetentionUntil), gt(analyses.sourceAudioRetentionUntil, at)),
      ),
    ),
  );
}
