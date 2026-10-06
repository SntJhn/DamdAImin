import { Type, type Static } from '@sinclair/typebox';

export const AnalysisLanguageSchema = Type.Union([
  Type.Literal('taglish'),
  Type.Literal('english'),
  Type.Literal('tagalog'),
]);

export const AnalysisStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('processing'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('canceled'),
]);

export const AnalysisOutcomeSchema = Type.Union([
  Type.Literal('definitive'),
  Type.Literal('inconclusive'),
]);

export const EmotionClassificationSchema = Type.Union([
  Type.Literal('happiness'),
  Type.Literal('sadness'),
  Type.Literal('anger'),
  Type.Literal('neutrality'),
]);

export const ConfidenceBreakdownSchema = Type.Object({
  happiness: Type.Number({ minimum: 0, maximum: 1 }),
  sadness: Type.Number({ minimum: 0, maximum: 1 }),
  anger: Type.Number({ minimum: 0, maximum: 1 }),
  neutrality: Type.Number({ minimum: 0, maximum: 1 }),
});

export const TechnicalCueSpanSchema = Type.Object({
  source: Type.Union([Type.Literal('acoustic'), Type.Literal('linguistic')]),
  startMs: Type.Number({ minimum: 0 }),
  endMs: Type.Number({ minimum: 0 }),
  cue: Type.String({ minLength: 1 }),
  value: Type.String({ minLength: 1 }),
});

export const ActivatedRuleSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
});

export const ScoreAdjustmentSchema = Type.Object({
  cue: Type.Optional(Type.String({ minLength: 1 })),
  ruleId: Type.Optional(Type.String({ minLength: 1 })),
  emotionClassification: EmotionClassificationSchema,
  delta: Type.Number(),
  reason: Type.String({ minLength: 1 }),
});

export const SymbolicScoreJourneyStepSchema = Type.Object({
  cue: Type.String({ minLength: 1 }),
  ruleId: Type.String({ minLength: 1 }),
  source: Type.Union([
    Type.Literal('baseline'),
    Type.Literal('linguistic'),
    Type.Literal('acoustic'),
    Type.Literal('system'),
  ]),
  scores: ConfidenceBreakdownSchema,
});

export const TechnicalTraceSchema = Type.Object({
  cueSpans: Type.Array(TechnicalCueSpanSchema),
  activatedRules: Type.Array(ActivatedRuleSchema),
  scoreAdjustments: Type.Array(ScoreAdjustmentSchema),
  scoreJourney: Type.Optional(Type.Array(SymbolicScoreJourneyStepSchema)),
  probabilities: Type.Object({
    before: ConfidenceBreakdownSchema,
    symbolic: Type.Optional(ConfidenceBreakdownSchema),
    after: ConfidenceBreakdownSchema,
  }),
});

const analysisResultFields = {
  confidence: ConfidenceBreakdownSchema,
  transcript: Type.String(),
  explanation: Type.String(),
  technicalTrace: TechnicalTraceSchema,
  contractVersion: Type.String({ minLength: 1 }),
  schemaVersion: Type.String({ minLength: 1 }),
  modelVersion: Type.String({ minLength: 1 }),
  preprocessingVersion: Type.String({ minLength: 1 }),
  ruleSetVersion: Type.String({ minLength: 1 }),
};

export const AnalysisResultSchema = Type.Union([
  Type.Object(
    {
      ...analysisResultFields,
      outcome: Type.Literal('definitive'),
      emotionClassification: EmotionClassificationSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...analysisResultFields,
      outcome: Type.Literal('inconclusive'),
    },
    { additionalProperties: false },
  ),
]);

export const CreateAnalysisUploadRequestSchema = Type.Object({
  language: AnalysisLanguageSchema,
  contractVersion: Type.String({ minLength: 1, maxLength: 64 }),
  retainSourceAudio: Type.Optional(Type.Boolean()),
});

export const CreateAnalysisUploadResponseSchema = Type.Object({
  uploadId: Type.String({ format: 'uuid' }),
  uploadUrl: Type.String({ format: 'uri' }),
  uploadMethod: Type.Union([Type.Literal('PUT'), Type.Literal('POST')]),
  uploadHeaders: Type.Object({
    'content-type': Type.Literal('audio/wav'),
  }),
  expiresAt: Type.String({ format: 'date-time' }),
});

export const FinalizeAnalysisRequestSchema = Type.Object({
  uploadId: Type.String({ format: 'uuid' }),
  transcript: Type.Optional(Type.String({ maxLength: 4000 })),
});

export const TranscriptionPreviewParamsSchema = Type.Object({
  uploadId: Type.String({ format: 'uuid' }),
});

export const TranscriptionPreviewResponseSchema = Type.Object({
  transcript: Type.String(),
});

export const AnalysisIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const AnalysisResourceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: AnalysisStatusSchema,
  stage: Type.String({ minLength: 1 }),
  language: AnalysisLanguageSchema,
  createdAt: Type.String({ format: 'date-time' }),
  retryAvailable: Type.Boolean(),
  retryOfAnalysisId: Type.Optional(Type.String({ format: 'uuid' })),
  failureMessage: Type.Optional(Type.String()),
  result: Type.Optional(AnalysisResultSchema),
});

export const AcceptedAnalysisResponseSchema = Type.Object({
  analysis: AnalysisResourceSchema,
  location: Type.String({ format: 'uri-reference' }),
});

export const ValidationErrorResponseSchema = Type.Object({
  error: Type.Literal('validation_error'),
  message: Type.String(),
});

export const NotFoundResponseSchema = Type.Object({
  error: Type.Literal('not_found'),
});

export const ConflictResponseSchema = Type.Object({
  error: Type.Literal('conflict'),
  message: Type.String(),
});

export const AnalysisFailureResponseSchema = Type.Object({
  error: Type.Literal('analysis_failed'),
  message: Type.String(),
});

export type AnalysisLanguage = Static<typeof AnalysisLanguageSchema>;
export type AnalysisStatus = Static<typeof AnalysisStatusSchema>;
export type AnalysisOutcome = Static<typeof AnalysisOutcomeSchema>;
export type EmotionClassification = Static<typeof EmotionClassificationSchema>;
export type ActivatedRule = Static<typeof ActivatedRuleSchema>;
export type ScoreAdjustment = Static<typeof ScoreAdjustmentSchema>;
export type SymbolicScoreJourneyStep = Static<typeof SymbolicScoreJourneyStepSchema>;
export type TechnicalCueSpan = Static<typeof TechnicalCueSpanSchema>;
export type TechnicalTrace = Static<typeof TechnicalTraceSchema>;
export type AnalysisResult = Static<typeof AnalysisResultSchema>;
export type CreateAnalysisUploadRequest = Static<typeof CreateAnalysisUploadRequestSchema>;
export type CreateAnalysisUploadResponse = Static<typeof CreateAnalysisUploadResponseSchema>;
export type FinalizeAnalysisRequest = Static<typeof FinalizeAnalysisRequestSchema>;
export type AnalysisIdParams = Static<typeof AnalysisIdParamsSchema>;
export type AnalysisResource = Static<typeof AnalysisResourceSchema>;
export type AcceptedAnalysisResponse = Static<typeof AcceptedAnalysisResponseSchema>;
