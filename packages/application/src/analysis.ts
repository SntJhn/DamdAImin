import { randomUUID } from 'node:crypto';

import {
  analysisLanguages,
  type AnalysisLanguage,
  type AnalysisResult,
  type AnalysisStatus,
  inspectWavAudio,
} from '@damdai/domain';

export type AnalysisUploadStatus = 'created' | 'finalized';

export interface AnalysisUpload {
  id: string;
  accountId: string;
  objectKey: string;
  language: AnalysisLanguage;
  contractVersion: string;
  contentType: 'audio/wav';
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
  beginProcessing(analysisId: string): Promise<Analysis | null>;
  completeAnalysis(analysisId: string, result: AnalysisResult): Promise<boolean>;
  failAnalysis(analysisId: string, message: string): Promise<boolean>;
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
  }): Promise<CreatedAnalysisUpload>;
  finalizeUpload(accountId: string, uploadId: string): Promise<Analysis>;
  getAnalysis(accountId: string, analysisId: string): Promise<Analysis>;
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

export function createAnalysisServices(options: AnalysisServiceOptions): AnalysisServices {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const uploadLifetimeMs = options.uploadLifetimeMs ?? 15 * 60 * 1000;

  return {
    async createUpload(input: {
      accountId: string;
      language: AnalysisLanguage;
      contractVersion: string;
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
      const analysis = await options.repository.getAnalysis(accountId, analysisId);
      if (!analysis) {
        throw new AnalysisNotFoundError();
      }

      return analysis;
    },

    async processAnalysis(job: AnalysisJob): Promise<void> {
      const analysis = await options.repository.beginProcessing(job.analysisId);
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
        const failed = await options.repository.failAnalysis(
          analysis.id,
          'The Research System could not complete this Analysis.',
        );
        if (failed) {
          options.telemetry?.record({
            name: 'analysis.stage',
            analysisId: analysis.id,
            stage: 'failed',
            language: analysis.language,
            contractVersion: analysis.contractVersion,
          });
        }
      } finally {
        await deleteBestEffort(options.storage, analysis.sourceAudioKey);
      }
    },
  };
}

async function deleteBestEffort(storage: SourceAudioStorage, objectKey: string): Promise<void> {
  try {
    await storage.delete(objectKey);
  } catch {
    // Storage cleanup is retried by the durable lifecycle work in a later slice.
  }
}
