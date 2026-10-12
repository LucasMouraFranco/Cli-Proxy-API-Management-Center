import { describe, expect, test } from 'bun:test';
import { parseQuotaReadingLog } from '@/features/usage/quotaReadings';
import {
  appendQuotaReading,
  formatConsumedPercent,
  periodStartMs,
  quotaConsumedSince,
  QUOTA_READING_RETENTION_MS,
  summarizeAccountUsage,
  summarizeTotals,
  HOUR_MS,
  USAGE_BUCKET_MS,
} from '@/features/usage/usageModel';
import type { TokenUsageBucket } from '@/utils/tokenUsage';

const MINUTE = 60 * 1000;

const tokenBucket = (overrides: Partial<TokenUsageBucket> = {}): TokenUsageBucket => ({
  time: 0,
  requests: 0,
  failed: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...overrides,
});

describe('summarizeAccountUsage', () => {
  const now = 1_000 * HOUR_MS + 25 * MINUTE;

  test('counts only the buckets inside the period, newest last', () => {
    // 20 buckets as the backend sends them; only the last 6 belong to "1h".
    const recentRequests = Array.from({ length: 20 }, (_, index) => ({
      success: index < 14 ? 100 : 10,
      failed: index === 19 ? 2 : 0,
    }));
    const usage = summarizeAccountUsage({ recentRequests }, '1h', now);
    expect(usage.success).toBe(60);
    expect(usage.failed).toBe(2);
    expect(usage.requests).toBe(62);
    expect(usage.series).toEqual([10, 10, 10, 10, 10, 12]);
  });

  test('splits tokens into fresh input, output and cache reads', () => {
    const recentTokens = [
      tokenBucket({ uncachedInputTokens: 999 }), // outside "1h"
      ...Array.from({ length: 3 }, () => tokenBucket()),
      tokenBucket({ uncachedInputTokens: 100, cacheWriteTokens: 50, outputTokens: 20 }),
      tokenBucket({ cacheReadTokens: 1000 }),
      tokenBucket({ outputTokens: 5 }),
    ];
    const usage = summarizeAccountUsage({ recentTokens }, '1h', now);
    expect(usage.tokens).toEqual({ input: 150, output: 25, cacheRead: 1000, total: 1175 });
  });

  test('pads the sparkline when the backend has fewer buckets than the period', () => {
    const usage = summarizeAccountUsage({ recentRequests: [{ success: 3, failed: 0 }] }, '1h', now);
    expect(usage.series).toEqual([0, 0, 0, 0, 0, 3]);
    expect(usage.tokens.total).toBe(0);
  });

  test('7 days reads the sparse hourly buckets and sums six hours per sparkline point', () => {
    const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const hourly = [
      tokenBucket({ time: currentHour - 7 * 24 * HOUR_MS, requests: 999 }), // a week ago: outside
      tokenBucket({ time: currentHour - 167 * HOUR_MS, requests: 4, failed: 1, outputTokens: 10 }),
      tokenBucket({ time: currentHour - 163 * HOUR_MS, requests: 2 }),
      tokenBucket({ time: currentHour, requests: 5, cacheReadTokens: 100 }),
    ];
    const usage = summarizeAccountUsage({ hourly }, '7d', now);
    expect(usage.requests).toBe(11);
    expect(usage.failed).toBe(1);
    expect(usage.success).toBe(10);
    expect(usage.tokens).toEqual({ input: 0, output: 10, cacheRead: 100, total: 110 });
    expect(usage.series).toHaveLength(28);
    expect(usage.series[0]).toBe(6);
    expect(usage.series[27]).toBe(5);
  });

  test('today covers the hours since local midnight', () => {
    const midnight = new Date(2026, 9, 11).getTime();
    const at = midnight + 9 * HOUR_MS + 15 * MINUTE;
    const hourly = [
      tokenBucket({ time: midnight - HOUR_MS, requests: 50 }), // yesterday
      tokenBucket({ time: midnight + 2 * HOUR_MS, requests: 3 }),
    ];
    const usage = summarizeAccountUsage({ hourly }, 'today', at);
    expect(usage.requests).toBe(3);
    expect(usage.series).toHaveLength(10);
    expect(usage.series[2]).toBe(3);
  });
});

describe('summarizeTotals', () => {
  test('adds accounts up and counts the active ones', () => {
    const busy = summarizeAccountUsage({ recentRequests: [{ success: 9, failed: 1 }] }, '1h', 0);
    const idle = summarizeAccountUsage({}, '1h', 0);
    const totals = summarizeTotals([busy, idle]);
    expect(totals.requests).toBe(10);
    expect(totals.successRate).toBe(90);
    expect(totals.activeAccounts).toBe(1);
    expect(totals.accountCount).toBe(2);
  });

  test('has no success rate without requests', () => {
    expect(summarizeTotals([]).successRate).toBeNull();
  });
});

