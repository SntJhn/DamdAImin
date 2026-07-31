import { Type, type Static } from '@sinclair/typebox';

export const AnalysisHistoryItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: Type.Union([
    Type.Literal('queued'),
    Type.Literal('processing'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  createdAt: Type.String({ format: 'date-time' }),
});

export type AnalysisHistoryItem = Static<typeof AnalysisHistoryItemSchema>;

export const AnalysisHistoryResponseSchema = Type.Object({
  analyses: Type.Array(AnalysisHistoryItemSchema),
});

export type AnalysisHistoryResponse = Static<typeof AnalysisHistoryResponseSchema>;

export const UnauthorizedResponseSchema = Type.Object({
  error: Type.Literal('unauthorized'),
});

export const ServiceUnavailableResponseSchema = Type.Object({
  error: Type.Literal('service_unavailable'),
});
