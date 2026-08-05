import {
  analysisLanguages,
  analysisOutcomes,
  emotionClassifications,
  type AnalysisLanguage,
  type AnalysisOutcome,
  type AnalysisStatus,
  type AnalysisSummary,
  type EmotionClassification,
} from '@damdai/domain';

export const analysisHistoryDefaultLimit = 50;
export const analysisHistoryMaximumLimit = 100;
export const analysisHistoryMaximumSearchLength = 200;

const analysisHistoryStatuses = ['queued', 'processing', 'completed', 'failed'] as const;

export type AnalysisHistoryStatus = Exclude<AnalysisStatus, 'canceled'>;
export type AnalysisHistoryResultFilter = AnalysisOutcome | EmotionClassification;

export interface AnalysisHistoryFilters {
  search?: string;
  status?: AnalysisHistoryStatus;
  result?: AnalysisHistoryResultFilter;
  language?: AnalysisLanguage;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface AnalysisHistoryPage {
  analyses: readonly AnalysisSummary[];
  hasMore: boolean;
}

export interface AnalysisHistoryReader {
  list(accountId: string, filters: AnalysisHistoryFilters): Promise<AnalysisHistoryPage>;
}

export class AnalysisHistoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisHistoryInputError';
  }
}

export async function listAnalysisHistory(
  accountId: string,
  filters: AnalysisHistoryFilters,
  reader: AnalysisHistoryReader,
): Promise<AnalysisHistoryPage> {
  if (accountId.trim().length === 0) {
    throw new AnalysisHistoryInputError('accountId is required');
  }

  const normalizedFilters = normalizeHistoryFilters(filters);
  const page = await reader.list(accountId, normalizedFilters);
  const analyses = page.analyses
    .filter((analysis) => matchesHistoryFilters(analysis, accountId, normalizedFilters))
    .sort(compareHistorySummaries);

  return {
    analyses: analyses.slice(0, normalizedFilters.limit),
    hasMore: page.hasMore || analyses.length > normalizedFilters.limit,
  };
}

function normalizeHistoryFilters(
  filters: AnalysisHistoryFilters,
): Required<Pick<AnalysisHistoryFilters, 'limit'>> & Omit<AnalysisHistoryFilters, 'limit'> {
  const search = filters.search?.trim();
  if (search && search.length > analysisHistoryMaximumSearchLength) {
    throw new AnalysisHistoryInputError('The Transcript search is too long');
  }

  const limit = filters.limit ?? analysisHistoryDefaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > analysisHistoryMaximumLimit) {
    throw new AnalysisHistoryInputError(
      `History limit must be between 1 and ${analysisHistoryMaximumLimit}`,
    );
  }

  if (filters.status && !analysisHistoryStatuses.includes(filters.status)) {
    throw new AnalysisHistoryInputError('The Analysis History status is unsupported');
  }

  if (filters.language && !analysisLanguages.includes(filters.language)) {
    throw new AnalysisHistoryInputError('The Analysis language is unsupported');
  }

  if (filters.result && !isHistoryResultFilter(filters.result)) {
    throw new AnalysisHistoryInputError('The Analysis History result is unsupported');
  }

  if (filters.from && !isValidDate(filters.from)) {
    throw new AnalysisHistoryInputError('The History start date is invalid');
  }

  if (filters.to && !isValidDate(filters.to)) {
    throw new AnalysisHistoryInputError('The History end date is invalid');
  }

  if (filters.from && filters.to && filters.from.getTime() > filters.to.getTime()) {
    throw new AnalysisHistoryInputError('The History start date must be before its end date');
  }

  return {
    ...filters,
    search: search || undefined,
    limit,
  };
}

function matchesHistoryFilters(
  analysis: AnalysisSummary,
  accountId: string,
  filters: AnalysisHistoryFilters,
): boolean {
  if (analysis.accountId !== accountId || analysis.status === 'canceled') return false;
  if (filters.status && analysis.status !== filters.status) return false;
  if (filters.language && analysis.language !== filters.language) return false;
  if (filters.from && analysis.createdAt < filters.from) return false;
  if (filters.to && analysis.createdAt > filters.to) return false;

  if (filters.result) {
    if (analysis.status !== 'completed' || !analysis.result) return false;
    if (isAnalysisOutcome(filters.result)) {
      if (analysis.result.outcome !== filters.result) return false;
    } else if (
      analysis.result.outcome !== 'definitive' ||
      analysis.result.emotionClassification !== filters.result
    ) {
      return false;
    }
  }

  if (filters.search) {
    if (
      analysis.status !== 'completed' ||
      !analysis.result?.transcript.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase())
    ) {
      return false;
    }
  }

  return true;
}

function compareHistorySummaries(left: AnalysisSummary, right: AnalysisSummary): number {
  const createdAtOrder = right.createdAt.getTime() - left.createdAt.getTime();
  return createdAtOrder || right.id.localeCompare(left.id);
}

function isHistoryResultFilter(value: string): value is AnalysisHistoryResultFilter {
  return (
    isAnalysisOutcome(value) || emotionClassifications.includes(value as EmotionClassification)
  );
}

function isAnalysisOutcome(value: string): value is AnalysisOutcome {
  return analysisOutcomes.includes(value as AnalysisOutcome);
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
