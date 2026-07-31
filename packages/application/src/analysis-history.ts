import type { AnalysisSummary } from '@damdai/domain';

export interface AnalysisHistoryReader {
  listForAccount(accountId: string): Promise<readonly AnalysisSummary[]>;
}

export async function listAnalysisHistory(
  accountId: string,
  reader: AnalysisHistoryReader,
): Promise<readonly AnalysisSummary[]> {
  if (accountId.trim().length === 0) {
    throw new Error('accountId is required');
  }

  const analyses = await reader.listForAccount(accountId);

  return analyses.filter((analysis) => analysis.status !== 'canceled');
}
