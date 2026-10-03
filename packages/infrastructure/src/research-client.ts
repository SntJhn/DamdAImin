import { FormatRegistry } from '@sinclair/typebox/type';
import { Value } from '@sinclair/typebox/value';

import type { ResearchSystemClient } from '@damdai/application';
import {
  ResearchAnalysisRequestSchema,
  ResearchAnalysisResponseSchema,
  ResearchErrorResponseSchema,
  ResearchTranscriptionRequestSchema,
  ResearchTranscriptionResponseSchema,
  type ResearchErrorResponse,
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
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/v1/analyze`;
  const transcriptionEndpoint = `${baseUrl}/v1/transcribe`;

  return {
    async transcribe(input) {
      const request = { audioBase64: Buffer.from(input.audio).toString('base64') };
      if (!Value.Check(ResearchTranscriptionRequestSchema, request)) {
        throw new Error('Research transcription request does not satisfy the versioned contract');
      }

      const response = await fetchImpl(transcriptionEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => undefined);
        const errorMessage = Value.Check(ResearchErrorResponseSchema, errorBody)
          ? `Research System transcription failed (${response.status}): ${(errorBody as ResearchErrorResponse).error}`
          : `Research System transcription failed (${response.status}): invalid error response`;
        throw new Error(errorMessage);
      }

      const body: unknown = await response.json();
      if (!Value.Check(ResearchTranscriptionResponseSchema, body)) {
        throw new Error('Research transcription response does not satisfy the versioned contract');
      }

      return body.transcript;
    },

    async analyze(input) {
      const request = {
        analysisId: input.analysisId,
        language: input.language,
        contractVersion: input.contractVersion,
        audioBase64: Buffer.from(input.audio).toString('base64'),
        ...(input.transcript === undefined ? {} : { transcript: input.transcript }),
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
        const errorMessage = Value.Check(ResearchErrorResponseSchema, errorBody)
          ? `Research System request failed (${response.status}): ${(errorBody as ResearchErrorResponse).error}`
          : `Research System request failed (${response.status}): invalid error response`;
        throw new Error(errorMessage);
      }

      const body: unknown = await response.json();
      if (!Value.Check(ResearchAnalysisResponseSchema, body)) {
        throw new Error('Research System response does not satisfy the versioned contract');
      }

      if (body.analysisId !== input.analysisId) {
        throw new Error('Research System response has a mismatched Analysis identifier');
      }
      if (body.result.contractVersion !== input.contractVersion) {
        throw new Error('Research System response has a mismatched contract version');
      }

      const hasClassification = 'emotionClassification' in body.result;
      if ((body.result.outcome === 'definitive') !== hasClassification) {
        throw new Error('Research System result has an invalid definitive classification');
      }

      return body.result;
    },
  };
}
