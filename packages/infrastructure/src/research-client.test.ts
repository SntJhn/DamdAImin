import { describe, expect, it, vi } from 'vitest';

import { createResearchSystemClient } from './research-client.js';

describe('Research System HTTP contract client', () => {
  it('sends WAV bytes and metadata in one request and returns the validated result', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { audioBase64: string };
      expect(request.audioBase64).toBe('AQID');
      return new Response(
        JSON.stringify({
          analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          result: {
            outcome: 'definitive',
            emotionClassification: 'happiness',
            confidence: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
            transcript: 'Masaya ako',
            explanation: 'Synthetic fixture',
            technicalTrace: [{ cue: 'fixture', value: 'happy' }],
            contractVersion: 'taglish-v1',
            modelVersion: 'fake-model-1',
            preprocessingVersion: 'fake-preprocessing-1',
            ruleSetVersion: 'fake-rules-1',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const client = createResearchSystemClient({ baseUrl: 'http://research.test', fetchImpl });

    await expect(
      client.analyze({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'taglish',
        contractVersion: 'taglish-v1',
        audio: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toMatchObject({ outcome: 'definitive', emotionClassification: 'happiness' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://research.test/v1/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a response that does not satisfy the shared contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const client = createResearchSystemClient({ baseUrl: 'http://research.test', fetchImpl });

    await expect(
      client.analyze({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'taglish',
        contractVersion: 'taglish-v1',
        audio: new Uint8Array([1]),
      }),
    ).rejects.toThrow('response does not satisfy');
  });

  it('rejects a definitive response without an Emotion Classification', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
            result: {
              outcome: 'definitive',
              confidence: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
              transcript: 'Masaya ako',
              explanation: 'Synthetic fixture',
              technicalTrace: [],
              contractVersion: 'taglish-v1',
              modelVersion: 'fake-model-1',
              preprocessingVersion: 'fake-preprocessing-1',
              ruleSetVersion: 'fake-rules-1',
            },
          }),
          { status: 200 },
        ),
    );
    const client = createResearchSystemClient({ baseUrl: 'http://research.test', fetchImpl });

    await expect(
      client.analyze({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'taglish',
        contractVersion: 'taglish-v1',
        audio: new Uint8Array([1]),
      }),
    ).rejects.toThrow('invalid definitive classification');
  });
});
