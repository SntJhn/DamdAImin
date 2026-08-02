import { Queue } from 'bullmq';

import type { AnalysisJob, AnalysisQueue } from '@damdai/application';

import { parseRedisConnectionUrl } from './redis.js';

export interface AnalysisQueueClient extends AnalysisQueue {
  close(): Promise<void>;
}

export function createAnalysisQueue(redisUrl: string): AnalysisQueueClient {
  const queue = new Queue<AnalysisJob>('analyses', {
    connection: parseRedisConnectionUrl(redisUrl),
  });

  return {
    async enqueue(job) {
      await queue.add('process-analysis', job, {
        jobId: job.analysisId,
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    },
    async close() {
      await queue.close();
    },
  };
}
