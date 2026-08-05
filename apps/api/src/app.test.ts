import { Writable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPrivacySafeLogger } from '@damdai/infrastructure';

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
      list: vi.fn(async () => ({
        analyses: [
          {
            id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
            accountId: 'account-a',
            status: 'queued' as const,
            language: 'taglish' as const,
            createdAt: new Date('2026-07-31T00:00:00.000Z'),
            result: null,
          },
          {
            id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
            accountId: 'account-b',
            status: 'completed' as const,
            language: 'english' as const,
            createdAt: new Date('2026-07-31T00:01:00.000Z'),
            result: {
              outcome: 'definitive' as const,
              emotionClassification: 'anger' as const,
              transcript: 'another account transcript',
            },
          },
        ],
        hasMore: false,
      })),
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
      url: '/api/v2/analyses',
      headers: { authorization: 'Bearer account-a-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      analyses: [
        {
          id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          status: 'queued',
          language: 'taglish',
          createdAt: '2026-07-31T00:00:00.000Z',
        },
      ],
      hasMore: false,
    });
    expect(historyReader.list).toHaveBeenCalledWith('account-a', {
      search: undefined,
      status: undefined,
      result: undefined,
      language: undefined,
      from: undefined,
      to: undefined,
      limit: 50,
    });
  });

  it('applies Transcript, lifecycle, result, language, date, and limit filters at the API seam', async () => {
    const historyReader = {
      list: vi.fn(async () => ({
        analyses: [
          {
            id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
            accountId: 'account-a',
            status: 'completed' as const,
            language: 'taglish' as const,
            createdAt: new Date('2026-07-31T00:00:00.000Z'),
            result: {
              outcome: 'definitive' as const,
              emotionClassification: 'happiness' as const,
              transcript: 'Masaya ako sa araw na ito.',
            },
          },
          {
            id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
            accountId: 'account-a',
            status: 'completed' as const,
            language: 'tagalog' as const,
            createdAt: new Date('2026-07-31T00:01:00.000Z'),
            result: {
              outcome: 'inconclusive' as const,
              transcript: 'Hindi malinaw ang sample.',
            },
          },
        ],
        hasMore: true,
      })),
    };
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      historyReader,
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: '/api/v2/analyses?search=Masaya&status=completed&result=happiness&language=taglish&from=2026-07-30&to=2026-08-01&limit=2',
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      analyses: [
        {
          id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          status: 'completed',
          language: 'taglish',
          createdAt: '2026-07-31T00:00:00.000Z',
          result: {
            outcome: 'definitive',
            emotionClassification: 'happiness',
            transcript: 'Masaya ako sa araw na ito.',
          },
        },
      ],
      hasMore: true,
    });
    expect(historyReader.list).toHaveBeenCalledWith('account-a', {
      search: 'Masaya',
      status: 'completed',
      result: 'happiness',
      language: 'taglish',
      from: new Date('2026-07-30T00:00:00.000Z'),
      to: new Date('2026-08-01T23:59:59.999Z'),
      limit: 2,
    });
  });

  it('rejects invalid History filters without reaching the reader or echoing search content', async () => {
    const list = vi.fn(async () => ({ analyses: [], hasMore: false }));
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      historyReader: { list },
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: `/api/v2/analyses?limit=101&search=${encodeURIComponent('SENTINEL_TRANSCRIPT')}`,
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_error',
      message: 'The request did not match the required contract.',
    });
    expect(response.body).not.toContain('SENTINEL_TRANSCRIPT');
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps History search terms and returned Transcript content out of API logs', async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      historyReader: {
        list: async () => ({
          analyses: [
            {
              id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
              accountId: 'account-a',
              status: 'completed' as const,
              language: 'taglish' as const,
              createdAt: new Date('2026-07-31T00:00:00.000Z'),
              result: {
                outcome: 'definitive' as const,
                emotionClassification: 'happiness' as const,
                transcript: 'SENTINEL_HISTORY_TRANSCRIPT',
              },
            },
          ],
          hasMore: false,
        }),
      },
      loggerInstance: createPrivacySafeLogger({ name: 'history-api-test' }, destination),
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: `/api/v2/analyses?search=${encodeURIComponent('SENTINEL_HISTORY_SEARCH')}`,
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(200);
    const output = chunks.join('');
    expect(output).toContain('"url":"/api/v2/analyses"');
    expect(output).not.toContain('SENTINEL_HISTORY_SEARCH');
    expect(output).not.toContain('SENTINEL_HISTORY_TRANSCRIPT');
  });

  it('returns an empty history for a verified account with no analyses', async () => {
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-empty' }) },
      historyReader: { list: async () => ({ analyses: [], hasMore: false }) },
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: '/api/v2/analyses',
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ analyses: [], hasMore: false });
  });

  it('returns service unavailable when the History store cannot be reached', async () => {
    const application = buildApi({
      authVerifier: { verify: async () => ({ accountId: 'account-a' }) },
      historyReader: {
        list: async () => {
          throw new Error('database unavailable');
        },
      },
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: '/api/v2/analyses',
      headers: { authorization: 'Bearer verified-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service_unavailable' });
  });

  it('rejects missing and invalid credentials before reaching application services', async () => {
    const list = vi.fn(async () => ({ analyses: [], hasMore: false }));
    const application = buildApi({
      authVerifier: {
        verify: async () => {
          throw new AuthVerificationError('invalid token');
        },
      },
      historyReader: { list },
    });
    applications.push(application);

    const missing = await application.inject({ method: 'GET', url: '/api/v2/analyses' });
    const invalid = await application.inject({
      method: 'GET',
      url: '/api/v2/analyses',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('allows the configured origin and refuses a different origin', async () => {
    const application = buildApi({ allowedOrigin: 'http://localhost:3000' });
    applications.push(application);

    const allowed = await application.inject({
      method: 'OPTIONS',
      url: '/api/v2/analyses',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    const refused = await application.inject({
      method: 'OPTIONS',
      url: '/api/v2/analyses',
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
