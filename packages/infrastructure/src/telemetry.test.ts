import type { Meter, Tracer } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';

import type { AnalysisTelemetryEvent } from '@damdai/application';

import { createAnalysisTelemetry, toTelemetryAttributes } from './telemetry.js';

describe('Analysis telemetry', () => {
  it('emits only safe correlation attributes', () => {
    const startSpan = vi.fn(() => ({ end: vi.fn() }));
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

    const attributes = toTelemetryAttributes(event);
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
});
