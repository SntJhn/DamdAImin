import { describe, expect, it, vi } from 'vitest';

import type { AnalysisResult } from '@damdai/domain';

import {
  type Analysis,
  type AnalysisTelemetry,
  type AnalysisQueue,
  type AnalysisRepository,
  createAnalysisServices,
  type AnalysisUpload,
  type SourceAudioStorage,
} from './analysis.js';

function createPcmWav(durationSeconds: number): Uint8Array {
  const sampleRateHz = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataByteLength = sampleRateHz * durationSeconds * 2;
  const bytes = new Uint8Array(44 + dataByteLength);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (const [index, character] of Array.from(value).entries()) {
    view.setUint8(offset + index, character.charCodeAt(0));
  }
}

const result: AnalysisResult = {
  outcome: 'definitive',
  emotionClassification: 'happiness',
  confidence: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
  transcript: 'masaya ako',
  explanation: 'The synthetic fixture contains the deterministic happy cue.',
  technicalTrace: {
    cueSpans: [
      {
        source: 'linguistic',
        startMs: 0,
        endMs: 400,
        cue: 'positive lexical cue',
        value: 'masaya',
      },
    ],
    activatedRules: [{ id: 'synthetic-rule', description: 'Synthetic fixture rule.' }],
    scoreAdjustments: [
      {
        emotionClassification: 'happiness',
        delta: 0.66,
        reason: 'Synthetic fixture evidence.',
      },
    ],
    probabilities: {
      before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
      after: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
    },
  },
  contractVersion: 'taglish-v2',
  schemaVersion: 'research-response-v2',
  modelVersion: 'fake-model-1',
  preprocessingVersion: 'fake-preprocess-1',
  ruleSetVersion: 'fake-rules-1',
};

class MemoryRepository implements AnalysisRepository {
  uploads = new Map<string, AnalysisUpload>();
  analyses = new Map<string, Analysis>();

  async createUpload(upload: AnalysisUpload): Promise<AnalysisUpload> {
    this.uploads.set(upload.id, upload);
    return upload;
  }

  async getUpload(_accountId: string, uploadId: string): Promise<AnalysisUpload | null> {
    return this.uploads.get(uploadId) ?? null;
  }

  async finalizeUploadAndCreateAnalysis(input: {
    accountId: string;
    uploadId: string;
    analysis: Analysis;
  }): Promise<Analysis> {
    const upload = this.uploads.get(input.uploadId);
    if (!upload) throw new Error('missing upload');
    if (upload.analysisId) return this.analyses.get(upload.analysisId)!;

    this.uploads.set(input.uploadId, {
      ...upload,
      status: 'finalized',
      analysisId: input.analysis.id,
    });
    this.analyses.set(input.analysis.id, input.analysis);
    return input.analysis;
  }

  async getAnalysis(accountId: string, analysisId: string): Promise<Analysis | null> {
    const analysis = this.analyses.get(analysisId);
    return analysis?.accountId === accountId ? analysis : null;
  }

  async getAnalysisForWorker(analysisId: string): Promise<Analysis | null> {
    return this.analyses.get(analysisId) ?? null;
  }

  async beginProcessing(analysisId: string): Promise<Analysis | null> {
    const analysis = this.analyses.get(analysisId);
    if (!analysis || analysis.status !== 'queued') return null;
    const processing = { ...analysis, status: 'processing' as const, stage: 'processing' as const };
    this.analyses.set(analysisId, processing);
    return processing;
  }

  async completeAnalysis(analysisId: string, nextResult: AnalysisResult): Promise<boolean> {
    const analysis = this.analyses.get(analysisId);
    if (!analysis || analysis.status !== 'processing' || analysis.result) return false;
    this.analyses.set(analysisId, {
      ...analysis,
      status: 'completed',
      stage: 'completed',
      result: nextResult,
    });
    return true;
  }

  async failAnalysis(analysisId: string, message: string): Promise<boolean> {
    const analysis = this.analyses.get(analysisId);
    if (!analysis || analysis.status !== 'processing') return false;
    this.analyses.set(analysisId, {
      ...analysis,
      status: 'failed',
      stage: 'failed',
      result: null,
      failureMessage: message,
    });
    return true;
  }

