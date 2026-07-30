import { buildApi } from './app.js';
import { loadEnvironment } from './load-env.js';

loadEnvironment();

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? '0.0.0.0';

const application = buildApi({
  allowedOrigin: process.env.CORS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
  logger: true,
  redisUrl: process.env.REDIS_URL,
});

try {
  await application.listen({ host, port });
} catch (error) {
  application.log.error(error, 'API failed to start');
  process.exitCode = 1;
}
