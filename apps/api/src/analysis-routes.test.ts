import { Writable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Analysis, AnalysisServices, AnalysisTelemetryEvent } from '@damdai/application';
import { createPrivacySafeLogger } from '@damdai/infrastructure';

import { buildApi } from './app.js';

const analysis: Analysis = {
  id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
  accountId: 'account-a',
  status: 'queued',
  stage: 'queued',
  language: 'taglish',
  contractVersion: 'taglish-v1',
  sourceAudioKey: 'accounts/account-a/source-audio/upload-id.wav',
  sourceAudioSize: 64_044,
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  result: null,
  failureMessage: null,
};

function createServices(): AnalysisServices {
  return {
    createUpload: vi.fn(async () => ({
      upload: {
        id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
        accountId: 'account-a',
        objectKey: 'accounts/account-a/source-audio/upload.wav',
        language: 'taglish' as const,
        contractVersion: 'taglish-v1',
        contentType: 'audio/wav' as const,
        status: 'created' as const,
        expiresAt: new Date('2026-08-02T00:15:00.000Z'),
        analysisId: null,
      },
      uploadUrl: 'http://localhost:4443/upload/storage/v1/b/damdai-source-audio/o',
      uploadMethod: 'PUT' as const,
      uploadHeaders: { 'content-type': 'audio/wav' as const },
    })),
    finalizeUpload: vi.fn(async () => analysis),
    getAnalysis: vi.fn(async () => analysis),
    processAnalysis: vi.fn(async () => undefined),
  };
}

describe('Analysis REST boundary', () => {
  const applications = [] as ReturnType<typeof buildApi>[];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
  });

  it('creates an operation-scoped upload for the authenticated account', async () => {
    const analysisServices = createServices();
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      analysisServices,
    });
    applications.push(application);

    const response = await application.inject({
      method: 'POST',
      url: '/api/v1/analysis-uploads',
      headers: { authorization: 'Bearer verified-token' },
      payload: { language: 'taglish', contractVersion: 'taglish-v1' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      uploadId: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
      uploadMethod: 'PUT',
      uploadHeaders: { 'content-type': 'audio/wav' },
    });
    expect(analysisServices.createUpload).toHaveBeenCalledWith({
      accountId: 'account-a',
      language: 'taglish',
      contractVersion: 'taglish-v1',
    });
  });

  it('returns 202 and a durable resource location after finalization', async () => {
    const analysisServices = createServices();
    const telemetryEvents: AnalysisTelemetryEvent[] = [];
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      analysisServices,
      telemetry: { record: (event) => telemetryEvents.push(event) },
    });
    applications.push(application);

    const response = await application.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer verified-token' },
      payload: { uploadId: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers.location).toBe('/api/v1/analyses/8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01');
    expect(response.json()).toMatchObject({
      analysis: { id: analysis.id, status: 'queued', stage: 'queued', language: 'taglish' },
      location: '/api/v1/analyses/8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
    });
    expect(telemetryEvents).toEqual([
      {
        name: 'analysis.queued',
        requestId: expect.any(String),
        analysisId: analysis.id,
        stage: 'queued',
        language: 'taglish',
        contractVersion: 'taglish-v1',
      },
    ]);
  });

  it('reads a single Analysis through the authenticated ownership boundary', async () => {
    const analysisServices = createServices();
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      analysisServices,
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: `/api/v1/analyses/${analysis.id}`,
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: analysis.id, status: 'queued' });
    expect(analysisServices.getAnalysis).toHaveBeenCalledWith('account-a', analysis.id);
  });

  it('normalizes request schema failures into an accessible validation response', async () => {
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      analysisServices: createServices(),
    });
    applications.push(application);

    const response = await application.inject({
      method: 'POST',
      url: '/api/v1/analysis-uploads',
      headers: { authorization: 'Bearer verified-token' },
      payload: { language: 'taglish' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_error',
      message: 'The request did not match the required contract.',
    });
  });

  it('redacts sensitive runtime failure details from API logs', async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const analysisServices = createServices();
    analysisServices.finalizeUpload = vi.fn(async () => {
      throw new Error('SENTINEL_TRANSCRIPT');
    });
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      analysisServices,
      loggerInstance: createPrivacySafeLogger({ name: 'api-runtime-test' }, destination),
    });
    applications.push(application);

    const response = await application.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer verified-token' },
      payload: { uploadId: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a' },
    });

    expect(response.statusCode).toBe(503);
    const output = chunks.join('');
    expect(output).toContain('analysis submission unavailable');
    expect(output).not.toContain('SENTINEL_TRANSCRIPT');
  });
});