  async cancelAnalysis(accountId: string, analysisId: string) {
    const analysis = await this.getAnalysis(accountId, analysisId);
    if (!analysis) return null;
    if (analysis.status !== 'queued' && analysis.status !== 'processing') {
      return { analysis, sourceAudioKey: null, changed: false };
    }

    const canceled = {
      ...analysis,
      status: 'canceled' as const,
      stage: 'canceled' as const,
      sourceAudioKey: null,
      sourceAudioSize: null,
      retainSourceAudio: false,
      result: null,
      failureMessage: null,
    };
    this.analyses.set(analysisId, canceled);
    return { analysis: canceled, sourceAudioKey: analysis.sourceAudioKey, changed: true };
  }

  async clearSourceAudio(analysisId: string): Promise<boolean> {
    const analysis = this.analyses.get(analysisId);
    if (!analysis) return false;
    this.analyses.set(analysisId, {
      ...analysis,
      sourceAudioKey: null,
      sourceAudioSize: null,
      retainSourceAudio: false,
      sourceAudioRetentionUntil: null,
      sourceAudioCleanupKey: null,
    });
    return true;
  }

  async hasSourceAudioReference(
    objectKey: string,
    excludingAnalysisId: string,
    at = new Date(),
  ): Promise<boolean> {
    return [...this.analyses.values()].some(
      (analysis) =>
        analysis.id !== excludingAnalysisId &&
        analysis.sourceAudioKey === objectKey &&
        analysis.status !== 'canceled' &&
        (analysis.status === 'queued' ||
          analysis.status === 'processing' ||
          (analysis.retainSourceAudio === true &&
            (!analysis.sourceAudioRetentionUntil ||
              analysis.sourceAudioRetentionUntil.getTime() > at.getTime()))),
    );
  }

  async retryFailedAnalysis(input: {
    accountId: string;
    failedAnalysisId: string;
    analysis: Analysis;
  }) {
    const original = this.analyses.get(input.failedAnalysisId);
    if (
      !original ||
      original.accountId !== input.accountId ||
      original.status !== 'failed' ||
      original.retryAnalysisId
    ) {
      return null;
    }

    this.analyses.set(original.id, { ...original, retryAnalysisId: input.analysis.id });
    this.analyses.set(input.analysis.id, input.analysis);
    return { analysis: input.analysis, created: true };
  }
}

class MemoryStorage implements SourceAudioStorage {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async createUpload(input: { objectKey: string; expiresAt: Date }) {
    void input.expiresAt;
    return {
      uploadUrl: `https://storage.test/${encodeURIComponent(input.objectKey)}`,
      uploadMethod: 'PUT' as const,
      uploadHeaders: { 'content-type': 'audio/wav' as const },
    };
  }

  async stat(objectKey: string) {
    const object = this.objects.get(objectKey);
    return object ? { contentType: object.contentType, size: object.bytes.byteLength } : null;
  }

  async read(objectKey: string) {
    const object = this.objects.get(objectKey);
    if (!object) throw new Error('missing object');
    return object.bytes;
  }

  async delete(objectKey: string) {
    this.objects.delete(objectKey);
  }
}

