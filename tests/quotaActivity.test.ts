import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types';
import type { TokenUsageBucket } from '@/utils/tokenUsage';
import { buildLastHourActivity } from '@/features/quota/quotaActivity';

const BUCKET = 10 * 60 * 1000;
const now = Date.parse('2026-10-12T12:05:00Z');

/** Twelve ten-minute request buckets, oldest first; `lastHour` fills the newest six. */
const file = (name: string, lastHour: number[], earlier = 0): AuthFileItem =>
  ({
    name,
    recentRequests: [...Array(6).fill(earlier), ...lastHour].map((success) => ({
      success,
      failed: 0,
    })),
    tokenUsage: {
      recent: lastHour.map((requests, index): TokenUsageBucket => ({
        time: now - (5 - index) * BUCKET,
        requests,
        failed: 0,
        uncachedInputTokens: requests * 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })),
    },
  }) as unknown as AuthFileItem;

describe('last-hour activity', () => {
  test('counts only the last hour and marks the busiest account per provider', () => {
    const activity = buildLastHourActivity(
      [
        // Busy earlier, quieter now: the older buckets must not count.
        { key: 'claude:a', type: 'claude', file: file('a', [1, 1, 1, 1, 1, 1], 50) },
        { key: 'claude:b', type: 'claude', file: file('b', [2, 3, 4, 5, 2, 2]) },
        { key: 'codex:c', type: 'codex', file: file('c', [0, 0, 0, 0, 0, 1]) },
      ],
      now
    );

    expect(activity.get('claude:a')?.usage.requests).toBe(6);
    expect(activity.get('claude:b')?.usage.requests).toBe(18);
    expect(activity.get('claude:b')?.share).toBe(0.75);
    expect(activity.get('claude:b')?.busiest).toBe(true);
    expect(activity.get('claude:a')?.busiest).toBe(false);
    expect(activity.get('claude:b')?.usage.tokens.total).toBe(1800);
    // Each provider has its own leader and shares.
    expect(activity.get('codex:c')?.busiest).toBe(true);
    expect(activity.get('codex:c')?.share).toBe(1);
  });

  test('an idle provider has no busiest account and no share', () => {
    const activity = buildLastHourActivity(
      [{ key: 'claude:a', type: 'claude', file: { name: 'a' } as AuthFileItem }],
      now
    );
    expect(activity.get('claude:a')).toMatchObject({ share: null, busiest: false });
    expect(activity.get('claude:a')?.usage.requests).toBe(0);
  });
});
