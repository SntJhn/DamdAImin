import { afterEach, describe, expect, it } from 'vitest';

import { buildApi } from './app.js';

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
});
