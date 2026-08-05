import { randomUUID } from 'node:crypto';

import {
  analysisLanguages,
  type AnalysisLanguage,
  type AnalysisResult,
  type AnalysisStatus,
  inspectWavAudio,
} from '@damdai/domain';

export type AnalysisUploadStatus = 'created' | 'finalized';

export const sourceAudioRetentionDays = 30;
const sourceAudioRetentionMs = sourceAudioRetentionDays * 24 * 60 * 60 * 1000;

export interface AnalysisUpload {
  id: string;
  accountId: string;
  objectKey: string;
  language: AnalysisLanguage;
  contractVersion: string;
  contentType: 'audio/wav';
  retainSourceAudio?: boolean;
  sourceAudioRetentionUntil?: Date | null;
  status: AnalysisUploadStatus;
  expiresAt: Date;
  analysisId: string | null;
}

export interface Analysis {
  id: string;
  accountId: string;
  status: AnalysisStatus;
  stage: AnalysisStatus;
  language: AnalysisLanguage;
  contractVersion: string;
  sourceAudioKey: string | null;
  sourceAudioSize: number | null;
  retainSourceAudio?: boolean;
  sourceAudioRetentionUntil?: Date | null;
  sourceAudioCleanupKey?: string | null;
  retryOfAnalysisId?: string | null;
  retryAnalysisId?: string | null;
  createdAt: Date;
  result: AnalysisResult | null;
  failureMessage: string | null;
}

export interface AnalysisJob {
  analysisId: string;
  language: AnalysisLanguage;
  contractVersion: string;
}

export interface AnalysisTelemetryEvent {
  name: 'analysis.queued' | 'analysis.stage' | 'analysis.worker.received';
  analysisId: string;
  stage: AnalysisStatus;
  language: AnalysisLanguage;
  contractVersion: string;
  requestId?: string;
  jobId?: string;
}

export interface AnalysisTelemetry {
  record(event: AnalysisTelemetryEvent): void;
}

export interface AnalysisAuditEvent {
  action: 'canceled' | 'failed' | 'retried';
  analysisId: string;
  status: AnalysisStatus;
  linkedAnalysisId?: string;
  reasonCode?: 'research_system_failure' | 'source_audio_unavailable';
}

export interface AnalysisAudit {
  record(event: AnalysisAuditEvent): void;
}

export interface AnalysisCancellation {
  analysis: Analysis;
  sourceAudioKey: string | null;
  changed: boolean;
}

export interface AnalysisRetryResult {
  analysis: Analysis;
  created: boolean;
}

export interface AnalysisRepository {
  createUpload(upload: AnalysisUpload): Promise<AnalysisUpload>;
  getUpload(accountId: string, uploadId: string): Promise<AnalysisUpload | null>;
  finalizeUploadAndCreateAnalysis(input: {
    accountId: string;
    uploadId: string;
    analysis: Analysis;
  }): Promise<Analysis>;
  getAnalysis(accountId: string, analysisId: string): Promise<Analysis | null>;
  getAnalysisForWorker(analysisId: string): Promise<Analysis | null>;
  beginProcessing(analysisId: string, at?: Date): Promise<Analysis | null>;
  completeAnalysis(analysisId: string, result: AnalysisResult): Promise<boolean>;
  failAnalysis(analysisId: string, message: string): Promise<boolean>;
  cancelAnalysis(accountId: string, analysisId: string): Promise<AnalysisCancellation | null>;
  clearSourceAudio(analysisId: string): Promise<boolean>;
  hasSourceAudioReference(
    objectKey: string,
    excludingAnalysisId: string,
    at?: Date,
  ): Promise<boolean>;
  retryFailedAnalysis(input: {
    accountId: string;
    failedAnalysisId: string;
    analysis: Analysis;
  }): Promise<AnalysisRetryResult | null>;
}

export interface AnalysisQueue {
  enqueue(job: AnalysisJob): Promise<void>;
}

export interface SourceAudioStorage {
  createUpload(input: { objectKey: string; expiresAt: Date }): Promise<{
    uploadUrl: string;
    uploadMethod: 'PUT' | 'POST';
    uploadHeaders: { 'content-type': 'audio/wav' };
  }>;
  stat(objectKey: string): Promise<{ contentType: string; size: number } | null>;
  read(objectKey: string): Promise<Uint8Array>;
  delete(objectKey: string): Promise<void>;
}

export interface ResearchSystemClient {
  analyze(input: {
    analysisId: string;
    language: AnalysisLanguage;
    contractVersion: string;
    audio: Uint8Array;
  }): Promise<AnalysisResult>;
}

export interface AnalysisServiceOptions {
  repository: AnalysisRepository;
  storage: SourceAudioStorage;
  queue: AnalysisQueue;
  researchClient?: ResearchSystemClient;
  telemetry?: AnalysisTelemetry;
  audit?: AnalysisAudit;
  now?: () => Date;
  createId?: () => string;
  uploadLifetimeMs?: number;
}

