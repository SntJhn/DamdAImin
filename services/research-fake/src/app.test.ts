import { describe, expect, it } from 'vitest';

import { buildResearchFake } from './app.js';

describe('deterministic Research System contract', () => {
  it('returns one definitive classification without application infrastructure access', async () => {
    const application = buildResearchFake();

    try {
      const response = await application.inject({
        method: 'POST',
        url: '/v1/analyze',
        payload: {
          analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          language: 'taglish',
          contractVersion: 'taglish-v1',
          audioBase64: 'UklGRg==',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        result: {
          outcome: 'definitive',
          emotionClassification: 'happiness',
          contractVersion: 'taglish-v1',
        },
      });
    } finally {
      await application.close();
    }
  });
});
