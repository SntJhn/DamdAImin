import Fastify, { type FastifyInstance } from 'fastify';

import { HealthResponseSchema } from '@damdai/contracts';

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

  return application;
}
