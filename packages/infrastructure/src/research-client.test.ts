import { describe, expect, it, vi } from 'vitest';

import { buildResearchFake, type ResearchFakeOptions } from '@damdai/research-fake';

import { createResearchSystemClient } from './research-client.js';

const analysisInput = {
  analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
  language: 'taglish' as const,
  contractVersion: 'taglish-v2',
  audio: new Uint8Array([1]),
};

const definitiveTechnicalTrace = {
  cueSpans: [
    {
      source: 'linguistic' as const,
      startMs: 0,
      endMs: 400,
      cue: 'positive lexical cue',
      value: 'Masaya',
    },
  ],
  activatedRules: [{ id: 'fixture-rule', description: 'Synthetic fixture rule.' }],
  scoreAdjustments: [
    { emotionClassification: 'happiness' as const, delta: 0.66, reason: 'Synthetic fixture.' },
  ],
  probabilities: {
    before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
    after: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
  },
};

const inconclusiveTechnicalTrace = {
  cueSpans: [],
  activatedRules: [],
  scoreAdjustments: [],
  probabilities: {
    before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
    after: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
  },
};

async function withResearchFake(
  options: ResearchFakeOptions,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const application = buildResearchFake(options);
  const baseUrl = await application.listen({ host: '127.0.0.1', port: 0 });

  try {
    await run(baseUrl);
  } finally {
    await application.close();
  }
}

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
            technicalTrace: definitiveTechnicalTrace,
            contractVersion: 'taglish-v2',
            schemaVersion: 'research-response-v2',
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
        contractVersion: 'taglish-v2',
        audio: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toMatchObject({ outcome: 'definitive', emotionClassification: 'happiness' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://research.test/v1/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('accepts an Inconclusive Result without exposing a definitive class', async () => {
    await withResearchFake({ fixture: 'inconclusive' }, async (baseUrl) => {
      const client = createResearchSystemClient({ baseUrl });

      await expect(client.analyze(analysisInput)).resolves.toMatchObject({
        outcome: 'inconclusive',
        confidence: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
      });
    });
  });

  it('rejects a response that does not satisfy the shared contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const client = createResearchSystemClient({ baseUrl: 'http://research.test', fetchImpl });

    await expect(
      client.analyze({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'taglish',
        contractVersion: 'taglish-v2',
        audio: new Uint8Array([1]),
      }),
    ).rejects.toThrow('response does not satisfy');
  });

  it('rejects a valid response for a different Analysis', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            analysisId: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
            result: {
              outcome: 'definitive',
              emotionClassification: 'happiness',
              confidence: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
              transcript: 'Masaya ako',
              explanation: 'Synthetic fixture',
              technicalTrace: definitiveTechnicalTrace,
              contractVersion: 'taglish-v2',
              schemaVersion: 'research-response-v2',
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
        contractVersion: 'taglish-v2',
        audio: new Uint8Array([1]),
      }),
    ).rejects.toThrow('mismatched Analysis identifier');
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
              technicalTrace: inconclusiveTechnicalTrace,
              contractVersion: 'taglish-v2',
              schemaVersion: 'research-response-v2',
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
        contractVersion: 'taglish-v2',
        audio: new Uint8Array([1]),
      }),
    ).rejects.toThrow('response does not satisfy');
  });

  it('rejects an Inconclusive Result that includes a definitive class', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            analysisId: analysisInput.analysisId,
            result: {
              outcome: 'inconclusive',
              emotionClassification: 'happiness',
              confidence: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
              transcript: '',
              explanation: 'Synthetic fixture',
              technicalTrace: {
                cueSpans: [],
                activatedRules: [],
                scoreAdjustments: [],
                probabilities: {
                  before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
                  after: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
                },
              },
              contractVersion: analysisInput.contractVersion,
              schemaVersion: 'research-response-v2',
              modelVersion: 'fake-model-1',
              preprocessingVersion: 'fake-preprocessing-1',
              ruleSetVersion: 'fake-rules-1',
            },
          }),
          { status: 200 },
        ),
    );
    const client = createResearchSystemClient({ baseUrl: 'http://research.test', fetchImpl });

    await expect(client.analyze(analysisInput)).rejects.toThrow('response does not satisfy');
  });

  it.each([
    [
      'a wrong contract version',
      {
        analysisId: analysisInput.analysisId,
        result: {
          outcome: 'definitive',
          emotionClassification: 'happiness',
          confidence: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
          transcript: 'Masaya ako',
          explanation: 'Synthetic fixture',
          technicalTrace: definitiveTechnicalTrace,
          contractVersion: 'taglish-v3',
          schemaVersion: 'research-response-v2',
          modelVersion: 'fake-model-1',
          preprocessingVersion: 'fake-preprocessing-1',
          ruleSetVersion: 'fake-rules-1',
        },
      },
      'mismatched contract version',
    ],
    ['a malformed response', { analysisId: analysisInput.analysisId }, 'response does not satisfy'],
  ] as const)(
    'rejects %s received over the fake HTTP boundary',
    async (_name, body, expectedMessage) => {
      const options: ResearchFakeOptions =
        'result' in body
          ? {
              responseFor: (_request, defaultResponse) => ({
                ...defaultResponse,
                result: { ...defaultResponse.result, contractVersion: body.result.contractVersion },
              }),
            }
          : {
              validateResponses: false,
              responseFor: () => body,
            };

      await withResearchFake(options, async (baseUrl) => {
        const client = createResearchSystemClient({ baseUrl });

        await expect(client.analyze(analysisInput)).rejects.toThrow(expectedMessage);
      });
    },
  );
});
