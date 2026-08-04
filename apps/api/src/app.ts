import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

import {
  AnalysisInputError,
  AnalysisNotFoundError,
  listAnalysisHistory,
  type Analysis,
  type AnalysisHistoryReader,
  type AnalysisServices,
  type AnalysisTelemetry,
} from '@damdai/application';
import {
  AcceptedAnalysisResponseSchema,
  AnalysisIdParamsSchema,
  AnalysisResourceSchema,
  AnalysisHistoryResponseSchema,
  CreateAnalysisUploadRequestSchema,
  CreateAnalysisUploadResponseSchema,
  FinalizeAnalysisRequestSchema,
  HealthResponseSchema,
  NotFoundResponseSchema,
  ServiceUnavailableResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
  type AnalysisIdParams,
  type AnalysisResource,
  type CreateAnalysisUploadRequest,
  type FinalizeAnalysisRequest,
} from '@damdai/contracts';

import type { AuthVerifier } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    accountId?: string;
  }
}

export interface ApiOptions {
  allowedOrigin?: string;
  authVerifier?: AuthVerifier;
  historyReader?: AnalysisHistoryReader;
  analysisServices?: AnalysisServices;
  redisUrl?: string;
  logger?: boolean;
  loggerInstance?: FastifyBaseLogger;
  telemetry?: AnalysisTelemetry;
  version?: string;
}

