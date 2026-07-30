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

  return reader.listForAccount(accountId);
}
