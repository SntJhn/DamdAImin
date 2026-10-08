'use client';

import { createAuthClient } from '@neondatabase/auth/next';
import type { ReactBetterAuthClient } from '@neondatabase/auth/types';

export const authClient: ReactBetterAuthClient = createAuthClient();

export const AUTH_UNAVAILABLE_MESSAGE =
  'We couldn’t connect to the sign-in service. Please try again.';

interface JwtResponse {
  token?: unknown;
}

export async function getAuthToken(): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch('/api/auth/token?disableCookieCache=true', {
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new Error(AUTH_UNAVAILABLE_MESSAGE);
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(AUTH_UNAVAILABLE_MESSAGE);
  }

  const body = (await response.json()) as JwtResponse;
  return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
}
