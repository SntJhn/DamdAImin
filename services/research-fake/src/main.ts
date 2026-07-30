import { buildResearchFake } from './app.js';

const application = buildResearchFake();
const port = Number(process.env.RESEARCH_FAKE_PORT ?? 4100);
const host = process.env.RESEARCH_FAKE_HOST ?? '0.0.0.0';

try {
  await application.listen({ host, port });
} catch (error) {
  application.log.error(error, 'Research fake failed to start');
  process.exitCode = 1;
}
