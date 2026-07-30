import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

import { HealthResponseSchema } from '@damdai/contracts';

export interface ApiOptions {
  allowedOrigin?: string;
  redisUrl?: string;
  logger?: boolean;
  version?: string;
}

export function buildApi(options: ApiOptions = {}): FastifyInstance {
  const application = Fastify({ logger: options.logger ?? false });
  const redis = options.redisUrl ? new Redis(options.redisUrl, { lazyConnect: true }) : undefined;

  application.register(helmet);
  application.register(cors, {
    origin: options.allowedOrigin ?? false,
  });
  application.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    ...(redis ? { redis } : {}),
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
      service: 'api',
      version: options.version ?? '0.1.0',
    }),
  );

  application.addHook('onClose', async () => {
    if (redis) {
      await redis.quit();
    }
  });

  return application;
}