describe('Analysis application service', () => {
  it('validates the uploaded WAV, queues only the durable analysis metadata, and completes it', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const jobs: unknown[] = [];
    const telemetry: AnalysisTelemetry = { record: vi.fn() };
    const queue: AnalysisQueue = {
      enqueue: async (job) => {
        jobs.push(job);
      },
    };
    const ids = ['upload-id', 'analysis-id'];
    const analyze = vi.fn(async () => result);
    const services = createAnalysisServices({
      repository,
      storage,
      queue,
      createId: () => ids.shift()!,
      researchClient: { analyze },
      telemetry,
      now: () => new Date('2026-08-02T00:00:00.000Z'),
    });

    const created = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(created.upload.objectKey, {
      bytes: createPcmWav(2),
      contentType: 'audio/wav',
    });

    const queued = await services.finalizeUpload('account-a', created.upload.id);
    expect(queued).toMatchObject({ id: 'analysis-id', status: 'queued', language: 'taglish' });
    expect(jobs).toEqual([
      { analysisId: 'analysis-id', language: 'taglish', contractVersion: 'taglish-v2' },
    ]);

    await services.processAnalysis(jobs[0] as never);
    await services.processAnalysis(jobs[0] as never);
    expect(repository.analyses.get('analysis-id')).toMatchObject({
      status: 'completed',
      result,
    });
    expect(analyze).toHaveBeenCalledOnce();
    expect(storage.objects.has(created.upload.objectKey)).toBe(false);
    expect(telemetry.record).toHaveBeenCalledWith({
      name: 'analysis.stage',
      analysisId: 'analysis-id',
      stage: 'processing',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    expect(telemetry.record).toHaveBeenCalledWith({
      name: 'analysis.stage',
      analysisId: 'analysis-id',
      stage: 'completed',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
  });

  it('rejects invalid WAV data before queueing an Analysis', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const queue: AnalysisQueue = { enqueue: async () => undefined };
    const services = createAnalysisServices({
      repository,
      storage,
      queue,
      createId: (() => {
        const ids = ['upload-id', 'analysis-id'];
        return () => ids.shift()!;
      })(),
    });
    const created = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(created.upload.objectKey, {
      bytes: new TextEncoder().encode('not a wav'),
      contentType: 'audio/wav',
    });

    await expect(services.finalizeUpload('account-a', created.upload.id)).rejects.toThrow(
      'WAV data is too short',
    );
    expect(repository.analyses.size).toBe(0);
  });

  it('records a failed stage and deletes Source Audio when Research fails', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const telemetry: AnalysisTelemetry = { record: vi.fn() };
    const services = createAnalysisServices({
      repository,
      storage,
      queue: { enqueue: async () => undefined },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id'];
        return () => ids.shift()!;
      })(),
      researchClient: {
        analyze: vi.fn(async () => {
          throw new Error('SENTINEL_RESEARCH_FAILURE');
        }),
      },
      telemetry,
    });
    const created = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(created.upload.objectKey, {
      bytes: createPcmWav(2),
      contentType: 'audio/wav',
    });

    const queued = await services.finalizeUpload('account-a', created.upload.id);
    await services.processAnalysis({
      analysisId: queued.id,
      language: queued.language,
      contractVersion: queued.contractVersion,
    });

    expect(repository.analyses.get(queued.id)).toMatchObject({
      status: 'failed',
      stage: 'failed',
      result: null,
    });
    expect(storage.objects.has(created.upload.objectKey)).toBe(false);
    expect(telemetry.record).toHaveBeenCalledWith({
      name: 'analysis.stage',
      analysisId: queued.id,
      stage: 'processing',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    expect(telemetry.record).toHaveBeenCalledWith({
      name: 'analysis.stage',
      analysisId: queued.id,
      stage: 'failed',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
  });

  it('re-enqueues an already-finalized queued Analysis after a queue failure', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const jobs: unknown[] = [];
    let failFirstEnqueue = true;
    const queue: AnalysisQueue = {
      enqueue: async (job) => {
        jobs.push(job);
        if (failFirstEnqueue) {
          failFirstEnqueue = false;
          throw new Error('queue unavailable');
        }
      },
    };
    const ids = ['upload-id', 'analysis-id'];
    const services = createAnalysisServices({
      repository,
      storage,
      queue,
      createId: () => ids.shift()!,
      now: () => new Date('2026-08-02T00:00:00.000Z'),
    });

    const created = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(created.upload.objectKey, {
      bytes: createPcmWav(2),
      contentType: 'audio/wav',
    });

    await expect(services.finalizeUpload('account-a', created.upload.id)).rejects.toThrow(
      'queue unavailable',
    );
    const retried = await services.finalizeUpload('account-a', created.upload.id);

    expect(retried).toMatchObject({ id: 'analysis-id', status: 'queued' });
    expect(jobs).toEqual([
      { analysisId: 'analysis-id', language: 'taglish', contractVersion: 'taglish-v2' },
      { analysisId: 'analysis-id', language: 'taglish', contractVersion: 'taglish-v2' },
    ]);
  });
});
