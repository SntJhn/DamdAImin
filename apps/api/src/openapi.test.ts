import { describe, expect, it } from 'vitest';

import { buildApi } from './app.js';

interface OpenApiDocument {
  openapi?: string;
  paths?: Record<
    string,
    {
      get?: {
        summary?: string;
        security?: unknown;
        responses?: Record<string, unknown>;
      };
    }
  >;
  components?: {
    securitySchemes?: Record<string, unknown>;
  };
}

describe('OpenAPI document', () => {
  it('describes the versioned routes from their Fastify schemas', async () => {
    const application = buildApi();

    try {
      await application.ready();
      const document = application.swagger() as OpenApiDocument;
      const analysesRoute = document.paths?.['/api/v1/analyses']?.get;
      const healthRoute = document.paths?.['/healthz']?.get;

      expect(document.openapi).toBe('3.0.3');
      expect(analysesRoute?.summary).toBe("List the authenticated account's Analysis History");
      expect(analysesRoute?.security).toEqual([{ bearerAuth: [] }]);
      expect(analysesRoute?.responses).toHaveProperty('200');
      expect(healthRoute?.summary).toBe('Check API readiness');
      expect(document.components?.securitySchemes).toHaveProperty('bearerAuth');
    } finally {
      await application.close();
    }
  });
});
