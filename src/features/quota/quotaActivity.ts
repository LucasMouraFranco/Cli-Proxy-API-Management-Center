/**
 * Last-hour activity per account, so the Quota page shows which account the proxy
 * is leaning on right now. Reuses the Usage page's ten-minute buckets.
 */

import type { AuthFileItem } from '@/types';
import { summarizeAccountUsage, type AccountUsage } from '@/features/usage/usageModel';

export interface AccountActivity {
  usage: AccountUsage;
  /** Share of the provider's requests in the last hour, 0-1; null when the provider was idle. */
  share: number | null;
  /** Most requests of its provider in the last hour (ties go to the first account). */
  busiest: boolean;
}

export interface ActivityAccount {
  /** Unique across providers, e.g. `claude:file.json`. */
  key: string;
  type: string;
  file: AuthFileItem;
}

export function buildLastHourActivity(
  accounts: readonly ActivityAccount[],
  nowMs: number
): Map<string, AccountActivity> {
  const usageByKey = new Map<string, AccountUsage>();
  const totals = new Map<string, number>();
  const busiestByType = new Map<string, { key: string; requests: number }>();

  accounts.forEach(({ key, type, file }) => {
    const usage = summarizeAccountUsage(
      { recentRequests: file.recentRequests, recentTokens: file.tokenUsage?.recent },
      '1h',
      nowMs
    );
    usageByKey.set(key, usage);
    totals.set(type, (totals.get(type) ?? 0) + usage.requests);
    const leader = busiestByType.get(type);
    if (usage.requests > 0 && (!leader || usage.requests > leader.requests)) {
      busiestByType.set(type, { key, requests: usage.requests });
    }
  });

  const result = new Map<string, AccountActivity>();
  accounts.forEach(({ key, type }) => {
    const usage = usageByKey.get(key);
    if (!usage) return;
    const total = totals.get(type) ?? 0;
    result.set(key, {
      usage,
      share: total > 0 ? usage.requests / total : null,
      busiest: busiestByType.get(type)?.key === key,
    });
  });
  return result;
}
