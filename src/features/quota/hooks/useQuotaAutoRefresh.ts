/**
 * Quietly reloads quotas while the Quota or Usage page is open, so the saved
 * readings have enough points for the burn forecast and the quota-used column.
 *
 * Each load calls the provider's usage endpoint once per account, and Claude's
 * rate-limits it, so the refresh is careful about what it asks for:
 * - an account loaded recently, by any tab or page of this browser, is skipped;
 * - an account that answered 429 is left alone for a while;
 * - nothing runs while the browser tab is hidden.
 */

import { useEffect, useRef } from 'react';
import { MINUTE_MS } from '@/utils/time/durations';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { lastQuotaReadingAt } from '@/features/usage/quotaReadings';
import type { QuotaFileEntry } from '../logic';
import type { LoadQuotaOptions, QuotaLoadFailure } from './useQuotaBatchLoader';

export const QUOTA_AUTO_REFRESH_MS = 10 * MINUTE_MS;
export const QUOTA_RATE_LIMIT_BACKOFF_MS = 30 * MINUTE_MS;
/** Timers drift, so a load a little under one interval ago still counts as recent. */
const RECENT_SLACK_MS = MINUTE_MS;

/** Accounts worth reloading now: not loaded within an interval and not backing off. */
export function pickAutoRefreshTargets(
  targets: readonly QuotaFileEntry[],
  nowMs: number,
  lastLoadedAt: (cacheKey: string) => number | null,
  backoffUntil: ReadonlyMap<string, number>
): QuotaFileEntry[] {
  return targets.filter((entry) => {
    const key = getQuotaCacheKey(entry.file);
    if ((backoffUntil.get(key) ?? 0) > nowMs) return false;
    const last = lastLoadedAt(key);
    return last === null || nowMs - last >= QUOTA_AUTO_REFRESH_MS - RECENT_SLACK_MS;
  });
}

export function useQuotaAutoRefresh(
  targets: QuotaFileEntry[],
  enabled: boolean,
  loadQuota: (targets: QuotaFileEntry[], options?: LoadQuotaOptions) => Promise<QuotaLoadFailure[]>
) {
  // Read at tick time, so a changing list doesn't restart the interval.
  const targetsRef = useRef(targets);
  const loadRef = useRef(loadQuota);
  useEffect(() => {
    targetsRef.current = targets;
    loadRef.current = loadQuota;
  }, [targets, loadQuota]);
  const backoffRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const nowMs = Date.now();
      const due = pickAutoRefreshTargets(
        targetsRef.current,
        nowMs,
        (key) => lastQuotaReadingAt(key, nowMs),
        backoffRef.current
      );
      const failures = await loadRef.current(due, { quiet: true });
      failures.forEach(({ cacheKey, status }) => {
        if (status === 429) backoffRef.current.set(cacheKey, nowMs + QUOTA_RATE_LIMIT_BACKOFF_MS);
      });
    }, QUOTA_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