export interface CreatedAnalysisUpload {
  upload: AnalysisUpload;
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadHeaders: { 'content-type': 'audio/wav' };
}

export interface AnalysisServices {
  createUpload(input: {
    accountId: string;
    language: AnalysisLanguage;
    contractVersion: string;
    retainSourceAudio?: boolean;
  }): Promise<CreatedAnalysisUpload>;
  finalizeUpload(accountId: string, uploadId: string): Promise<Analysis>;
  getAnalysis(accountId: string, analysisId: string): Promise<Analysis>;
  cancelAnalysis(accountId: string, analysisId: string): Promise<Analysis>;
  retryAnalysis(accountId: string, analysisId: string): Promise<Analysis>;
  processAnalysis(job: AnalysisJob): Promise<void>;
}

export class AnalysisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisInputError';
  }
}

export class AnalysisNotFoundError extends Error {
  constructor() {
    super('Analysis was not found');
    this.name = 'AnalysisNotFoundError';
  }
}

export class AnalysisConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisConflictError';
  }
}

export class AnalysisRetryUnavailableError extends AnalysisConflictError {
  constructor() {
    super('This Analysis cannot be retried because retained Source Audio is unavailable.');
    this.name = 'AnalysisRetryUnavailableError';
  }
}

const safeFailureMessage =
  'The Research System could not complete this Analysis. Retry while retained Source Audio is available.';

