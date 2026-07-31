import { describe, expect, it } from 'vitest';

import { listAnalysisHistory } from './analysis-history.js';

describe('Analysis History application service', () => {
  it('passes the authenticated account to the ownership-aware reader', async () => {
    const calls: string[] = [];
    const reader = {
      listForAccount: async (accountId: string) => {
        calls.push(accountId);
        return [];
      },
    };

    await listAnalysisHistory('account-a', reader);

    expect(calls).toEqual(['account-a']);
  });

  it("does not return another account's records", async () => {
    const reader = {
      listForAccount: async (accountId: string) =>
        accountId === 'account-a'
          ? [
              {
                id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
                status: 'completed' as const,
                createdAt: new Date('2026-07-31T00:00:00.000Z'),
              },
            ]
          : [],
    };

    await expect(listAnalysisHistory('account-a', reader)).resolves.toHaveLength(1);
    await expect(listAnalysisHistory('account-b', reader)).resolves.toEqual([]);
  });

  it('keeps canceled analyses out of History', async () => {
    const reader = {
      listForAccount: async () => [
        {
          id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          status: 'canceled' as const,
          createdAt: new Date('2026-07-31T00:00:00.000Z'),
        },
        {
          id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
          status: 'queued' as const,
          createdAt: new Date('2026-07-31T00:01:00.000Z'),
        },
      ],
    };

    await expect(listAnalysisHistory('account-a', reader)).resolves.toEqual([
      {
        id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
        status: 'queued',
        createdAt: new Date('2026-07-31T00:01:00.000Z'),
      },
    ]);
  });
});
