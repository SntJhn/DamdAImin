import { createAnalysisHistoryReader, createDatabase } from '@damdai/database';

import { buildApi } from './app.js';
import { createNeonAuthTokenVerifier } from './auth.js';
import { loadEnvironment } from './load-env.js';

loadEnvironment();

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? '0.0.0.0';
const authBaseUrl = process.env.NEON_AUTH_BASE_URL;

if (!authBaseUrl) {
  throw new Error('NEON_AUTH_BASE_URL is required');
}

const authOrigin = new URL(authBaseUrl).origin;

const database = createDatabase();

const application = buildApi({
  allowedOrigin: process.env.CORS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
  authVerifier: createNeonAuthTokenVerifier({
    audience: process.env.NEON_AUTH_AUDIENCE ?? authOrigin,
    issuer: process.env.NEON_AUTH_ISSUER ?? authOrigin,
    jwksUrl: process.env.NEON_AUTH_JWKS_URL ?? `${authBaseUrl}/.well-known/jwks.json`,
  }),
  historyReader: createAnalysisHistoryReader(database.db),
  logger: true,
  redisUrl: process.env.REDIS_URL,
});

application.addHook('onClose', async () => {
  await database.pool.end();
});

try {
  await application.listen({ host, port });
} catch (error) {
  application.log.error(error, 'API failed to start');
  process.exitCode = 1;
}
