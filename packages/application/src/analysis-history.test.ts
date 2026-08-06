import { describe, expect, it, vi } from 'vitest';

import type { AnalysisSummary } from '@damdai/domain';

import {
  analysisHistoryMaximumLimit,
  listAnalysisHistory,
  type AnalysisHistoryReader,
} from './analysis-history.js';

const accountA = 'account-a';

function summary(
  overrides: Partial<AnalysisSummary> & Pick<AnalysisSummary, 'id'>,
): AnalysisSummary {
  return {
    accountId: accountA,
    status: 'completed',
    language: 'taglish',
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    result: {
      outcome: 'definitive',
      emotionClassification: 'happiness',
      transcript: 'Masaya ako sa araw na ito.',
    },
    ...overrides,
  };
}

describe('Analysis History application service', () => {
  it('passes validated filters to the reader and returns a bounded stable page', async () => {
    const reader: AnalysisHistoryReader = {
      list: vi.fn(async () => ({
        analyses: [
          summary({ id: '00000000-0000-0000-0000-000000000002' }),
          summary({ id: '00000000-0000-0000-0000-000000000001' }),
        ],
        hasMore: true,
      })),
    };

    await expect(
      listAnalysisHistory(
        accountA,
        {
          search: '  Masaya ako  ',
          status: 'completed',
          result: 'definitive',
          language: 'taglish',
          from: new Date('2026-07-30T00:00:00.000Z'),
          to: new Date('2026-08-01T00:00:00.000Z'),
          limit: 1,
        },
        reader,
      ),
    ).resolves.toEqual({
      analyses: [summary({ id: '00000000-0000-0000-0000-000000000002' })],
      hasMore: true,
    });

    expect(reader.list).toHaveBeenCalledWith(
      accountA,
      expect.objectContaining({ search: 'Masaya ako', limit: 1 }),
    );
  });

  it("does not return another account's record or a canceled Analysis", async () => {
    const reader: AnalysisHistoryReader = {
      list: async () => ({
        analyses: [
          summary({ id: '00000000-0000-0000-0000-000000000001' }),
          summary({
            id: '00000000-0000-0000-0000-000000000002',
            accountId: 'account-b',
          }),
          summary({
            id: '00000000-0000-0000-0000-000000000003',
            status: 'canceled',
            result: null,
          }),
        ],
        hasMore: false,
      }),
    };

    await expect(listAnalysisHistory(accountA, {}, reader)).resolves.toMatchObject({
      analyses: [expect.objectContaining({ id: '00000000-0000-0000-0000-000000000001' })],
      hasMore: false,
    });
  });

  it('filters Transcript search to completed records and keeps Inconclusive separate', async () => {
    const reader: AnalysisHistoryReader = {
      list: async () => ({
        analyses: [
          summary({ id: '00000000-0000-0000-0000-000000000001' }),
          summary({
            id: '00000000-0000-0000-0000-000000000002',
            result: { outcome: 'inconclusive', transcript: 'Hindi malinaw ang sample.' },
          }),
          summary({
            id: '00000000-0000-0000-0000-000000000003',
            status: 'failed',
            result: null,
          }),
        ],
        hasMore: false,
      }),
    };

    await expect(
      listAnalysisHistory(accountA, { search: 'hindi', result: 'inconclusive' }, reader),
    ).resolves.toMatchObject({
      analyses: expect.arrayContaining([
        expect.objectContaining({
          id: '00000000-0000-0000-0000-000000000002',
          result: expect.objectContaining({ outcome: 'inconclusive' }),
        }),
      ]),
    });
  });

  it('rejects invalid limits and reversed dates without leaking input values', async () => {
    const reader: AnalysisHistoryReader = { list: vi.fn() };

    await expect(
      listAnalysisHistory(
        accountA,
        { limit: analysisHistoryMaximumLimit + 1, search: 'SENTINEL_TRANSCRIPT' },
        reader,
      ),
    ).rejects.toThrow(`History limit must be between 1 and ${analysisHistoryMaximumLimit}`);
    await expect(
      listAnalysisHistory(
        accountA,
        {
          from: new Date('2026-08-02T00:00:00.000Z'),
          to: new Date('2026-08-01T00:00:00.000Z'),
        },
        reader,
      ),
    ).rejects.toThrow('start date must be before its end date');
    expect(reader.list).not.toHaveBeenCalled();
  });
});
