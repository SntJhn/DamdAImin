import { Worker } from 'bullmq';
import pino from 'pino';

import type { AnalysisJob, AnalysisTelemetry } from '@damdai/application';
import { parseRedisConnectionUrl } from '@damdai/infrastructure';

const logger = pino({ name: 'damdai-worker' });

export interface AnalysisWorkerOptions {
  redisUrl: string;
  processAnalysis(job: AnalysisJob): Promise<void>;
  telemetry?: AnalysisTelemetry;
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
      options.telemetry?.record({
        name: 'analysis.worker.received',
        jobId: job.id,
        analysisId: job.data.analysisId,
        stage: 'processing',
        language: job.data.language,
        contractVersion: job.data.contractVersion,
      });
      await options.processAnalysis(job.data);
    },
    {
      connection: parseRedisConnectionUrl(options.redisUrl),
    },
  );
}
