import { FormatRegistry } from '@sinclair/typebox/type';
import { Value } from '@sinclair/typebox/value';

import type { ResearchSystemClient } from '@damdai/application';
import {
  ResearchAnalysisRequestSchema,
  ResearchAnalysisResponseSchema,
  ResearchErrorResponseSchema,
} from '@damdai/contracts';

if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

export interface ResearchClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export function createResearchSystemClient(options: ResearchClientOptions): ResearchSystemClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/v1/analyze`;

  return {
    async analyze(input) {
      const request = {
        analysisId: input.analysisId,
        language: input.language,
        contractVersion: input.contractVersion,
        audioBase64: Buffer.from(input.audio).toString('base64'),
      };

      if (!Value.Check(ResearchAnalysisRequestSchema, request)) {
        throw new Error('Research request does not satisfy the versioned contract');
      }

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => undefined);
        if (!Value.Check(ResearchErrorResponseSchema, errorBody)) {
          throw new Error(`Research System request failed (${response.status})`);
        }
        throw new Error(`Research System request failed (${response.status})`);
      }

      const body: unknown = await response.json();
      if (!Value.Check(ResearchAnalysisResponseSchema, body)) {
        throw new Error('Research System response does not satisfy the versioned contract');
      }

      const hasClassification = body.result.emotionClassification !== undefined;
      if ((body.result.outcome === 'definitive') !== hasClassification) {
        throw new Error('Research System result has an invalid definitive classification');
      }

      return body.result;
    },
  };
}
