/**
 * Usage by account: requests, tokens and quota consumed per account over a
 * period. Pure functions; `now` is always passed in.
 *
 * Short periods (1h, 3h) use the backend's per-credential ten-minute buckets
 * (zero-filled, oldest first, newest is the bucket in progress), which cover
 * three hours. Long periods (today, 7 days) use its hourly buckets, which cover
 * seven days, survive restarts and list only hours with requests.
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';
import type { TokenUsageBucket } from '@/utils/tokenUsage';

export const USAGE_PERIODS = ['1h', '3h', 'today', '7d'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export const USAGE_BUCKET_MS = 10 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

const SHORT_PERIOD_BUCKETS: Partial<Record<UsagePeriod, number>> = { '1h': 6, '3h': 18 };
const WEEK_HOURS = 7 * 24;
/** The 7-day sparkline sums hours into six-hour points so it stays readable. */
const WEEK_SPARK_GROUP = 6;

export const isUsagePeriod = (value: unknown): value is UsagePeriod =>
  typeof value === 'string' && (USAGE_PERIODS as readonly string[]).includes(value);

const isHourlyPeriod = (period: UsagePeriod) => SHORT_PERIOD_BUCKETS[period] === undefined;

/**
 * Start of the oldest bucket the period covers. Quota consumption is measured
 * from the same instant so every column describes the same stretch of time.
 * "Today" starts at local midnight, rounded down to the hour for time zones
 * with a half-hour offset, since backend hours are whole UTC hours.
 */
export const periodStartMs = (period: UsagePeriod, nowMs: number): number => {
  const shortCount = SHORT_PERIOD_BUCKETS[period];
  if (shortCount !== undefined) {
    const currentBucketStart = Math.floor(nowMs / USAGE_BUCKET_MS) * USAGE_BUCKET_MS;
    return currentBucketStart - (shortCount - 1) * USAGE_BUCKET_MS;
  }
  const currentHourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  if (period === '7d') return currentHourStart - (WEEK_HOURS - 1) * HOUR_MS;
  const midnight = new Date(nowMs);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor(midnight.getTime() / HOUR_MS) * HOUR_MS;
};

export interface UsageTokens {
  /** Fresh input: uncached input plus input written to the prompt cache. */
  input: number;
  output: number;
  cacheRead: number;
  total: number;
}

export interface AccountUsage {
  success: number;
  failed: number;
  requests: number;
  tokens: UsageTokens;
  /** Requests per bucket, oldest first, for the sparkline. */
  series: number[];
}

const EMPTY_TOKENS: UsageTokens = { input: 0, output: 0, cacheRead: 0, total: 0 };

const addTokens = (sum: UsageTokens, bucket: TokenUsageBucket): UsageTokens => {
  const input = bucket.uncachedInputTokens + bucket.cacheWriteTokens;
  return {
    input: sum.input + input,
    output: sum.output + bucket.outputTokens,
    cacheRead: sum.cacheRead + bucket.cacheReadTokens,
    total: sum.total + input + bucket.outputTokens + bucket.cacheReadTokens,
  };
};

const lastN = <T>(items: readonly T[] | undefined, count: number): T[] =>
  items && items.length > 0 ? items.slice(-count) : [];

/** One account's buckets as the backend reports them. */
export interface AccountUsageSource {
  /** Ten-minute request buckets, oldest first. */
  recentRequests?: readonly RecentRequestBucket[];
  /** Ten-minute token buckets, oldest first. */
  recentTokens?: readonly TokenUsageBucket[];
  /** Hourly buckets (requests, failures and tokens), only hours with requests. */
  hourly?: readonly TokenUsageBucket[];
}

export function summarizeAccountUsage(
  source: AccountUsageSource,
  period: UsagePeriod,
  nowMs: number
): AccountUsage {
  return isHourlyPeriod(period)
    ? summarizeHourly(source.hourly, period, nowMs)
    : summarizeShort(source, SHORT_PERIOD_BUCKETS[period] ?? 0);
}

function summarizeShort(source: AccountUsageSource, count: number): AccountUsage {
  const requests = lastN(source.recentRequests, count);
  const series = requests.map((bucket) => bucket.success + bucket.failed);
  // Missing leading buckets mean "no data yet", which reads the same as idle.
  while (series.length < count) series.unshift(0);

  const success = requests.reduce((sum, bucket) => sum + bucket.success, 0);
  const failed = requests.reduce((sum, bucket) => sum + bucket.failed, 0);
  const tokens = lastN(source.recentTokens, count).reduce(addTokens, EMPTY_TOKENS);
  return { success, failed, requests: success + failed, tokens, series };
}

