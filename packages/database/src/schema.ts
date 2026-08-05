import type { AnalysisResult } from '@damdai/domain';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

export const analysisStatus = appSchema.enum('analysis_status', [
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
]);

export const analysisLanguage = appSchema.enum('analysis_language', [
  'taglish',
  'english',
  'tagalog',
]);

export const analysisUploadStatus = appSchema.enum('analysis_upload_status', [
  'created',
  'finalized',
]);

export const analyses = appSchema.table(
  'analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id').notNull(),
    status: analysisStatus('status').notNull(),
    stage: text('stage').notNull().default('queued'),
    language: analysisLanguage('language').notNull().default('taglish'),
    contractVersion: text('contract_version').notNull().default('taglish-v2'),
    sourceAudioKey: text('source_audio_key'),
    sourceAudioSize: integer('source_audio_size'),
    retainSourceAudio: boolean('retain_source_audio').notNull().default(false),
    sourceAudioRetentionUntil: timestamp('source_audio_retention_until', { withTimezone: true }),
    sourceAudioCleanupKey: text('source_audio_cleanup_key'),
    retryOfAnalysisId: uuid('retry_of_analysis_id').unique(),
    retryAnalysisId: uuid('retry_analysis_id'),
    result: jsonb('result').$type<AnalysisResult | null>(),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountCreatedAtIndex: index('analyses_account_created_at_idx').on(
      table.accountId,
      table.createdAt,
      table.id,
    ),
  }),
);

export const analysisUploads = appSchema.table('analysis_uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull(),
  objectKey: text('object_key').notNull().unique(),
  language: analysisLanguage('language').notNull(),
  contractVersion: text('contract_version').notNull(),
  contentType: text('content_type').notNull(),
  retainSourceAudio: boolean('retain_source_audio').notNull().default(false),
  sourceAudioRetentionUntil: timestamp('source_audio_retention_until', { withTimezone: true }),
  status: analysisUploadStatus('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  analysisId: uuid('analysis_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
