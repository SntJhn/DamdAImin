import { describe, expect, it, vi } from 'vitest';

import {
  type Analysis,
  type AnalysisAuditEvent,
  type AnalysisRepository,
  type AnalysisUpload,
  createAnalysisServices,
  type SourceAudioStorage,
} from './analysis.js';

function createPcmWav(): Uint8Array {
  const sampleRateHz = 16_000;
  const dataByteLength = sampleRateHz * 2;
  const bytes = new Uint8Array(44 + dataByteLength);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (const [index, character] of Array.from(value).entries()) {
    view.setUint8(offset + index, character.charCodeAt(0));
  }
}

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

  async completeAnalysis(analysisId: string, nextResult: Analysis['result']): Promise<boolean> {
    const analysis = this.analyses.get(analysisId);
    if (!analysis || analysis.status !== 'processing' || !nextResult) return false;
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
      (candidate) =>
        candidate.id !== excludingAnalysisId &&
        candidate.sourceAudioKey === objectKey &&
        candidate.status !== 'canceled' &&
        (candidate.status === 'queued' ||
          candidate.status === 'processing' ||
          (candidate.retainSourceAudio === true &&
            (!candidate.sourceAudioRetentionUntil ||
              candidate.sourceAudioRetentionUntil.getTime() > at.getTime()))),
    );
  }

  async retryFailedAnalysis(input: {
    accountId: string;
    failedAnalysisId: string;
    analysis: Analysis;
  }) {
    const original = this.analyses.get(input.failedAnalysisId);
    if (original?.accountId !== input.accountId) return null;
    if (!original || original.status !== 'failed' || original.retryAnalysisId) return null;
    this.analyses.set(original.id, { ...original, retryAnalysisId: input.analysis.id });
    this.analyses.set(input.analysis.id, input.analysis);
    return { analysis: input.analysis, created: true };
  }

  async cancelAnalysis(accountId: string, analysisId: string) {
    const analysis = await this.getAnalysis(accountId, analysisId);
    if (!analysis) return null;
    if (analysis.status === 'queued' || analysis.status === 'processing') {
      const sourceAudioIsShared = [...this.analyses.values()].some(
        (candidate) =>
          candidate.id !== analysis.id &&
          candidate.sourceAudioKey === analysis.sourceAudioKey &&
          candidate.status !== 'canceled' &&
          (candidate.status === 'queued' ||
            candidate.status === 'processing' ||
            (candidate.retainSourceAudio === true &&
              (!candidate.sourceAudioRetentionUntil ||
                candidate.sourceAudioRetentionUntil.getTime() > Date.now()))),
      );
      const canceled = {
        ...analysis,
        status: 'canceled' as const,
        stage: 'canceled' as const,
        sourceAudioKey: null,
        sourceAudioSize: null,
        retainSourceAudio: false,
        sourceAudioRetentionUntil: null,
        sourceAudioCleanupKey: sourceAudioIsShared ? null : analysis.sourceAudioKey,
        result: null,
        failureMessage: null,
      };
      this.analyses.set(analysisId, canceled);
      if (analysis.retryOfAnalysisId) {
        const parent = this.analyses.get(analysis.retryOfAnalysisId);
        if (parent?.retryAnalysisId === analysis.id) {
          this.analyses.set(parent.id, { ...parent, retryAnalysisId: null });
        }
      }
      return {
        analysis: canceled,
        sourceAudioKey: sourceAudioIsShared ? null : analysis.sourceAudioKey,
        changed: true,
      };
    }

    return {
      analysis,
      sourceAudioKey:
        analysis.status === 'canceled' ? (analysis.sourceAudioCleanupKey ?? null) : null,
      changed: false,
    };
  }
}

class MemoryStorage implements SourceAudioStorage {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  deleteCalls: string[] = [];
  deleteFailures = 0;

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
    this.deleteCalls.push(objectKey);
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1;
      throw new Error('storage unavailable');
    }
    this.objects.delete(objectKey);
  }
}

