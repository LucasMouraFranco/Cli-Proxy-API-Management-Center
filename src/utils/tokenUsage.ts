/**
 * Per-credential token usage reported by the backend as `token_usage` on each
 * `/credentials` entry. Buckets never overlap: uncached input, cache reads and cache
 * writes add up to the input that was sent.
 */

export interface TokenUsageBucket {
  /** Bucket start, epoch milliseconds. */
  time: number;
  requests: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CredentialTokenUsage {
  requests: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Epoch milliseconds the counters started, or null when unknown. */
  since: number | null;
  lastSeen: number | null;
  /** Recent ten-minute buckets, oldest first. */
  recent: TokenUsageBucket[];
}

export interface CacheWriteSpike {
  bucket: TokenUsageBucket;
  /** How many times the typical bucket the spike is; Infinity when the baseline is zero. */
  ratio: number;
}

/** Recent cache-write buckets this many times the baseline are flagged as a spike. */
export const CACHE_WRITE_SPIKE_RATIO = 4;
/** Ignore spikes smaller than this; tiny conversations rebuild small caches all the time. */
export const CACHE_WRITE_SPIKE_MIN_TOKENS = 100_000;
/** Only the newest buckets (last 30 minutes) can raise a spike. */
const CACHE_WRITE_SPIKE_RECENT_BUCKETS = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readCount = (record: Record<string, unknown>, ...keys: string[]): number => {
  for (const key of keys) {
    const raw = record[key];
    const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
};

const readTime = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeBucket = (value: unknown): TokenUsageBucket | null => {
  if (!isRecord(value)) return null;
  const time = readTime(value.time);
  if (time === null) return null;
  return {
    time,
    requests: readCount(value, 'requests'),
    uncachedInputTokens: readCount(value, 'uncached_input_tokens', 'uncachedInputTokens'),
    outputTokens: readCount(value, 'output_tokens', 'outputTokens'),
    cacheReadTokens: readCount(value, 'cache_read_tokens', 'cacheReadTokens'),
    cacheWriteTokens: readCount(value, 'cache_write_tokens', 'cacheWriteTokens'),
  };
};

/** Normalizes the backend `token_usage` object; returns undefined when it is absent or empty. */
export const normalizeCredentialTokenUsage = (value: unknown): CredentialTokenUsage | undefined => {
  if (!isRecord(value)) return undefined;
  const recent = Array.isArray(value.recent)
    ? value.recent
        .map(normalizeBucket)
        .filter((bucket): bucket is TokenUsageBucket => bucket !== null)
        .sort((a, b) => a.time - b.time)
    : [];
  const usage: CredentialTokenUsage = {
    requests: readCount(value, 'requests'),
    uncachedInputTokens: readCount(value, 'uncached_input_tokens', 'uncachedInputTokens'),
    outputTokens: readCount(value, 'output_tokens', 'outputTokens'),
    cacheReadTokens: readCount(value, 'cache_read_tokens', 'cacheReadTokens'),
    cacheWriteTokens: readCount(value, 'cache_write_tokens', 'cacheWriteTokens'),
    since: readTime(value.since),
    lastSeen: readTime(value.last_seen ?? value.lastSeen),
    recent,
  };
  return usage.requests > 0 || recent.length > 0 ? usage : undefined;
};

/** Share of input tokens served from the prompt cache, or null without input. */
export const cacheReadShare = (usage: CredentialTokenUsage): number | null => {
  const input = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return input > 0 ? usage.cacheReadTokens / input : null;
};

/**
 * Flags a burst of cache writes in the newest buckets: at least
 * CACHE_WRITE_SPIKE_MIN_TOKENS and CACHE_WRITE_SPIKE_RATIO times the median of the
 * older active buckets. A burst usually means a conversation moved to this account
 * and its prompt cache had to be rebuilt.
 */
export const detectCacheWriteSpike = (recent: TokenUsageBucket[]): CacheWriteSpike | null => {
  if (recent.length === 0) return null;
  const split = Math.max(0, recent.length - CACHE_WRITE_SPIKE_RECENT_BUCKETS);
  const baseline = recent
    .slice(0, split)
    .filter((bucket) => bucket.requests > 0 || bucket.cacheWriteTokens > 0)
    .map((bucket) => bucket.cacheWriteTokens)
    .sort((a, b) => a - b);
  const median = baseline.length > 0 ? baseline[Math.floor(baseline.length / 2)] : 0;

  let spike: CacheWriteSpike | null = null;
  for (const bucket of recent.slice(split)) {
    if (bucket.cacheWriteTokens < CACHE_WRITE_SPIKE_MIN_TOKENS) continue;
    const ratio = median > 0 ? bucket.cacheWriteTokens / median : Number.POSITIVE_INFINITY;
    if (ratio < CACHE_WRITE_SPIKE_RATIO) continue;
    if (!spike || bucket.cacheWriteTokens > spike.bucket.cacheWriteTokens) {
      spike = { bucket, ratio };
    }
  }
  return spike;
};

/** Compact token count: 950, 12.4K, 3.1M, 1.2B. */
export const formatTokenCount = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const units: [number, string][] = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (value >= size) {
      const scaled = value / size;
      const digits = scaled >= 100 ? 0 : 1;
      return `${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return String(Math.round(value));
};
