import { Worker } from 'bullmq';
import pino from 'pino';

import { parseRedisConnectionUrl } from '@damdai/infrastructure';

const logger = pino({ name: 'damdai-worker' });

export function createAnalysisWorker(redisUrl: string): Worker {
  return new Worker(
    'analyses',
    async (job) => {
      logger.info({ jobId: job.id }, 'Received analysis job');
    },
    {
      connection: parseRedisConnectionUrl(redisUrl),
    },
  );
}
