import { Type, type Static } from '@sinclair/typebox';

export const AnalysisHistoryStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('processing'),
  Type.Literal('completed'),
  Type.Literal('failed'),
]);

export const AnalysisHistoryResultFilterSchema = Type.Union([
  Type.Literal('definitive'),
  Type.Literal('inconclusive'),
  Type.Literal('happiness'),
  Type.Literal('sadness'),
  Type.Literal('anger'),
  Type.Literal('neutrality'),
]);

export const AnalysisHistoryQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  status: Type.Optional(AnalysisHistoryStatusSchema),
  result: Type.Optional(AnalysisHistoryResultFilterSchema),
  language: Type.Optional(
    Type.Union([Type.Literal('taglish'), Type.Literal('english'), Type.Literal('tagalog')]),
  ),
  from: Type.Optional(Type.String({ format: 'date' })),
  to: Type.Optional(Type.String({ format: 'date' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export type AnalysisHistoryQuery = Static<typeof AnalysisHistoryQuerySchema>;

const AnalysisHistoryDefinitiveResultSchema = Type.Object({
  outcome: Type.Literal('definitive'),
  emotionClassification: Type.Union([
    Type.Literal('happiness'),
    Type.Literal('sadness'),
    Type.Literal('anger'),
    Type.Literal('neutrality'),
  ]),
  transcript: Type.String(),
});

const AnalysisHistoryInconclusiveResultSchema = Type.Object({
  outcome: Type.Literal('inconclusive'),
  transcript: Type.String(),
});

export const AnalysisHistoryResultSchema = Type.Union([
  AnalysisHistoryDefinitiveResultSchema,
  AnalysisHistoryInconclusiveResultSchema,
]);

const analysisHistoryItemFields = {
  id: Type.String({ format: 'uuid' }),
  language: Type.Union([Type.Literal('taglish'), Type.Literal('english'), Type.Literal('tagalog')]),
  createdAt: Type.String({ format: 'date-time' }),
};

const AnalysisHistoryNonCompletedItemSchema = Type.Object({
  ...analysisHistoryItemFields,
  status: Type.Union([Type.Literal('queued'), Type.Literal('processing'), Type.Literal('failed')]),
  result: Type.Optional(Type.Never()),
});

const AnalysisHistoryCompletedItemSchema = Type.Object({
  ...analysisHistoryItemFields,
  status: Type.Literal('completed'),
  result: AnalysisHistoryResultSchema,
});

export const AnalysisHistoryItemSchema = Type.Union([
  AnalysisHistoryNonCompletedItemSchema,
  AnalysisHistoryCompletedItemSchema,
]);

export type AnalysisHistoryItem = Static<typeof AnalysisHistoryItemSchema>;

export const AnalysisHistoryResponseSchema = Type.Object({
  analyses: Type.Array(AnalysisHistoryItemSchema),
  hasMore: Type.Boolean(),
});

export type AnalysisHistoryResponse = Static<typeof AnalysisHistoryResponseSchema>;

export const UnauthorizedResponseSchema = Type.Object({
  error: Type.Literal('unauthorized'),
});

export const ServiceUnavailableResponseSchema = Type.Object({
  error: Type.Literal('service_unavailable'),
});