export function createAnalysisServices(options: AnalysisServiceOptions): AnalysisServices {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const uploadLifetimeMs = options.uploadLifetimeMs ?? 15 * 60 * 1000;

  return {
    async createUpload(input: {
      accountId: string;
      language: AnalysisLanguage;
      contractVersion: string;
      retainSourceAudio?: boolean;
    }): Promise<CreatedAnalysisUpload> {
      if (!analysisLanguages.includes(input.language)) {
        throw new AnalysisInputError('Analysis language is unsupported');
      }

      const contractVersion = input.contractVersion.trim();
      if (!contractVersion) {
        throw new AnalysisInputError('Research contract metadata is required');
      }

      const uploadId = createId();
      const expiresAt = new Date(now().getTime() + uploadLifetimeMs);
      const upload: AnalysisUpload = {
        id: uploadId,
        accountId: input.accountId,
        objectKey: `accounts/${input.accountId}/source-audio/${uploadId}.wav`,
        language: input.language,
        contractVersion,
        contentType: 'audio/wav',
        retainSourceAudio: input.retainSourceAudio === true,
        sourceAudioRetentionUntil:
          input.retainSourceAudio === true
            ? new Date(now().getTime() + sourceAudioRetentionMs)
            : null,
        status: 'created',
        expiresAt,
        analysisId: null,
      };

      const storedUpload = await options.repository.createUpload(upload);
      const instruction = await options.storage.createUpload({
        objectKey: storedUpload.objectKey,
        expiresAt: storedUpload.expiresAt,
      });

      return { upload: storedUpload, ...instruction };
    },

    async finalizeUpload(accountId: string, uploadId: string): Promise<Analysis> {
      const upload = await options.repository.getUpload(accountId, uploadId);
      if (!upload) {
        throw new AnalysisNotFoundError();
      }

      if (upload.analysisId) {
        const existing = await options.repository.getAnalysis(accountId, upload.analysisId);
        if (existing) {
          if (existing.status === 'queued') {
            await options.queue.enqueue({
              analysisId: existing.id,
              language: existing.language,
              contractVersion: existing.contractVersion,
            });
          }
          return existing;
        }
      }

      if (upload.expiresAt.getTime() <= now().getTime()) {
        throw new AnalysisInputError('The upload has expired');
      }

      const storedObject = await options.storage.stat(upload.objectKey);
      if (!storedObject) {
        throw new AnalysisInputError('Upload the WAV file before submitting the Analysis');
      }

      if (storedObject.contentType !== 'audio/wav') {
        await deleteBestEffort(options.storage, upload.objectKey);
        throw new AnalysisInputError('Only WAV audio uploads are supported');
      }

      const audio = await options.storage.read(upload.objectKey);
      try {
        inspectWavAudio(audio);
      } catch (error) {
        await deleteBestEffort(options.storage, upload.objectKey);
        if (error instanceof Error) {
          throw new AnalysisInputError(error.message);
        }

        throw new AnalysisInputError('The WAV file is invalid');
      }

      const analysis: Analysis = {
        id: createId(),
        accountId,
        status: 'queued',
        stage: 'queued',
        language: upload.language,
        contractVersion: upload.contractVersion,
        sourceAudioKey: upload.objectKey,
        sourceAudioSize: audio.byteLength,
        retainSourceAudio: upload.retainSourceAudio,
        sourceAudioRetentionUntil: upload.sourceAudioRetentionUntil ?? null,
        sourceAudioCleanupKey: null,
        retryOfAnalysisId: null,
        retryAnalysisId: null,
        createdAt: now(),
        result: null,
        failureMessage: null,
      };
      const storedAnalysis = await options.repository.finalizeUploadAndCreateAnalysis({
        accountId,
        uploadId,
        analysis,
      });

      await options.queue.enqueue({
        analysisId: storedAnalysis.id,
        language: storedAnalysis.language,
        contractVersion: storedAnalysis.contractVersion,
      });

      return storedAnalysis;
    },

    async getAnalysis(accountId: string, analysisId: string): Promise<Analysis> {
      let analysis = await options.repository.getAnalysis(accountId, analysisId);
      if (!analysis) {
        throw new AnalysisNotFoundError();
      }

      if (shouldForgetSourceAudio(analysis, now())) {
        await deleteAndForgetSourceAudioIfPresent(options, analysis, now);
        analysis = (await options.repository.getAnalysis(accountId, analysisId)) ?? analysis;
      }

      return analysis;
    },

    async cancelAnalysis(accountId: string, analysisId: string): Promise<Analysis> {
      const cancellation = await options.repository.cancelAnalysis(accountId, analysisId);
      if (!cancellation) {
        throw new AnalysisNotFoundError();
      }

      if (cancellation.analysis.status === 'canceled') {
        if (cancellation.sourceAudioKey) {
          await deleteAndForgetSourceAudio(
            options,
            cancellation.analysis.id,
            cancellation.sourceAudioKey,
          );
        }

        if (cancellation.changed) {
          options.audit?.record({
            action: 'canceled',
            analysisId: cancellation.analysis.id,
            status: 'canceled',
          });
          options.telemetry?.record({
            name: 'analysis.stage',
            analysisId: cancellation.analysis.id,
            stage: 'canceled',
            language: cancellation.analysis.language,
            contractVersion: cancellation.analysis.contractVersion,
          });
        }

        return cancellation.analysis;
      }

      throw new AnalysisConflictError(
        `Only queued or processing Analyses can be canceled; this Analysis is ${cancellation.analysis.status}.`,
      );
    },

    async retryAnalysis(accountId: string, analysisId: string): Promise<Analysis> {
      const original = await options.repository.getAnalysis(accountId, analysisId);
      if (!original) {
        throw new AnalysisNotFoundError();
      }

      if (original.retryAnalysisId) {
        const existingRetry = await options.repository.getAnalysis(
          accountId,
          original.retryAnalysisId,
        );
        if (existingRetry) {
          if (existingRetry.status === 'queued') {
            await options.queue.enqueue({
              analysisId: existingRetry.id,
              language: existingRetry.language,
              contractVersion: existingRetry.contractVersion,
            });
          }
          return existingRetry;
        }
      }

      if (original.status !== 'failed') {
        throw new AnalysisConflictError(
          `Only failed Analyses can be retried; this Analysis is ${original.status}.`,
        );
      }

      if (!original.retainSourceAudio || !original.sourceAudioKey) {
        throw new AnalysisRetryUnavailableError();
      }

      if (isSourceAudioExpired(original, now())) {
        await deleteAndForgetSourceAudioIfPresent(options, original, now);
        throw new AnalysisRetryUnavailableError();
      }

      const sourceAudio = await options.storage.stat(original.sourceAudioKey);
      if (!sourceAudio || sourceAudio.contentType !== 'audio/wav') {
        if (sourceAudio) {
          await deleteAndForgetSourceAudio(options, original.id, original.sourceAudioKey, now());
        } else {
          await options.repository.clearSourceAudio(original.id);
        }
        throw new AnalysisRetryUnavailableError();
      }

      const retry: Analysis = {
        id: createId(),
        accountId,
        status: 'queued',
        stage: 'queued',
        language: original.language,
        contractVersion: original.contractVersion,
        sourceAudioKey: original.sourceAudioKey,
        sourceAudioSize: original.sourceAudioSize ?? sourceAudio.size,
        retainSourceAudio: true,
        sourceAudioRetentionUntil: original.sourceAudioRetentionUntil ?? null,
        sourceAudioCleanupKey: null,
        retryOfAnalysisId: original.id,
        retryAnalysisId: null,
        createdAt: now(),
        result: null,
        failureMessage: null,
      };
      const retryResult = await options.repository.retryFailedAnalysis({
        accountId,
        failedAnalysisId: original.id,
        analysis: retry,
      });

      if (!retryResult) {
        const current = await options.repository.getAnalysis(accountId, original.id);
        if (current?.retryAnalysisId) {
          const existingRetry = await options.repository.getAnalysis(
            accountId,
            current.retryAnalysisId,
          );
          if (existingRetry) {
            if (existingRetry.status === 'queued') {
              await options.queue.enqueue({
                analysisId: existingRetry.id,
                language: existingRetry.language,
                contractVersion: existingRetry.contractVersion,
              });
            }
            return existingRetry;
          }
        }

        throw new AnalysisRetryUnavailableError();
      }

      if (retryResult.analysis.status === 'queued') {
        await options.queue.enqueue({
          analysisId: retryResult.analysis.id,
          language: retryResult.analysis.language,
          contractVersion: retryResult.analysis.contractVersion,
        });
      }

      if (retryResult.created) {
        options.audit?.record({
          action: 'retried',
          analysisId: original.id,
          linkedAnalysisId: retryResult.analysis.id,
          status: 'failed',
        });
        options.telemetry?.record({
          name: 'analysis.queued',
          analysisId: retryResult.analysis.id,
          stage: 'queued',
          language: retryResult.analysis.language,
          contractVersion: retryResult.analysis.contractVersion,
        });
      }

      return retryResult.analysis;
    },

    async processAnalysis(job: AnalysisJob): Promise<void> {
      const analysis = await options.repository.beginProcessing(job.analysisId, now());
      if (!analysis || !analysis.sourceAudioKey || !options.researchClient) {
        return;
      }

      options.telemetry?.record({
        name: 'analysis.stage',
        analysisId: analysis.id,
        stage: 'processing',
        language: analysis.language,
        contractVersion: analysis.contractVersion,
      });

      try {
        const audio = await options.storage.read(analysis.sourceAudioKey);
        const result = await options.researchClient.analyze({
          analysisId: analysis.id,
          language: analysis.language,
          contractVersion: analysis.contractVersion,
          audio,
        });

        const completed = await options.repository.completeAnalysis(analysis.id, result);
        if (completed) {
          options.telemetry?.record({
            name: 'analysis.stage',
            analysisId: analysis.id,
            stage: 'completed',
            language: analysis.language,
            contractVersion: analysis.contractVersion,
          });
        }
      } catch {
        const failed = await options.repository.failAnalysis(analysis.id, safeFailureMessage);
        if (failed) {
          options.audit?.record({
            action: 'failed',
            analysisId: analysis.id,
            status: 'failed',
            reasonCode: 'research_system_failure',
          });
          options.telemetry?.record({
            name: 'analysis.stage',
            analysisId: analysis.id,
            stage: 'failed',
            language: analysis.language,
            contractVersion: analysis.contractVersion,
          });
        }
      } finally {
        const current = await options.repository.getAnalysisForWorker(analysis.id);
        const cleanupCandidate = current ?? analysis;
        if (shouldForgetSourceAudio(cleanupCandidate, now())) {
          await deleteAndForgetSourceAudioIfPresent(options, cleanupCandidate, now);
        }
      }
    },
  };
}

