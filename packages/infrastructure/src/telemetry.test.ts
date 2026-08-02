import { createServer } from 'node:http';

import type { Meter, Tracer } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';

import type { AnalysisTelemetryEvent } from '@damdai/application';

import { createAnalysisTelemetry, startObservability } from './telemetry.js';

describe('Analysis telemetry', () => {
  it('emits only safe correlation attributes', () => {
    const startSpan = vi.fn((name: string, options: { attributes: Record<string, unknown> }) => {
      void name;
      void options;
      return { end: vi.fn() };
    });
    const add = vi.fn();
    const tracer = { startSpan } as unknown as Tracer;
    const meter = { createCounter: vi.fn(() => ({ add })) } as unknown as Meter;
    const event = {
      name: 'analysis.stage',
      analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
      stage: 'completed',
      language: 'taglish',
      contractVersion: 'taglish-v1',
      requestId: 'req-1',
      jobId: 'job-1',
      audioBase64: 'SENTINEL_AUDIO_MUST_NOT_BE_EMITTED',
      transcript: 'SENTINEL_TRANSCRIPT_MUST_NOT_BE_EMITTED',
      explanation: 'SENTINEL_EXPLANATION_MUST_NOT_BE_EMITTED',
    } as AnalysisTelemetryEvent;

    createAnalysisTelemetry({ tracer, meter }).record(event);

    const spanOptions = startSpan.mock.calls[0]?.[1] as { attributes: Record<string, unknown> };
    const attributes = spanOptions.attributes;
    expect(startSpan).toHaveBeenCalledWith('analysis.stage', { attributes });
    expect(add).toHaveBeenCalledWith(1, attributes);
    expect(attributes).toEqual({
      'damdai.analysis.id': event.analysisId,
      'damdai.analysis.stage': 'completed',
      'damdai.analysis.language': 'taglish',
      'damdai.contract.version': 'taglish-v1',
      'http.request.id': 'req-1',
      'messaging.job.id': 'job-1',
    });
    expect(attributes).not.toHaveProperty('audioBase64');
    expect(attributes).not.toHaveProperty('transcript');
    expect(attributes).not.toHaveProperty('explanation');
    expect(JSON.stringify(attributes)).not.toContain('SENTINEL_');
  });

  it.each([
    ['analysis.queued', 'queued', undefined],
    ['analysis.stage', 'processing', undefined],
    ['analysis.worker.received', 'processing', 'job-1'],
  ] as const)('records safe attributes for the %s lifecycle event', (name, stage, jobId) => {
    const startSpan = vi.fn(() => ({ end: vi.fn() }));
    const add = vi.fn();
    const tracer = { startSpan } as unknown as Tracer;
    const meter = { createCounter: vi.fn(() => ({ add })) } as unknown as Meter;

    createAnalysisTelemetry({ tracer, meter }).record({
      name,
      analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
      stage,
      language: 'taglish',
      contractVersion: 'taglish-v1',
      ...(jobId ? { jobId } : {}),
    });

    expect(startSpan).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
    expect(JSON.stringify(startSpan.mock.calls[0])).not.toContain('SENTINEL_');
    expect(JSON.stringify(add.mock.calls[0])).not.toContain('SENTINEL_');
  });

  it('keeps sensitive values out of exported OTLP traces and metrics', async () => {
    const requests: Array<{ path: string; body: Buffer }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
        response.statusCode = 200;
        response.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      await closeServer(server);
      throw new Error('OTLP test collector did not expose a TCP address');
    }

    const observability = startObservability({
      serviceName: 'telemetry-test',
      endpoint: `http://127.0.0.1:${address.port}`,
    });

    try {
      observability.telemetry.record({
        name: 'analysis.stage',
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        stage: 'completed',
        language: 'taglish',
        contractVersion: 'taglish-v1',
        audioBase64: 'SENTINEL_AUDIO',
        transcript: 'SENTINEL_TRANSCRIPT',
        explanation: 'SENTINEL_EXPLANATION',
      } as AnalysisTelemetryEvent);
      await observability.shutdown();
    } finally {
      await closeServer(server);
    }

    expect(requests.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['/v1/traces', '/v1/metrics']),
    );
    const exportedPayload = Buffer.concat(requests.map(({ body }) => body)).toString('utf8');
    expect(exportedPayload).not.toContain('SENTINEL_');
  });
});

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
