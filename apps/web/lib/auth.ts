import { createNeonAuth } from '@neondatabase/auth/next/server';
import { loadEnvironment } from '@damdai/config';

loadEnvironment();

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function getAuth() {
  return createNeonAuth({
    baseUrl: requiredEnvironment('NEON_AUTH_BASE_URL'),
    cookies: {
      secret: requiredEnvironment('NEON_AUTH_COOKIE_SECRET'),
    },
    logLevel: 'silent',
  });
}
