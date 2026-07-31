import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApi } from './app.js';
import { AuthVerificationError } from './auth.js';

describe('API health boundary', () => {
  const applications = [] as ReturnType<typeof buildApi>[];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
  });

  it('reports that the API is ready', async () => {
    const application = buildApi();
    applications.push(application);

    const response = await application.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
    });
  });

  it("returns only the authenticated account's Analysis History", async () => {
    const historyReader = {
      listForAccount: vi.fn(async (accountId: string) =>
        accountId === 'account-a'
          ? [
              {
                id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
                status: 'queued' as const,
                createdAt: new Date('2026-07-31T00:00:00.000Z'),
              },
            ]
          : [],
      ),
    };
    const authVerifier = {
      verify: vi.fn(async (token: string) => {
        if (token === 'account-a-token') {
          return { accountId: 'account-a' };
        }

        throw new AuthVerificationError('invalid token');
      }),
    };
    const application = buildApi({
      allowedOrigin: 'http://localhost:3000',
      authVerifier,
      historyReader,
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer account-a-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      analyses: [
        {
          id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          status: 'queued',
          createdAt: '2026-07-31T00:00:00.000Z',
        },
      ],
    });
    expect(historyReader.listForAccount).toHaveBeenCalledWith('account-a');
  });

  it('returns an empty history for a verified account with no analyses', async () => {
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-empty' }) },
      historyReader: { listForAccount: async () => [] },
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ analyses: [] });
  });

  it('returns service unavailable when the History store cannot be reached', async () => {
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      historyReader: {
        listForAccount: async () => {
          throw new Error('database unavailable');
        },
      },
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
  });

  it('rejects missing and invalid credentials before reaching application services', async () => {
    const listForAccount = vi.fn(async () => []);
    const application = buildApi({
      authVerifier: {
        verify: async () => {
          throw new AuthVerificationError('invalid token');
        },
      },
      historyReader: { listForAccount },
    });
    applications.push(application);

    const missing = await application.inject({ method: 'GET', url: '/api/v1/analyses' });
    const invalid = await application.inject({
      method: 'GET',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(listForAccount).not.toHaveBeenCalled();
  });

  it('allows the configured origin and refuses a different origin', async () => {
    const application = buildApi({ allowedOrigin: 'http://localhost:3000' });
    applications.push(application);

    const allowed = await application.inject({
      method: 'OPTIONS',
      url: '/api/v1/analyses',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    const refused = await application.inject({
      method: 'OPTIONS',
      url: '/api/v1/analyses',
      headers: {
        origin: 'http://evil.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });
});
