import Fastify, { type FastifyInstance } from 'fastify';

import {
  HealthResponseSchema,
  ResearchAnalysisRequestSchema,
  ResearchAnalysisResponseSchema,
  ResearchErrorResponseSchema,
} from '@damdai/contracts';

export function buildResearchFake(): FastifyInstance {
  const application = Fastify({ logger: false });

  application.get(
    '/healthz',
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'research-fake',
      version: '0.1.0',
    }),
  );

  application.post(
    '/v1/analyze',
    {
      schema: {
        tags: ['Research System'],
        summary: 'Run the deterministic local Research System contract',
        body: ResearchAnalysisRequestSchema,
        response: {
          200: ResearchAnalysisResponseSchema,
          400: ResearchErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = request.body as {
        analysisId: string;
        language: 'taglish' | 'english' | 'tagalog';
        contractVersion: string;
      };

      return {
        analysisId: body.analysisId,
        result: {
          outcome: 'definitive' as const,
          emotionClassification: 'happiness' as const,
          confidence: {
            happiness: 0.91,
            sadness: 0.03,
            anger: 0.02,
            neutrality: 0.04,
          },
          transcript: 'Masaya ako sa araw na ito.',
          explanation: 'The deterministic fixture contains a positive acoustic and linguistic cue.',
          technicalTrace: [{ cue: 'synthetic-positive-cue', value: 'happiness' }],
          contractVersion: body.contractVersion,
          modelVersion: 'fake-model-1',
          preprocessingVersion: 'fake-preprocessing-1',
          ruleSetVersion: 'fake-rules-1',
        },
      };
    },
  );

  return application;
}
