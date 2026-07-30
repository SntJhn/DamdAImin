import { pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

export const analysisStatus = appSchema.enum('analysis_status', [
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
]);

export const analyses = appSchema.table('analyses', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull(),
  status: analysisStatus('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
