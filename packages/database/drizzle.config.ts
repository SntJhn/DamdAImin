import { defineConfig } from 'drizzle-kit';
import { loadEnvironment } from '@damdai/config';

loadEnvironment();

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost/neondb',
  },
  out: './drizzle',
  schema: './src/schema.ts',
});
