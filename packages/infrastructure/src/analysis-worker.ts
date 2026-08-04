import { Worker } from 'bullmq';

import type { AnalysisJob, AnalysisTelemetry } from '@damdai/application';

import { createPrivacySafeLogger } from './logging.js';
import { parseRedisConnectionUrl } from './redis.js';

export interface AnalysisWorkerLogger {
  info(bindings: Record<string, unknown>, message: string): void;
}

export interface AnalysisWorkerOptions {
  redisUrl: string;
  processAnalysis(job: AnalysisJob): Promise<void>;
  telemetry?: AnalysisTelemetry;
  logger?: AnalysisWorkerLogger;
}

const defaultLogger = createPrivacySafeLogger({ name: 'damdai-worker' });

export function createAnalysisWorker(options: AnalysisWorkerOptions): Worker<AnalysisJob> {
  const logger = options.logger ?? defaultLogger;

  return new Worker<AnalysisJob>(
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
