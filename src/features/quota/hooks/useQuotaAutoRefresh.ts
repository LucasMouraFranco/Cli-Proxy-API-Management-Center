/**
 * Quietly reloads the quotas the burn forecast pools while the Quota page is
 * open, so the saved readings have enough points to measure a drain rate.
 * Skipped while the browser tab is hidden: nobody is looking, and the next
 * visible tick catches up.
 */

import { useEffect, useRef } from 'react';
import { MINUTE_MS } from '@/utils/time/durations';
import type { QuotaFileEntry } from '../logic';
import type { LoadQuotaOptions } from './useQuotaBatchLoader';

export const QUOTA_AUTO_REFRESH_MS = 10 * MINUTE_MS;

export function useQuotaAutoRefresh(
  targets: QuotaFileEntry[],
  enabled: boolean,
  loadQuota: (targets: QuotaFileEntry[], options?: LoadQuotaOptions) => Promise<void>
) {
  // Read at tick time, so a changing list doesn't restart the interval.
  const targetsRef = useRef(targets);
  const loadRef = useRef(loadQuota);
  useEffect(() => {
    targetsRef.current = targets;
    loadRef.current = loadQuota;
  }, [targets, loadQuota]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadRef.current(targetsRef.current, { quiet: true });
    }, QUOTA_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
