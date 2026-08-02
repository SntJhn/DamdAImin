import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { buildResearchFake } from './app.js';

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
          contractVersion: 'taglish-v1',
          audioBase64: 'UklGRg==',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        result: {
          outcome: 'definitive',
          emotionClassification: 'happiness',
          contractVersion: 'taglish-v1',
        },
      });
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

  it('keeps generated research schemas conformant with the fake HTTP boundary', async () => {
    const application = buildResearchFake();
    const requestSchema = await readGeneratedContract('research-request.json');
    const responseSchema = await readGeneratedContract('research-response.json');
    const errorSchema = await readGeneratedContract('research-error.json');
    const validRequests = [
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'taglish',
        contractVersion: 'taglish-v1',
        audioBase64: 'UklGRg==',
      },
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'english',
        contractVersion: 'english-v1',
        audioBase64: 'UklGRg==',
      },
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        language: 'tagalog',
        contractVersion: 'tagalog-v1',
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
        technicalTrace: [],
        contractVersion: 'taglish-v1',
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
    } finally {
      await application.close();
    }
  });
});
