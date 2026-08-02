import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ResearchAnalysisRequestSchema, ResearchAnalysisResponseSchema } from './research.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(packageRoot, 'generated');

await mkdir(outputDirectory, { recursive: true });
await writeArtifact(
  'research-request.json',
  'https://damdai.local/contracts/research-request-v1.json',
  ResearchAnalysisRequestSchema,
);
await writeArtifact(
  'research-response.json',
  'https://damdai.local/contracts/research-response-v1.json',
  ResearchAnalysisResponseSchema,
);

async function writeArtifact(
  filename: string,
  id: string,
  schema: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    resolve(outputDirectory, filename),
    `${JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: id, ...schema }, null, 2)}\n`,
  );
}
