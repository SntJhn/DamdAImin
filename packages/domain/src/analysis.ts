export const analysisStatuses = [
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
] as const;

export type AnalysisStatus = (typeof analysisStatuses)[number];

export const analysisLanguages = ['taglish', 'english', 'tagalog'] as const;

export type AnalysisLanguage = (typeof analysisLanguages)[number];

export interface AnalysisSummary {
  id: string;
  status: AnalysisStatus;
  createdAt: Date;
}