describe('periodStartMs', () => {
  test('starts at the oldest bucket the period covers', () => {
    const now = 100 * USAGE_BUCKET_MS + 4 * MINUTE;
    expect(periodStartMs('1h', now)).toBe(95 * USAGE_BUCKET_MS);
    expect(periodStartMs('3h', now)).toBe(83 * USAGE_BUCKET_MS);
    const hourNow = 500 * HOUR_MS + 4 * MINUTE;
    expect(periodStartMs('7d', hourNow)).toBe((500 - 167) * HOUR_MS);
    expect(periodStartMs('today', new Date(2026, 9, 11, 14, 30).getTime())).toBe(
      new Date(2026, 9, 11).getTime()
    );
  });
});

describe('quotaConsumedSince', () => {
  const start = 1_000 * MINUTE;

  test('reports one number: how much of the limit the period used', () => {
    const consumed = quotaConsumedSince(
      [
        { at: start, remaining: 72 },
        { at: start + 30 * MINUTE, remaining: 70 },
        { at: start + 60 * MINUTE, remaining: 69 },
      ],
      start
    );
    expect(consumed).toEqual({ usedPercent: 3, partialSinceMs: null });
  });

  test('keeps counting across a reset instead of going negative', () => {
    const consumed = quotaConsumedSince(
      [
        { at: start, remaining: 10 },
        { at: start + 20 * MINUTE, remaining: 4 }, // used 6
        { at: start + 30 * MINUTE, remaining: 100 }, // window reset
        { at: start + 50 * MINUTE, remaining: 97 }, // used 3
      ],
      start
    );
    expect(consumed?.usedPercent).toBe(9);
  });

  test('prorates a drop that straddles the period start', () => {
    const consumed = quotaConsumedSince(
      [
        { at: start - 30 * MINUTE, remaining: 80 },
        { at: start + 30 * MINUTE, remaining: 70 },
      ],
      start
    );
    expect(consumed?.usedPercent).toBe(5);
  });

  test('says when readings only start partway through the period', () => {
    const consumed = quotaConsumedSince(
      [
        { at: start + 20 * MINUTE, remaining: 50 },
        { at: start + 40 * MINUTE, remaining: 48 },
      ],
      start
    );
    expect(consumed).toEqual({ usedPercent: 2, partialSinceMs: start + 20 * MINUTE });
  });

  test('knows nothing without a reading inside the period', () => {
    expect(quotaConsumedSince([{ at: start - MINUTE, remaining: 50 }], start)).toBeNull();
    expect(quotaConsumedSince([{ at: start + MINUTE, remaining: 50 }], start)).toBeNull();
    expect(quotaConsumedSince([], start)).toBeNull();
  });
});

describe('appendQuotaReading', () => {
  test('drops readings past retention and repeats within a minute', () => {
    const now = 10 * QUOTA_READING_RETENTION_MS;
    const old = { at: now - QUOTA_READING_RETENTION_MS - MINUTE, remaining: 90 };
    const recent = { at: now - 30 * 1000, remaining: 80 };
    expect(appendQuotaReading([old, recent], { at: now, remaining: 80 })).toEqual([recent]);
    expect(appendQuotaReading([recent], { at: now, remaining: 79 })).toEqual([
      recent,
      { at: now, remaining: 79 },
    ]);
  });

  test('keeps only the ends of a run of equal readings', () => {
    const first = { at: 0, remaining: 70 };
    const second = { at: 10 * MINUTE, remaining: 70 };
    const third = { at: 20 * MINUTE, remaining: 70 };
    expect(appendQuotaReading([first], second)).toEqual([first, second]);
    expect(appendQuotaReading([first, second], third)).toEqual([first, third]);
  });
});

describe('parseQuotaReadingLog', () => {
  test('keeps valid, unexpired readings and ignores junk', () => {
    const now = 10 * QUOTA_READING_RETENTION_MS;
    const raw = JSON.stringify({
      'work.json': {
        'five-hour': [
          { at: now - MINUTE, remaining: 50 },
          { at: now - QUOTA_READING_RETENTION_MS - MINUTE, remaining: 60 },
          { at: 'soon', remaining: 1 },
        ],
        weekly: 'nope',
      },
      broken: [1, 2],
    });
    expect(parseQuotaReadingLog(raw, now)).toEqual({
      'work.json': { 'five-hour': [{ at: now - MINUTE, remaining: 50 }] },
    });
    expect(parseQuotaReadingLog('{not json', now)).toEqual({});
  });
});

test('formatConsumedPercent', () => {
  expect(formatConsumedPercent(0)).toBe('0%');
  expect(formatConsumedPercent(0.4)).toBe('<1%');
  expect(formatConsumedPercent(2.6)).toBe('3%');
});
