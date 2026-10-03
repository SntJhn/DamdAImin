import { Type, type Static } from '@sinclair/typebox';

import { AnalysisLanguageSchema, AnalysisResultSchema } from './analysis.js';

export const ResearchAnalysisRequestSchema = Type.Object({
  analysisId: Type.String({ format: 'uuid' }),
  language: AnalysisLanguageSchema,
  contractVersion: Type.String({ minLength: 1, maxLength: 64 }),
  audioBase64: Type.String({ minLength: 1 }),
  transcript: Type.Optional(Type.String({ maxLength: 4000 })),
});

export const ResearchTranscriptionRequestSchema = Type.Object({
  audioBase64: Type.String({ minLength: 1 }),
});

export const ResearchTranscriptionResponseSchema = Type.Object({
  transcript: Type.String(),
});

export const ResearchAnalysisResponseSchema = Type.Object({
  analysisId: Type.String({ format: 'uuid' }),
  result: AnalysisResultSchema,
});

export const ResearchErrorResponseSchema = Type.Object({
  error: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
});

export type ResearchAnalysisRequest = Static<typeof ResearchAnalysisRequestSchema>;
export type ResearchAnalysisResponse = Static<typeof ResearchAnalysisResponseSchema>;
export type ResearchTranscriptionRequest = Static<typeof ResearchTranscriptionRequestSchema>;
export type ResearchTranscriptionResponse = Static<typeof ResearchTranscriptionResponseSchema>;
export type ResearchErrorResponse = Static<typeof ResearchErrorResponseSchema>;