describe('Analysis lifecycle application service', () => {
  it('cancels a queued Analysis idempotently and removes submitted content', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const auditEvents: AnalysisAuditEvent[] = [];
    const services = createAnalysisServices({
      repository,
      storage,
      queue: { enqueue: async () => undefined },
      audit: { record: (event) => auditEvents.push(event) },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id'];
        return () => ids.shift()!;
      })(),
    });

    const upload = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(upload.upload.objectKey, {
      bytes: createPcmWav(),
      contentType: 'audio/wav',
    });
    const queued = await services.finalizeUpload('account-a', upload.upload.id);

    await expect(services.cancelAnalysis!('account-b', queued.id)).rejects.toThrow(
      'Analysis was not found',
    );
    const canceled = await services.cancelAnalysis!('account-a', queued.id);
    const repeated = await services.cancelAnalysis!('account-a', queued.id);

    expect(canceled).toMatchObject({
      id: queued.id,
      status: 'canceled',
      stage: 'canceled',
      sourceAudioKey: null,
      sourceAudioSize: null,
      result: null,
      failureMessage: null,
    });
    expect(repeated).toMatchObject({ id: queued.id, status: 'canceled' });
    expect(storage.deleteCalls).toEqual([upload.upload.objectKey]);
    expect(storage.objects.has(upload.upload.objectKey)).toBe(false);
    expect(auditEvents).toEqual([
      { action: 'canceled', analysisId: queued.id, status: 'canceled' },
    ]);
  });

  it('discards an in-flight research response after cancellation wins the commit race', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    let resolveResearch: ((value: Analysis['result']) => void) | undefined;
    const researchFinished = new Promise<Analysis['result']>((resolve) => {
      resolveResearch = resolve;
    });
    const services = createAnalysisServices({
      repository,
      storage,
      queue: { enqueue: async () => undefined },
      researchClient: { analyze: async () => (await researchFinished)! },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id'];
        return () => ids.shift()!;
      })(),
    });

    const upload = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(upload.upload.objectKey, {
      bytes: createPcmWav(),
      contentType: 'audio/wav',
    });
    const queued = await services.finalizeUpload('account-a', upload.upload.id);
    const processing = services.processAnalysis({
      analysisId: queued.id,
      language: queued.language,
      contractVersion: queued.contractVersion,
    });

    await vi.waitFor(async () => {
      expect((await repository.getAnalysis('account-a', queued.id))?.status).toBe('processing');
    });
    await services.cancelAnalysis!('account-a', queued.id);
    resolveResearch?.(null);
    await processing;

    expect(repository.analyses.get(queued.id)).toMatchObject({
      status: 'canceled',
      stage: 'canceled',
      result: null,
      sourceAudioKey: null,
    });
    expect(storage.objects.has(upload.upload.objectKey)).toBe(false);
  });

  it('keeps consented Source Audio after failure and creates one linked retry', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const jobs: Array<{ analysisId: string }> = [];
    const auditEvents: AnalysisAuditEvent[] = [];
    let calls = 0;
    const services = createAnalysisServices({
      repository,
      storage,
      queue: {
        enqueue: async (job) => {
          jobs.push(job);
        },
      },
      audit: { record: (event) => auditEvents.push(event) },
      researchClient: {
        analyze: async () => {
          calls += 1;
          if (calls === 1) throw new Error('SENTINEL_RESEARCH_FAILURE');
          return {
            outcome: 'inconclusive' as const,
            confidence: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
            transcript: '',
            explanation: 'Insufficient evidence.',
            technicalTrace: {
              cueSpans: [],
              activatedRules: [],
              scoreAdjustments: [],
              probabilities: {
                before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
                after: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
              },
            },
            contractVersion: 'taglish-v2',
            schemaVersion: 'research-response-v2',
            modelVersion: 'fake-model-1',
            preprocessingVersion: 'fake-preprocessing-1',
            ruleSetVersion: 'fake-rules-1',
          };
        },
      },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id', 'retry-id', 'ignored-retry-id'];
        return () => ids.shift()!;
      })(),
    });

    const upload = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
      retainSourceAudio: true,
    });
    storage.objects.set(upload.upload.objectKey, {
      bytes: createPcmWav(),
      contentType: 'audio/wav',
    });
    const failed = await services.finalizeUpload('account-a', upload.upload.id);
    await services.processAnalysis({
      analysisId: failed.id,
      language: failed.language,
      contractVersion: failed.contractVersion,
    });

    const [retry, repeatedRetry] = await Promise.all([
      services.retryAnalysis!('account-a', failed.id),
      services.retryAnalysis!('account-a', failed.id),
    ]);
    await services.processAnalysis({
      analysisId: retry.id,
      language: retry.language,
      contractVersion: retry.contractVersion,
    });

    expect(retry).toMatchObject({
      id: 'retry-id',
      status: 'queued',
      retryOfAnalysisId: failed.id,
      sourceAudioKey: upload.upload.objectKey,
    });
    expect(repeatedRetry.id).toBe(retry.id);
    expect(repository.analyses.get(failed.id)).toMatchObject({
      status: 'failed',
      result: null,
      failureMessage: expect.not.stringContaining('SENTINEL_RESEARCH_FAILURE'),
      sourceAudioKey: upload.upload.objectKey,
      retryAnalysisId: retry.id,
    });
    expect(repository.analyses.get(retry.id)).toMatchObject({
      status: 'completed',
      result: { outcome: 'inconclusive' },
    });
    expect(repository.analyses.size).toBe(2);
    expect(jobs.map(({ analysisId }) => analysisId)).toEqual([failed.id, retry.id, retry.id]);
    expect(storage.objects.has(upload.upload.objectKey)).toBe(true);
    expect(auditEvents).toEqual([
      {
        action: 'failed',
        analysisId: failed.id,
        status: 'failed',
        reasonCode: 'research_system_failure',
      },
      {
        action: 'retried',
        analysisId: failed.id,
        linkedAnalysisId: retry.id,
        status: 'failed',
      },
    ]);
  });

  it('does not offer retry after failure when Source Audio was not retained', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const services = createAnalysisServices({
      repository,
      storage,
      queue: { enqueue: async () => undefined },
      researchClient: {
        analyze: async () => {
          throw new Error('SENTINEL');
        },
      },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id', 'retry-id'];
        return () => ids.shift()!;
      })(),
    });

    const upload = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(upload.upload.objectKey, {
      bytes: createPcmWav(),
      contentType: 'audio/wav',
    });
    const failed = await services.finalizeUpload('account-a', upload.upload.id);
    await services.processAnalysis({
      analysisId: failed.id,
      language: failed.language,
      contractVersion: failed.contractVersion,
    });

    await expect(services.retryAnalysis!('account-a', failed.id)).rejects.toThrow(
      'retained Source Audio is unavailable',
    );
    expect(repository.analyses.get(failed.id)).toMatchObject({
      status: 'failed',
      sourceAudioKey: null,
      sourceAudioSize: null,
    });
    expect(storage.objects.has(upload.upload.objectKey)).toBe(false);
  });

  it('keeps shared Source Audio when a queued retry is canceled and releases the retry link', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const services = createAnalysisServices({
      repository,
      storage,
      queue: { enqueue: async () => undefined },
      researchClient: {
        analyze: async () => {
          throw new Error('SENTINEL');
        },
      },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id', 'retry-id', 'retry-again-id'];
        return () => ids.shift()!;
      })(),
    });

    const upload = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
      retainSourceAudio: true,
    });
    storage.objects.set(upload.upload.objectKey, {
      bytes: createPcmWav(),
      contentType: 'audio/wav',
    });
    const failed = await services.finalizeUpload('account-a', upload.upload.id);
    await services.processAnalysis({
      analysisId: failed.id,
      language: failed.language,
      contractVersion: failed.contractVersion,
    });

    const retry = await services.retryAnalysis('account-a', failed.id);
    const canceled = await services.cancelAnalysis('account-a', retry.id);

    expect(canceled).toMatchObject({ status: 'canceled', sourceAudioKey: null });
    expect(repository.analyses.get(failed.id)).toMatchObject({
      status: 'failed',
      retryAnalysisId: null,
      sourceAudioKey: upload.upload.objectKey,
    });
    expect(storage.deleteCalls).toEqual([]);
    expect(storage.objects.has(upload.upload.objectKey)).toBe(true);

    const retryAgain = await services.retryAnalysis('account-a', failed.id);
    expect(retryAgain).toMatchObject({
      id: 'retry-again-id',
      retryOfAnalysisId: failed.id,
      sourceAudioKey: upload.upload.objectKey,
    });
  });

  it('expires retained Source Audio after the controllable retention deadline', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    let currentTime = new Date('2026-08-05T00:00:00.000Z');
    const services = createAnalysisServices({
      repository,
      storage,
      queue: { enqueue: async () => undefined },
      now: () => currentTime,
      researchClient: {
        analyze: async () => {
          throw new Error('SENTINEL');
        },
      },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id', 'retry-id'];
        return () => ids.shift()!;
      })(),
    });

    const upload = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
      retainSourceAudio: true,
    });
    storage.objects.set(upload.upload.objectKey, {
      bytes: createPcmWav(),
      contentType: 'audio/wav',
    });
    const failed = await services.finalizeUpload('account-a', upload.upload.id);
    await services.processAnalysis({
      analysisId: failed.id,
      language: failed.language,
      contractVersion: failed.contractVersion,
    });

    currentTime = new Date('2026-09-05T00:00:01.000Z');
    await expect(services.retryAnalysis('account-a', failed.id)).rejects.toThrow(
      'retained Source Audio is unavailable',
    );

    expect(repository.analyses.get(failed.id)).toMatchObject({
      status: 'failed',
      sourceAudioKey: null,
      retainSourceAudio: false,
    });
    expect(storage.objects.has(upload.upload.objectKey)).toBe(false);
  });

  it('retries a failed Source Audio deletion on the next durable read', async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    storage.deleteFailures = 1;
    const services = createAnalysisServices({
      repository,
      storage,
      queue: { enqueue: async () => undefined },
      researchClient: {
        analyze: async () => {
          throw new Error('SENTINEL');
        },
      },
      createId: (() => {
        const ids = ['upload-id', 'analysis-id'];
        return () => ids.shift()!;
      })(),
    });

    const upload = await services.createUpload({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });
    storage.objects.set(upload.upload.objectKey, {
      bytes: createPcmWav(),
      contentType: 'audio/wav',
    });
    const failed = await services.finalizeUpload('account-a', upload.upload.id);
    await services.processAnalysis({
      analysisId: failed.id,
      language: failed.language,
      contractVersion: failed.contractVersion,
    });

    expect(repository.analyses.get(failed.id)?.sourceAudioKey).toBe(upload.upload.objectKey);
    expect(storage.objects.has(upload.upload.objectKey)).toBe(true);

    const reread = await services.getAnalysis('account-a', failed.id);
    expect(reread.sourceAudioKey).toBeNull();
    expect(storage.objects.has(upload.upload.objectKey)).toBe(false);
  });
});
