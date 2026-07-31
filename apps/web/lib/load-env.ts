import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

const repositoryRoot = resolve(process.cwd(), '../..');

export function loadEnvironment(): void {
  loadDotenv({ path: resolve(repositoryRoot, '.env.local'), quiet: true });
  loadDotenv({ path: resolve(repositoryRoot, '.env'), quiet: true });
}
