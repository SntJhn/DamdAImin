import { describe, expect, it } from 'vitest';

import { listAnalysisHistory } from './analysis-history.js';

describe('Analysis History application service', () => {
  it('reads all summaries and applies account ownership in the service', async () => {
    const calls: string[] = [];
    const reader = {
      listAll: async () => {
        calls.push('listAll');
        return [
          {
            id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
            accountId: 'account-a',
            status: 'completed' as const,
            createdAt: new Date('2026-07-31T00:00:00.000Z'),
          },
          {
            id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
            accountId: 'account-b',
            status: 'completed' as const,
            createdAt: new Date('2026-07-31T00:01:00.000Z'),
          },
        ];
      },
    };

    await expect(listAnalysisHistory('account-a', reader)).resolves.toEqual([
      {
        id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        accountId: 'account-a',
        status: 'completed',
        createdAt: new Date('2026-07-31T00:00:00.000Z'),
      },
    ]);

    expect(calls).toEqual(['listAll']);
  });

  it("does not return another account's records", async () => {
    const reader = {
      listAll: async () => [
        {
          id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          accountId: 'account-a',
          status: 'completed' as const,
          createdAt: new Date('2026-07-31T00:00:00.000Z'),
        },
        {
          id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
          accountId: 'account-b',
          status: 'completed' as const,
          createdAt: new Date('2026-07-31T00:01:00.000Z'),
        },
      ],
    };

    await expect(listAnalysisHistory('account-a', reader)).resolves.toHaveLength(1);
    await expect(listAnalysisHistory('account-c', reader)).resolves.toEqual([]);
  });

  it('keeps canceled analyses out of History', async () => {
    const reader = {
      listAll: async () => [
        {
          id: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          accountId: 'account-a',
          status: 'canceled' as const,
          createdAt: new Date('2026-07-31T00:00:00.000Z'),
        },
        {
          id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
          accountId: 'account-a',
          status: 'queued' as const,
          createdAt: new Date('2026-07-31T00:01:00.000Z'),
        },
      ],
    };

    await expect(listAnalysisHistory('account-a', reader)).resolves.toEqual([
      {
        id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
        accountId: 'account-a',
        status: 'queued',
        createdAt: new Date('2026-07-31T00:01:00.000Z'),
      },
    ]);
  });
});
