import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApi } from './app.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const outputPath = resolve(repositoryRoot, 'packages/contracts/generated/openapi.json');
const application = buildApi();

try {
  await application.ready();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(application.swagger(), null, 2)}\n`);
} finally {
  await application.close();
}
