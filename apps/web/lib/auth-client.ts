'use client';

import { createAuthClient } from '@neondatabase/auth/next';
import type { ReactBetterAuthClient } from '@neondatabase/auth/types';

export const authClient: ReactBetterAuthClient = createAuthClient();
