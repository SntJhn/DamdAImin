import Fastify, { type FastifyInstance } from 'fastify';

import {
  HealthResponseSchema,
  ResearchAnalysisRequestSchema,
  ResearchAnalysisResponseSchema,
  ResearchErrorResponseSchema,
  type ResearchAnalysisRequest,
  type ResearchAnalysisResponse,
} from '@damdai/contracts';

export type ResearchFakeFixture = 'definitive' | 'inconclusive';

export interface ResearchFakeOptions {
  fixture?: ResearchFakeFixture;
  responseFor?: (
    request: ResearchAnalysisRequest,
    defaultResponse: ResearchAnalysisResponse,
  ) => unknown;
  validateResponses?: boolean;
}

const researchRequestBodyLimitBytes = 8 * 1024 * 1024;

export function buildResearchFake(options: ResearchFakeOptions = {}): FastifyInstance {
  const application = Fastify({
    logger: false,
    bodyLimit: researchRequestBodyLimitBytes,
  });

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
      const defaultResponse = createFixtureResponse(body, options.fixture ?? 'definitive');

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

function createFixtureResponse(
  request: ResearchAnalysisRequest,
  fixture: ResearchFakeFixture,
): ResearchAnalysisResponse {
  if (fixture === 'inconclusive') {
    return {
      analysisId: request.analysisId,
      result: {
        outcome: 'inconclusive',
        confidence: {
          happiness: 0.25,
          sadness: 0.25,
          anger: 0.25,
          neutrality: 0.25,
        },
        transcript: '',
        explanation:
          'The deterministic fixture returned insufficient acoustic and linguistic evidence for a definitive classification.',
        technicalTrace: {
          cueSpans: [],
          activatedRules: [],
          scoreAdjustments: [],
          probabilities: {
            before: {
              happiness: 0.25,
              sadness: 0.25,
              anger: 0.25,
              neutrality: 0.25,
            },
            after: {
              happiness: 0.25,
              sadness: 0.25,
              anger: 0.25,
              neutrality: 0.25,
            },
          },
        },
        contractVersion: request.contractVersion,
        schemaVersion: 'research-response-v2',
        modelVersion: 'fake-model-1',
        preprocessingVersion: 'fake-preprocessing-1',
        ruleSetVersion: 'fake-rules-1',
      },
    };
  }

  return {
    analysisId: request.analysisId,
    result: {
      outcome: 'definitive',
      emotionClassification: 'happiness',
      confidence: {
        happiness: 0.91,
        sadness: 0.03,
        anger: 0.02,
        neutrality: 0.04,
      },
      transcript: 'Masaya ako sa araw na ito.',
      explanation:
        'The returned rising pitch contour and positive lexical cue support the happiness classification.',
      technicalTrace: {
        cueSpans: [
          {
            source: 'acoustic',
            startMs: 0,
            endMs: 800,
            cue: 'pitch contour',
            value: 'rising positive contour',
          },
          {
            source: 'linguistic',
            startMs: 850,
            endMs: 1_450,
            cue: 'positive lexical cue',
            value: 'Masaya',
          },
        ],
        activatedRules: [
          {
            id: 'rule-happiness-positive-cue',
            description: 'Positive acoustic and linguistic cues increase the happiness score.',
          },
        ],
        scoreAdjustments: [
          {
            emotionClassification: 'happiness',
            delta: 0.66,
            reason: 'Returned positive acoustic and linguistic cues.',
          },
          {
            emotionClassification: 'sadness',
            delta: -0.22,
            reason: 'Returned cues do not support sadness.',
          },
          {
            emotionClassification: 'anger',
            delta: -0.23,
            reason: 'Returned cues do not support anger.',
          },
          {
            emotionClassification: 'neutrality',
            delta: -0.21,
            reason: 'Returned cues do not support neutrality.',
          },
        ],
        probabilities: {
          before: {
            happiness: 0.25,
            sadness: 0.25,
            anger: 0.25,
            neutrality: 0.25,
          },
          after: {
            happiness: 0.91,
            sadness: 0.03,
            anger: 0.02,
            neutrality: 0.04,
          },
        },
      },
      contractVersion: request.contractVersion,
      schemaVersion: 'research-response-v2',
      modelVersion: 'fake-model-1',
      preprocessingVersion: 'fake-preprocessing-1',
      ruleSetVersion: 'fake-rules-1',
    },
  };
}
