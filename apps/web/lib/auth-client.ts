'use client';

import { createAuthClient } from '@neondatabase/auth/next';
import type { ReactBetterAuthClient } from '@neondatabase/auth/types';

export const authClient: ReactBetterAuthClient = createAuthClient();

interface JwtResponse {
  token?: unknown;
}

export async function getAuthToken(): Promise<string | null> {
  const response = await fetch('/api/auth/token?disableCookieCache=true', {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as JwtResponse;
  return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
}
