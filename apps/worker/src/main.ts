import { loadEnvironment } from '@damdai/config';
import { createAnalysisServices } from '@damdai/application';
import { createAnalysisRepository, createDatabase } from '@damdai/database';
import {
  createGcsSourceAudioStorage,
  createPrivacySafeLogger,
  createResearchSystemClient,
  startObservability,
} from '@damdai/infrastructure';

import { createAnalysisWorker } from './worker.js';

loadEnvironment();

const database = createDatabase();
const observability = startObservability({ serviceName: 'damdai-worker' });
const logger = createPrivacySafeLogger({ name: 'damdai-worker' });
const services = createAnalysisServices({
  repository: createAnalysisRepository(database.db),
  storage: createGcsSourceAudioStorage({
    endpoint: process.env.GCS_ENDPOINT ?? 'http://localhost:4443',
    bucket: process.env.GCS_SOURCE_BUCKET ?? 'damdai-source-audio',
    projectId: process.env.GCS_PROJECT_ID ?? 'damdai-local',
    signingClientEmail: process.env.GCS_SIGNING_CLIENT_EMAIL,
    signingPrivateKey: process.env.GCS_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
  queue: { enqueue: async () => undefined },
  audit: {
    record(event) {
      logger.info(event, `analysis ${event.action}`);
    },
  },
  telemetry: observability.telemetry,
  researchClient: createResearchSystemClient({
    baseUrl: process.env.RESEARCH_FAKE_URL ?? 'http://localhost:4100',
  }),
});

const worker = createAnalysisWorker({
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  processAnalysis: services.processAnalysis,
  telemetry: observability.telemetry,
  logger,
});

worker.on('ready', () => {
  process.stdout.write('DamdAImin analysis worker ready\n');
});
worker.on('error', (error) => {
  process.stderr.write(`DamdAImin analysis worker error: ${error.message}\n`);
});

const shutdown = async () => {
  await worker.close();
  await database.pool.end();
  await observability.shutdown();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
