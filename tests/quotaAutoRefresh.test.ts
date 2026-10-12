import { describe, expect, test } from 'bun:test';
import {
  QUOTA_AUTO_REFRESH_MS,
  pickAutoRefreshTargets,
} from '../src/features/quota/hooks/useQuotaAutoRefresh';
import type { QuotaFileEntry } from '../src/features/quota/logic';

const NOW = Date.UTC(2026, 9, 12, 12);
const MINUTE = 60_000;
const entry = (name: string): QuotaFileEntry => ({
  file: { name, type: 'claude' },
  type: 'claude',
});
const names = (entries: QuotaFileEntry[]) => entries.map((item) => item.file.name);

describe('pickAutoRefreshTargets', () => {
  const accounts = [entry('fresh.json'), entry('stale.json'), entry('never.json')];
  const lastLoaded: Record<string, number> = {
    'fresh.json': NOW - 3 * MINUTE,
    'stale.json': NOW - QUOTA_AUTO_REFRESH_MS,
  };

  test('skips accounts any tab loaded within the interval', () => {
    const due = pickAutoRefreshTargets(accounts, NOW, (key) => lastLoaded[key] ?? null, new Map());
    expect(names(due)).toEqual(['stale.json', 'never.json']);
  });

  test('leaves a rate-limited account alone until its backoff ends', () => {
    const backoff = new Map([['never.json', NOW + 5 * MINUTE]]);
    expect(names(pickAutoRefreshTargets(accounts, NOW, () => null, backoff))).toEqual([
      'fresh.json',
      'stale.json',
    ]);
    expect(
      names(pickAutoRefreshTargets(accounts, NOW + 6 * MINUTE, () => null, backoff))
    ).toContain('never.json');
  });
});
