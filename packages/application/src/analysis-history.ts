import type { AnalysisSummary } from '@damdai/domain';

export interface AnalysisHistoryReader {
  listAll(): Promise<readonly AnalysisSummary[]>;
}

export async function listAnalysisHistory(
  accountId: string,
  reader: AnalysisHistoryReader,
): Promise<readonly AnalysisSummary[]> {
  if (accountId.trim().length === 0) {
    throw new Error('accountId is required');
  }

  const analyses = await reader.listAll();

  return analyses.filter(
    (analysis) => analysis.accountId === accountId && analysis.status !== 'canceled',
  );
}
