import { Worker } from 'bullmq';
import pino from 'pino';

import type { AnalysisJob } from '@damdai/application';
import { parseRedisConnectionUrl } from '@damdai/infrastructure';

const logger = pino({ name: 'damdai-worker' });

export interface AnalysisWorkerOptions {
  redisUrl: string;
  processAnalysis(job: AnalysisJob): Promise<void>;
}

export function createAnalysisWorker(options: AnalysisWorkerOptions): Worker<AnalysisJob> {
  return new Worker(
    'analyses',
    async (job) => {
      logger.info(
        {
          jobId: job.id,
          analysisId: job.data.analysisId,
          contractVersion: job.data.contractVersion,
          language: job.data.language,
          stage: 'processing',
        },
        'Received analysis job',
      );
      await options.processAnalysis(job.data);
    },
    {
      connection: parseRedisConnectionUrl(options.redisUrl),
    },
  );
}
