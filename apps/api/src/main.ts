import {
  createAnalysisHistoryReader,
  createAnalysisRepository,
  createDatabase,
} from '@damdai/database';
import { loadEnvironment } from '@damdai/config';
import {
  createAnalysisQueue,
  createGcsSourceAudioStorage,
  createPrivacySafeLogger,
  createResearchSystemClient,
  startObservability,
} from '@damdai/infrastructure';
import { createAnalysisServices } from '@damdai/application';

import { buildApi } from './app.js';
import { createNeonAuthTokenVerifier } from './auth.js';

loadEnvironment();

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? '0.0.0.0';
const authBaseUrl = process.env.NEON_AUTH_BASE_URL;

if (!authBaseUrl) {
  throw new Error('NEON_AUTH_BASE_URL is required');
}

const authOrigin = new URL(authBaseUrl).origin;

const database = createDatabase();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const analysisQueue = createAnalysisQueue(redisUrl);
const observability = startObservability({ serviceName: 'damdai-api' });
const logger = createPrivacySafeLogger({ name: 'damdai-api' });
const analysisServices = createAnalysisServices({
  repository: createAnalysisRepository(database.db),
  storage: createGcsSourceAudioStorage({
    endpoint: process.env.GCS_ENDPOINT ?? 'http://localhost:4443',
    publicEndpoint: process.env.GCS_PUBLIC_ENDPOINT,
    bucket: process.env.GCS_SOURCE_BUCKET ?? 'damdai-source-audio',
    projectId: process.env.GCS_PROJECT_ID ?? 'damdai-local',
    signingClientEmail: process.env.GCS_SIGNING_CLIENT_EMAIL,
    signingPrivateKey: process.env.GCS_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
  queue: analysisQueue,
  researchClient: createResearchSystemClient({
    baseUrl: process.env.RESEARCH_FAKE_URL ?? 'http://localhost:4100',
  }),
});

const application = buildApi({
  allowedOrigin: process.env.CORS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
  authVerifier: createNeonAuthTokenVerifier({
    audience: process.env.NEON_AUTH_AUDIENCE ?? authOrigin,
    issuer: process.env.NEON_AUTH_ISSUER ?? authOrigin,
    jwksUrl: process.env.NEON_AUTH_JWKS_URL ?? `${authBaseUrl}/.well-known/jwks.json`,
  }),
  historyReader: createAnalysisHistoryReader(database.db),
  analysisServices,
  loggerInstance: logger,
  redisUrl,
  telemetry: observability.telemetry,
});

application.addHook('onClose', async () => {
  await analysisQueue.close();
  await database.pool.end();
  await observability.shutdown();
});

try {
  await application.listen({ host, port });
} catch (error) {
  application.log.error(error, 'API failed to start');
  process.exitCode = 1;
}
