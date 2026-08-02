import Fastify, { type FastifyInstance } from 'fastify';

import {
  HealthResponseSchema,
  ResearchAnalysisRequestSchema,
  ResearchAnalysisResponseSchema,
  ResearchErrorResponseSchema,
  type ResearchAnalysisRequest,
  type ResearchAnalysisResponse,
} from '@damdai/contracts';

export interface ResearchFakeOptions {
  responseFor?: (
    request: ResearchAnalysisRequest,
    defaultResponse: ResearchAnalysisResponse,
  ) => unknown;
  validateResponses?: boolean;
}

export function buildResearchFake(options: ResearchFakeOptions = {}): FastifyInstance {
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
        ...(options.validateResponses === false
          ? {}
          : {
              response: {
                200: ResearchAnalysisResponseSchema,
                400: ResearchErrorResponseSchema,
              },
            }),
      },
    },
    async (request) => {
      const body = request.body as ResearchAnalysisRequest;
      const defaultResponse: ResearchAnalysisResponse = {
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

      return options.responseFor?.(body, defaultResponse) ?? defaultResponse;
    },
  );

  application.setErrorHandler((error, _request, reply) => {
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'The Research System request did not match its contract.',
      });
    }

    return reply.send(error);
  });

  return application;
}
