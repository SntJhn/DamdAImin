import { createAnalysisWorker } from './worker.js';
import { loadEnvironment } from './load-env.js';

loadEnvironment();

const worker = createAnalysisWorker(process.env.REDIS_URL ?? 'redis://localhost:6379');

worker.on('ready', () => {
  process.stdout.write('DamdAImin analysis worker ready\n');
});
worker.on('error', (error) => {
  process.stderr.write(`DamdAImin analysis worker error: ${error.message}\n`);
});

const shutdown = async () => {
  await worker.close();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
