import { Type, type Static } from '@sinclair/typebox';

export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  service: Type.String(),
  version: Type.String(),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