export function buildApi(options: ApiOptions = {}): FastifyInstance {
  const application = options.loggerInstance
    ? Fastify({ loggerInstance: options.loggerInstance })
    : Fastify({ logger: options.logger ?? false });
  const redis = options.redisUrl ? new Redis(options.redisUrl, { lazyConnect: true }) : undefined;

  application.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'DamdAImin API',
        description: 'Versioned application API for authenticated DamdAImin journeys.',
        version: options.version ?? '0.1.0',
      },
      servers: [{ url: 'http://localhost:4000' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });
  application.register(helmet);
  application.register(cors, {
    origin: options.allowedOrigin
      ? (origin, callback) => callback(null, origin === options.allowedOrigin)
      : false,
  });
  application.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    ...(redis ? { redis } : {}),
  });

  application.register(
    async (api) => {
      api.addHook('onRequest', async (request, reply) => {
        if (request.method === 'OPTIONS') {
          return;
        }

        const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
        if (!token || !options.authVerifier) {
          return reply.code(401).send({ error: 'unauthorized' as const });
        }

        try {
          request.accountId = (await options.authVerifier.verify(token)).accountId;
        } catch {
          return reply.code(401).send({ error: 'unauthorized' as const });
        }
      });

      api.get(
        '/analyses',
        {
          schema: {
            tags: ['Analysis History'],
            summary: "List the authenticated account's Analysis History",
            security: [{ bearerAuth: [] }],
            response: {
              200: AnalysisHistoryResponseSchema,
              401: UnauthorizedResponseSchema,
              503: ServiceUnavailableResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!options.historyReader || !request.accountId) {
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }

          let analyses;
          try {
            analyses = await listAnalysisHistory(request.accountId, options.historyReader);
          } catch {
            request.log.error('analysis history unavailable');
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }

          return {
            analyses: analyses.map((analysis) => ({
              id: analysis.id,
              status: analysis.status,
              createdAt: analysis.createdAt.toISOString(),
            })),
          };
        },
      );

      api.post(
        '/analysis-uploads',
        {
          schema: {
            tags: ['Analyses'],
            summary: 'Create a private Source Audio upload operation',
            security: [{ bearerAuth: [] }],
            body: CreateAnalysisUploadRequestSchema,
            response: {
              201: CreateAnalysisUploadResponseSchema,
              400: ValidationErrorResponseSchema,
              401: UnauthorizedResponseSchema,
              503: ServiceUnavailableResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!options.analysisServices || !request.accountId) {
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }

          try {
            const body = request.body as CreateAnalysisUploadRequest;
            const created = await options.analysisServices.createUpload({
              accountId: request.accountId,
              language: body.language,
              contractVersion: body.contractVersion,
            });

            return reply.code(201).send({
              uploadId: created.upload.id,
              uploadUrl: created.uploadUrl,
              uploadMethod: created.uploadMethod,
              uploadHeaders: created.uploadHeaders,
              expiresAt: created.upload.expiresAt.toISOString(),
            });
          } catch (error) {
            if (error instanceof AnalysisInputError) {
              return reply
                .code(400)
                .send({ error: 'validation_error' as const, message: error.message });
            }

            request.log.error(error, 'analysis upload operation unavailable');
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }
        },
      );

      api.post(
        '/analyses',
        {
          schema: {
            tags: ['Analyses'],
            summary: 'Finalize Source Audio and queue an Analysis',
            security: [{ bearerAuth: [] }],
            body: FinalizeAnalysisRequestSchema,
            response: {
              202: AcceptedAnalysisResponseSchema,
              400: ValidationErrorResponseSchema,
              404: NotFoundResponseSchema,
              401: UnauthorizedResponseSchema,
              503: ServiceUnavailableResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!options.analysisServices || !request.accountId) {
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }

          try {
            const body = request.body as FinalizeAnalysisRequest;
            const analysis = await options.analysisServices.finalizeUpload(
              request.accountId,
              body.uploadId,
            );
            const location = `/api/v2/analyses/${analysis.id}`;
            request.log.info(
              {
                requestId: request.id,
                analysisId: analysis.id,
                contractVersion: analysis.contractVersion,
                stage: analysis.stage,
              },
              'analysis queued',
            );
            options.telemetry?.record({
              name: 'analysis.queued',
              requestId: request.id,
              analysisId: analysis.id,
              stage: analysis.stage,
              language: analysis.language,
              contractVersion: analysis.contractVersion,
            });
            return reply
              .code(202)
              .header('location', location)
              .send({ analysis: serializeAnalysis(analysis), location });
          } catch (error) {
            if (error instanceof AnalysisInputError) {
              return reply
                .code(400)
                .send({ error: 'validation_error' as const, message: error.message });
            }

            if (error instanceof AnalysisNotFoundError) {
              return reply.code(404).send({ error: 'not_found' as const });
            }

            request.log.error(error, 'analysis submission unavailable');
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }
        },
      );

      api.get(
        '/analyses/:id',
        {
          schema: {
            tags: ['Analyses'],
            summary: 'Read one authenticated Analysis resource',
            security: [{ bearerAuth: [] }],
            params: AnalysisIdParamsSchema,
            response: {
              200: AnalysisResourceSchema,
              400: ValidationErrorResponseSchema,
              404: NotFoundResponseSchema,
              401: UnauthorizedResponseSchema,
              503: ServiceUnavailableResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!options.analysisServices || !request.accountId) {
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }

          try {
            const params = request.params as AnalysisIdParams;
            const analysis = await options.analysisServices.getAnalysis(
              request.accountId,
              params.id,
            );
            return serializeAnalysis(analysis);
          } catch (error) {
            if (error instanceof AnalysisNotFoundError) {
              return reply.code(404).send({ error: 'not_found' as const });
            }

            request.log.error(error, 'analysis resource unavailable');
            return reply.code(503).send({ error: 'service_unavailable' as const });
          }
        },
      );
    },
    { prefix: '/api/v2' },
  );

  application.setErrorHandler((error, request, reply) => {
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.code(400).send({
        error: 'validation_error' as const,
        message: 'The request did not match the required contract.',
      });
    }

    request.log.error(error, 'request failed');
    return reply.send(error);
  });

  application.register(async (health) => {
    health.get(
      '/healthz',
      {
        schema: {
          tags: ['Health'],
          summary: 'Check API readiness',
          response: {
            200: HealthResponseSchema,
          },
        },
      },
      async () => ({
        status: 'ok' as const,
        service: 'api',
        version: options.version ?? '0.1.0',
      }),
    );
  });

  application.addHook('onClose', async () => {
    if (redis) {
      await redis.quit();
    }
  });

  return application;
}

function serializeAnalysis(analysis: Analysis): AnalysisResource {
  return {
    id: analysis.id,
    status: analysis.status,
    stage: analysis.stage,
    language: analysis.language,
    createdAt: analysis.createdAt.toISOString(),
    ...(analysis.failureMessage ? { failureMessage: analysis.failureMessage } : {}),
    ...(analysis.result ? { result: analysis.result } : {}),
  };
}