function summarizeHourly(
  hourly: readonly TokenUsageBucket[] | undefined,
  period: UsagePeriod,
  nowMs: number
): AccountUsage {
  const startMs = periodStartMs(period, nowMs);
  const hours = Math.floor(nowMs / HOUR_MS) - startMs / HOUR_MS + 1;
  const perHour = new Array<number>(hours).fill(0);
  let requests = 0;
  let failed = 0;
  let tokens = EMPTY_TOKENS;
  (hourly ?? []).forEach((bucket) => {
    const index = Math.floor((bucket.time - startMs) / HOUR_MS);
    if (index < 0 || index >= hours) return;
    perHour[index] += bucket.requests;
    requests += bucket.requests;
    failed += bucket.failed;
    tokens = addTokens(tokens, bucket);
  });

  const group = period === '7d' ? WEEK_SPARK_GROUP : 1;
  const series: number[] = [];
  for (let index = 0; index < perHour.length; index += group) {
    series.push(perHour.slice(index, index + group).reduce((sum, value) => sum + value, 0));
  }
  return { success: requests - failed, failed, requests, tokens, series };
}

export interface UsageTotals {
  requests: number;
  failed: number;
  /** Percent of requests that succeeded; null when there were none. */
  successRate: number | null;
  tokens: UsageTokens;
  activeAccounts: number;
  accountCount: number;
}

export function summarizeTotals(accounts: readonly AccountUsage[]): UsageTotals {
  let requests = 0;
  let failed = 0;
  let activeAccounts = 0;
  let tokens = EMPTY_TOKENS;
  accounts.forEach((account) => {
    requests += account.requests;
    failed += account.failed;
    if (account.requests > 0 || account.tokens.total > 0) activeAccounts += 1;
    tokens = {
      input: tokens.input + account.tokens.input,
      output: tokens.output + account.tokens.output,
      cacheRead: tokens.cacheRead + account.tokens.cacheRead,
      total: tokens.total + account.tokens.total,
    };
  });
  return {
    requests,
    failed,
    successRate: requests > 0 ? ((requests - failed) / requests) * 100 : null,
    tokens,
    activeAccounts,
    accountCount: accounts.length,
  };
}

/* ---------- Quota consumed in the period ---------- */

/** One saved reading of a quota window: percent remaining at an instant. */
export interface QuotaReading {
  at: number;
  remaining: number;
}

export interface QuotaConsumption {
  /** Percentage points of the limit used during the period. */
  usedPercent: number;
  /** Readings only start partway through the period; usage is counted from here. */
  partialSinceMs: number | null;
}

/**
 * Quota used since `startMs`, from readings saved while the app was open.
 *
 * Adds up every drop between consecutive readings and ignores rises, so a
 * window that resets mid-period still counts what was used before and after
 * the reset. A drop between a reading before `startMs` and one after it is
 * prorated by how much of that gap falls inside the period.
 *
 * Returns null when no reading lands inside the period, because then nothing
 * is known about it.
 */
export function quotaConsumedSince(
  readings: readonly QuotaReading[],
  startMs: number
): QuotaConsumption | null {
  const sorted = [...readings].sort((a, b) => a.at - b.at);
  let used = 0;
  let pairs = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.at <= startMs) continue;
    pairs += 1;
    const drop = Math.max(0, previous.remaining - current.remaining);
    if (previous.at >= startMs) {
      used += drop;
    } else {
      used += (drop * (current.at - startMs)) / (current.at - previous.at);
    }
  }
  if (pairs === 0) return null;
  const firstAt = sorted[0].at;
  return { usedPercent: used, partialSinceMs: firstAt > startMs ? firstAt : null };
}

/** Readings older than the longest period (plus slack to prorate across its start) are dropped. */
export const QUOTA_READING_RETENTION_MS = (WEEK_HOURS + 6) * HOUR_MS;

/** A repeated value this soon after the last reading adds nothing. */
const QUOTA_READING_MIN_GAP_MS = 60 * 1000;

/**
 * Append a reading to one window's history, dropping expired and redundant ones.
 * A run of equal readings keeps only its first and last, which keeps a week of
 * readings small without changing what quotaConsumedSince computes.
 */
export function appendQuotaReading(
  readings: readonly QuotaReading[],
  reading: QuotaReading
): QuotaReading[] {
  const cutoff = reading.at - QUOTA_READING_RETENTION_MS;
  const kept = readings.filter((item) => item.at >= cutoff && item.at < reading.at);
  const last = kept[kept.length - 1];
  if (last?.remaining !== reading.remaining) return [...kept, reading];
  if (reading.at - last.at < QUOTA_READING_MIN_GAP_MS) return kept;
  const beforeLast = kept[kept.length - 2];
  if (beforeLast?.remaining === reading.remaining) return [...kept.slice(0, -1), reading];
  return [...kept, reading];
}

/** "3%", "<1%" or "0%": consumption rounded for display. */
export function formatConsumedPercent(usedPercent: number): string {
  if (usedPercent <= 0) return '0%';
  if (usedPercent < 1) return '<1%';
  return `${Math.round(usedPercent)}%`;
}
