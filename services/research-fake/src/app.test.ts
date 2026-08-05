import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { buildResearchFake, type ResearchFakeOptions } from './app.js';

const generatedContractsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/contracts/generated',
);

async function readGeneratedContract(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(generatedContractsDirectory, name), 'utf8')) as Record<
    string,
    unknown
  >;
}

async function analyzeOverHttp(
  options: ResearchFakeOptions,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const application = buildResearchFake(options);
  const url = await application.listen({ host: '127.0.0.1', port: 0 });

  try {
    const response = await fetch(`${url}/v1/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return { status: response.status, body: await response.json() };
  } finally {
    await application.close();
  }
}

function createSyntheticPcmWav(dataByteLength = 1024 * 1024): Buffer {
  const sampleRateHz = 48_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const wav = Buffer.alloc(44 + dataByteLength);

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRateHz, 24);
  wav.writeUInt32LE(sampleRateHz * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataByteLength, 40);

  return wav;
}

describe('deterministic Research System contract', () => {
  it('returns one definitive classification without application infrastructure access', async () => {
    const application = buildResearchFake();

    try {
      const response = await application.inject({
        method: 'POST',
        url: '/v1/analyze',
        payload: {
          analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          language: 'taglish',
          contractVersion: 'taglish-v2',
          audioBase64: 'UklGRg==',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        result: {
          outcome: 'definitive',
          emotionClassification: 'happiness',
          contractVersion: 'taglish-v2',
          technicalTrace: expect.any(Object),
        },
      });
      expect(body.result.technicalTrace.cueSpans).toEqual(
        expect.arrayContaining([
          {
            source: 'acoustic',
            startMs: 0,
            endMs: 800,
            cue: 'pitch contour',
            value: 'rising positive contour',
          },
        ]),
      );
      expect(body.result.technicalTrace.activatedRules).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'rule-happiness-positive-cue' })]),
      );
      expect(body.result.technicalTrace.scoreAdjustments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ emotionClassification: 'happiness', delta: 0.66 }),
        ]),
      );
      expect(body.result.technicalTrace.probabilities).toEqual({
        before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
        after: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
      });
    } finally {
      await application.close();
    }
  });

  it('can return a completed Inconclusive Result fixture without a fifth class', async () => {
    const application = buildResearchFake({ fixture: 'inconclusive' });

    try {
      const response = await application.inject({
        method: 'POST',
        url: '/v1/analyze',
        payload: {
          analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          language: 'taglish',
          contractVersion: 'taglish-v2',
          audioBase64: 'UklGRg==',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        result: {
          outcome: 'inconclusive',
        },
      });
      expect(response.json().result).not.toHaveProperty('emotionClassification');
    } finally {
      await application.close();
    }
  });

  it('returns the versioned error contract for invalid requests', async () => {
    const application = buildResearchFake();

    try {
      const response = await application.inject({
        method: 'POST',
        url: '/v1/analyze',
        payload: { analysisId: 'not-an-id' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'validation_error',
        message: 'The Research System request did not match its contract.',
      });
    } finally {
      await application.close();
    }
  });

  it('accepts a WAV request larger than Fastify’s default body limit', async () => {
    const response = await analyzeOverHttp(
      {},
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'taglish',
        contractVersion: 'taglish-v2',
        audioBase64: createSyntheticPcmWav().toString('base64'),
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
      result: { outcome: 'definitive' },
    });
  });

  it('keeps generated research schemas conformant with the fake HTTP boundary', async () => {
    const application = buildResearchFake();
    const requestSchema = await readGeneratedContract('research-request.json');
    const responseSchema = await readGeneratedContract('research-response.json');
    const errorSchema = await readGeneratedContract('research-error.json');
    const validRequests = [
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'taglish',
        contractVersion: 'taglish-v2',
        audioBase64: 'UklGRg==',
      },
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'english',
        contractVersion: 'english-v2',
        audioBase64: 'UklGRg==',
      },
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'tagalog',
        contractVersion: 'tagalog-v2',
        audioBase64: 'UklGRg==',
      },
    ];
    const invalidRequests = [
      { ...validRequests[0], analysisId: 'not-an-id' },
      { ...validRequests[0], language: 'unsupported' },
      { ...validRequests[0], contractVersion: '' },
      { ...validRequests[0], audioBase64: '' },
    ];
    const inconclusiveFixture = {
      analysisId: validRequests[0].analysisId,
      result: {
        outcome: 'inconclusive',
        confidence: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
        transcript: '',
        explanation: 'The deterministic fixture is insufficient for a definitive result.',
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
      },
    };
    const validator = new Ajv2020({ strict: false });
    validator.addFormat(
      'uuid',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const requestConforms = validator.compile(requestSchema);
    const responseConforms = validator.compile(responseSchema);
    const errorConforms = validator.compile(errorSchema);

    try {
      for (const request of validRequests) {
        const response = await application.inject({
          method: 'POST',
          url: '/v1/analyze',
          payload: request,
        });

        expect(response.statusCode).toBe(200);
        expect(requestConforms(request)).toBe(true);
        expect(responseConforms(response.json())).toBe(true);
      }

      for (const request of invalidRequests) {
        const response = await application.inject({
          method: 'POST',
          url: '/v1/analyze',
          payload: request,
        });

        expect(response.statusCode).toBe(400);
        expect(errorConforms(response.json())).toBe(true);
      }

      expect(responseConforms(inconclusiveFixture)).toBe(true);

      const inconclusiveResponse = await analyzeOverHttp(
        { fixture: 'inconclusive' },
        validRequests[0],
      );
      expect(inconclusiveResponse.status).toBe(200);
      expect(responseConforms(inconclusiveResponse.body)).toBe(true);
      expect(inconclusiveResponse.body).toMatchObject({
        result: { outcome: 'inconclusive' },
      });

      const wrongVersionResponse = await analyzeOverHttp(
        {
          responseFor: (_request, defaultResponse) => ({
            ...defaultResponse,
            result: { ...defaultResponse.result, contractVersion: 'taglish-v3' },
          }),
        },
        validRequests[0],
      );
      expect(wrongVersionResponse.status).toBe(200);
      expect(responseConforms(wrongVersionResponse.body)).toBe(true);
      expect(wrongVersionResponse.body).toMatchObject({
        result: { contractVersion: 'taglish-v3' },
      });

      const malformedResponse = await analyzeOverHttp(
        {
          validateResponses: false,
          responseFor: () => ({ analysisId: validRequests[0].analysisId }),
        },
        validRequests[0],
      );
      expect(malformedResponse.status).toBe(200);
      expect(responseConforms(malformedResponse.body)).toBe(false);
    } finally {
      await application.close();
    }
  });
});