async function deleteBestEffort(storage: SourceAudioStorage, objectKey: string): Promise<void> {
  try {
    await storage.delete(objectKey);
  } catch {
    // Invalid uploads never become Analysis rows, so there is no lifecycle record to retry.
  }
}

async function deleteAndForgetSourceAudio(
  options: AnalysisServiceOptions,
  analysisId: string,
  objectKey: string,
  at = new Date(),
): Promise<void> {
  try {
    if (await options.repository.hasSourceAudioReference(objectKey, analysisId, at)) {
      await options.repository.clearSourceAudio(analysisId);
      return;
    }
  } catch {
    return;
  }

  try {
    await options.storage.delete(objectKey);
  } catch {
    return;
  }

  try {
    await options.repository.clearSourceAudio(analysisId);
  } catch {
    // Cleanup remains safe to repeat if the database update is temporarily unavailable.
  }
}

async function deleteAndForgetSourceAudioIfPresent(
  options: AnalysisServiceOptions,
  analysis: Analysis,
  now: () => Date,
): Promise<void> {
  const objectKey = analysis.sourceAudioKey ?? analysis.sourceAudioCleanupKey;
  if (!objectKey || !shouldForgetSourceAudio(analysis, now())) return;
  await deleteAndForgetSourceAudio(options, analysis.id, objectKey, now());
}

function shouldForgetSourceAudio(analysis: Analysis, at: Date): boolean {
  return Boolean(
    (analysis.sourceAudioKey || analysis.sourceAudioCleanupKey) &&
    (analysis.retainSourceAudio !== true || isSourceAudioExpired(analysis, at)),
  );
}

function isSourceAudioExpired(analysis: Analysis, at: Date): boolean {
  return Boolean(
    analysis.retainSourceAudio === true &&
    analysis.sourceAudioRetentionUntil &&
    analysis.sourceAudioRetentionUntil.getTime() <= at.getTime(),
  );
}
