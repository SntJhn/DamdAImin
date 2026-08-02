import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

import { listAnalysisHistory, type AnalysisHistoryReader } from '@damdai/application';
import {
  AnalysisHistoryResponseSchema,
  HealthResponseSchema,
  ServiceUnavailableResponseSchema,
  UnauthorizedResponseSchema,
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
  redisUrl?: string;
  logger?: boolean;
  version?: string;
}

export function buildApi(options: ApiOptions = {}): FastifyInstance {
  const application = Fastify({ logger: options.logger ?? false });
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
    },
    { prefix: '/api/v1' },
  );

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
