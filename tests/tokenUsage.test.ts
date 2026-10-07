import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { CredentialCacheUsage } from '@/components/usage/CredentialCacheUsage';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import {
  cacheReadShare,
  detectCacheWriteSpike,
  formatTokenCount,
  normalizeCredentialTokenUsage,
  type TokenUsageBucket,
} from '@/utils/tokenUsage';

const BUCKET_MS = 10 * 60 * 1000;
const start = Date.parse('2026-10-05T09:00:00Z');

const buckets = (writes: number[]): TokenUsageBucket[] =>
  writes.map((write, index) => ({
    time: start + index * BUCKET_MS,
    requests: write > 0 ? 2 : 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: write * 5,
    cacheWriteTokens: write,
  }));

const backendUsage = {
  requests: 42,
  uncached_input_tokens: 1800,
  output_tokens: 52000,
  cache_read_tokens: 3_100_000,
  cache_write_tokens: 140_000,
  since: '2026-10-05T08:00:00Z',
  last_seen: '2026-10-05T12:24:10Z',
  recent: [
    {
      time: '2026-10-05T12:20:00Z',
      requests: 3,
      uncached_input_tokens: 90,
      output_tokens: 4100,
      cache_read_tokens: 260_000,
      cache_write_tokens: 9_000,
    },
    {
      time: '2026-10-05T12:10:00Z',
      requests: 1,
      cache_write_tokens: '1200',
    },
  ],
};

describe('credential token usage', () => {
  test('normalizes the backend token_usage object', () => {
    const usage = normalizeCredentialTokenUsage(backendUsage);
    expect(usage).toBeDefined();
    expect(usage?.requests).toBe(42);
    expect(usage?.cacheReadTokens).toBe(3_100_000);
    expect(usage?.cacheWriteTokens).toBe(140_000);
    expect(usage?.since).toBe(Date.parse('2026-10-05T08:00:00Z'));
    // Buckets are sorted oldest first and string counts are accepted.
    expect(usage?.recent.map((bucket) => bucket.cacheWriteTokens)).toEqual([1200, 9000]);
  });

  test('treats missing or empty usage as absent', () => {
    expect(normalizeCredentialTokenUsage(undefined)).toBeUndefined();
    expect(normalizeCredentialTokenUsage({ requests: 0, recent: [] })).toBeUndefined();
    expect(normalizeCredentialTokenUsage('garbage')).toBeUndefined();
  });

  test('computes the share of input served from the cache', () => {
    const usage = normalizeCredentialTokenUsage(backendUsage)!;
    expect(cacheReadShare(usage)).toBeCloseTo(3_100_000 / (3_100_000 + 140_000 + 1800), 6);
    expect(
      cacheReadShare({ ...usage, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    ).toBeNull();
  });

  test('flags a recent burst of cache writes against the usual level', () => {
    const steady = Array.from({ length: 15 }, () => 30_000);
    const spike = detectCacheWriteSpike(buckets([...steady, 410_000, 25_000, 30_000]));
    expect(spike?.bucket.cacheWriteTokens).toBe(410_000);
    expect(spike?.ratio).toBeCloseTo(410_000 / 30_000, 6);

    // Steady traffic, small bursts, and old bursts are not spikes.
    expect(detectCacheWriteSpike(buckets([...steady, 30_000, 31_000, 29_000]))).toBeNull();
    expect(detectCacheWriteSpike(buckets([...steady, 90_000, 0, 0]))).toBeNull();
    expect(detectCacheWriteSpike(buckets([410_000, ...steady, 30_000, 30_000]))).toBeNull();
  });

  test('flags a large first write on a quiet account', () => {
    const quiet = Array.from({ length: 15 }, () => 0);
    const spike = detectCacheWriteSpike(buckets([...quiet, 0, 0, 380_000]));
    expect(spike?.bucket.cacheWriteTokens).toBe(380_000);
    expect(spike?.ratio).toBe(Number.POSITIVE_INFINITY);
  });

  test('formats token counts compactly', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(12_400)).toBe('12.4K');
    expect(formatTokenCount(48_300_000)).toBe('48.3M');
    expect(formatTokenCount(140_000)).toBe('140K');
    expect(formatTokenCount(1_200_000_000)).toBe('1.2B');
  });

  test('is normalized onto credential entries', () => {
    const response = normalizeAuthFilesResponse({
      files: [
        { name: 'claude-a.json', type: 'claude', auth_index: 'a', token_usage: backendUsage },
        { name: 'claude-b.json', type: 'claude', auth_index: 'b' },
      ],
    });
    const byName = Object.fromEntries(response.files.map((file) => [file.name, file]));
    expect(byName['claude-a.json'].tokenUsage?.cacheWriteTokens).toBe(140_000);
    expect(byName['claude-b.json'].tokenUsage).toBeUndefined();
  });
});

describe('CredentialCacheUsage rendering', () => {
  // The i18n fallback is zh-CN; pin English for these assertions and restore the
  // shared instance so other suites keep their language.
  let originalLanguage = '';
  beforeAll(async () => {
    originalLanguage = i18n.language;
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  test('shows reads, writes, the cached share and a spike note', async () => {
    const steady = Array.from({ length: 15 }, () => 30_000);
    const usage = {
      ...normalizeCredentialTokenUsage(backendUsage)!,
      recent: buckets([...steady, 410_000, 25_000, 30_000]),
    };
    const markup = renderToStaticMarkup(createElement(CredentialCacheUsage, { usage }));
    expect(markup).toContain('Prompt cache');
    expect(markup).toContain('3.1M');
    expect(markup).toContain('140K');
    expect(markup).toContain('96% cached');
    expect(markup).toContain('Cache-write spike');
    expect(markup).toContain('role="img"');
  });

  test('compact mode keeps the totals and drops the bars', async () => {
    const usage = normalizeCredentialTokenUsage(backendUsage)!;
    const markup = renderToStaticMarkup(
      createElement(CredentialCacheUsage, { usage, compact: true })
    );
    expect(markup).toContain('3.1M');
    expect(markup).not.toContain('role="img"');
  });
});
