import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadEnvironment(): void {
  loadDotenv({ path: resolve(repositoryRoot, '.env'), quiet: true });
}
