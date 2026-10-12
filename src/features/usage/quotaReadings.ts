/**
 * Quota readings saved in the browser so the Usage page can tell how much of a
 * limit was used during a period. The backend only reports quota as it is now,
 * so history exists only for the times this app loaded quotas.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotaStore } from '@/stores';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { buildQuotaRowModel } from '@/features/quota/quotaOverview';
import { appendQuotaReading, QUOTA_READING_RETENTION_MS, type QuotaReading } from './usageModel';

/** Account cache key → quota window id → readings, oldest first. */
export type QuotaReadingLog = Record<string, Record<string, QuotaReading[]>>;

const STORAGE_KEY = 'usagePage.quotaReadings.v1';

const isReading = (value: unknown): value is QuotaReading =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as QuotaReading).at) &&
  Number.isFinite((value as QuotaReading).remaining);

export function parseQuotaReadingLog(raw: string | null, nowMs: number): QuotaReadingLog {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const cutoff = nowMs - QUOTA_READING_RETENTION_MS;
  const log: QuotaReadingLog = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([account, windows]) => {
    if (typeof windows !== 'object' || windows === null || Array.isArray(windows)) return;
    Object.entries(windows as Record<string, unknown>).forEach(([windowId, readings]) => {
      if (!Array.isArray(readings)) return;
      const kept = readings.filter(isReading).filter((reading) => reading.at >= cutoff);
      if (kept.length === 0) return;
      log[account] = { ...log[account], [windowId]: kept };
    });
  });
  return log;
}

const readLog = (nowMs: number): QuotaReadingLog => {
  if (typeof window === 'undefined') return {};
  try {
    return parseQuotaReadingLog(window.localStorage.getItem(STORAGE_KEY), nowMs);
  } catch {
    return {};
  }
};

const writeLog = (log: QuotaReadingLog) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or blocked: consumption shows as unknown, nothing else breaks.
  }
};

/**
 * When this browser last saved a reading for the account, in any tab, or null.
 * Read from storage rather than React state so other open tabs count too.
 */
export function lastQuotaReadingAt(accountKey: string, nowMs: number): number | null {
  const windows = readLog(nowMs)[accountKey];
  if (!windows) return null;
  let latest: number | null = null;
  Object.values(windows).forEach((readings) => {
    const at = readings[readings.length - 1]?.at;
    if (at !== undefined && (latest === null || at > latest)) latest = at;
  });
  return latest;
}

/** Quota states already saved; a new fetch always produces a new state object. */
const recordedStates = new WeakSet<object>();

/**
 * Save a reading for every quota window each time a quota finishes loading, and
 * return the saved history. Used on both the Usage and Quota pages so any quota
 * refresh adds to the history.
 */
export function useQuotaReadings(entries: readonly QuotaFileEntry[]): QuotaReadingLog {
  const { t } = useTranslation();
  const claude = useQuotaStore((state) => state.claudeQuota);
  const codex = useQuotaStore((state) => state.codexQuota);
  const kimi = useQuotaStore((state) => state.kimiQuota);
  const xai = useQuotaStore((state) => state.xaiQuota);
  const [log, setLog] = useState<QuotaReadingLog>(() => readLog(Date.now()));

  useEffect(() => {
    const quotaMaps = { claude, codex, kimi, xai } as unknown as Partial<
      Record<QuotaFileEntry['type'], Record<string, QuotaCardState>>
    >;
    const nowMs = Date.now();
    let next: QuotaReadingLog | null = null;
    entries.forEach(({ file, type }) => {
      const key = getQuotaCacheKey(file);
      const state = quotaMaps[type]?.[key];
      if (!state || state.status !== 'success' || recordedStates.has(state)) return;
      recordedStates.add(state);
      const model = buildQuotaRowModel(t, type, state);
      if (!model) return;
      next ??= readLog(nowMs);
      model.metrics.forEach((metric) => {
        if (metric.remainingPercent === null || !next) return;
        const windows = next[key] ?? {};
        next[key] = {
          ...windows,
          [metric.id]: appendQuotaReading(windows[metric.id] ?? [], {
            at: nowMs,
            remaining: metric.remainingPercent,
          }),
        };
      });
    });
    if (next) {
      writeLog(next);
      setLog(next);
    }
  }, [entries, claude, codex, kimi, xai, t]);

  return log;
}

/** Providers whose quota has per-window percentages this page can track. */
export const TRACKED_QUOTA_TYPES: ReadonlySet<QuotaFileEntry['type']> = new Set([
  'claude',
  'codex',
  'kimi',
  'xai',
]);
