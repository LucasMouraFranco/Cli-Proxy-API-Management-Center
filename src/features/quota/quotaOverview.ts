/**
 * Quota overview model: turns each provider's quota state into the rows and
 * per-provider summary cards of the Quota Management page.
 * Pure functions over the quota store, so the rules stay testable.
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  XaiQuotaState,
} from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
} from './components/QuotaMeter';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export type QuotaTone = 'high' | 'medium' | 'low' | 'unknown';

/** One quota bar on an account row. Percentages are what is left, 0-100. */
export interface QuotaMetric {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetAtMs: number | null;
  /** Fetch-time absolute label, for providers whose instant is relative to the fetch. */
  resetLabel?: string;
  /** Shown with less emphasis (the overall 7-day bar next to the model bucket). */
  muted?: boolean;
}

export interface QuotaRowModel {
  /** The bucket the provider summary adds up: the weekly (model) limit. */
  primary: QuotaMetric | null;
  /** Bars shown on the row, in order. */
  metrics: QuotaMetric[];
  /** Buckets kept out of the way unless the user asks for them (Opus, Sonnet, code review). */
  extra: QuotaMetric[];
}

export interface ProviderSummary {
  type: QuotaProviderType;
  credentialCount: number;
  loadedCount: number;
  bucketLabel: string | null;
  /** Sum of the remaining primary bucket across loaded accounts; null when none is known. */
  totalRemaining: number | null;
  /** 100% per credential. */
  capacity: number;
  segments: { key: string; remainingPercent: number | null }[];
  /** Soonest future reset of the primary bucket. */
  nextResetAtMs: number | null;
  /** Claude only: the overall 7-day limit summed the same way. */
  secondary: { label: string; totalRemaining: number | null } | null;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export const remainingFromUsed = (used: number | null | undefined): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - used) : null;

export const toneForRemaining = (remaining: number | null): QuotaTone => {
  if (remaining === null) return 'unknown';
  if (remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
};

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

type LabeledWindow = {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetLabel: string;
  resetAtMs?: number | null;
};

const windowMetric = (t: TFunction, window: LabeledWindow, muted = false): QuotaMetric => ({
  id: window.id,
  label: window.labelKey ? String(t(window.labelKey, window.labelParams ?? {})) : window.label,
  remainingPercent: remainingFromUsed(window.usedPercent),
  resetAtMs: finiteOrNull(window.resetAtMs),
  resetLabel: window.resetLabel,
  ...(muted ? { muted: true } : {}),
});

const claudeRowModel = (t: TFunction, quota: ClaudeQuotaState): QuotaRowModel => {
  const windows = quota.windows ?? [];
  const byId = (id: string) => windows.find((window) => window.id === id);
  const fable = byId('seven-day-fable');
  const fiveHour = byId('five-hour');
  const sevenDay = byId('seven-day');
  const primaryWindow = fable ?? sevenDay;
  const metrics: QuotaMetric[] = [];
  if (primaryWindow) metrics.push(windowMetric(t, primaryWindow));
  if (fiveHour) metrics.push(windowMetric(t, fiveHour));
  if (fable && sevenDay) metrics.push(windowMetric(t, sevenDay, true));
  const shown = new Set([primaryWindow?.id, fiveHour?.id, sevenDay?.id]);
  return {
    primary: metrics[0] ?? null,
    metrics,
    extra: windows
      .filter((window) => !shown.has(window.id))
      .map((window) => windowMetric(t, window, true)),
  };
};

const codexRowModel = (t: TFunction, quota: CodexQuotaState): QuotaRowModel => {
  const windows = quota.windows ?? [];
  const primaryWindow =
    windows.find((window) => window.id === 'weekly') ??
    windows.find((window) => window.id === 'monthly') ??
    windows[0];
  const fiveHour = windows.find((window) => window.id === 'five-hour' && window !== primaryWindow);
  const metrics: QuotaMetric[] = [];
  if (primaryWindow) metrics.push(windowMetric(t, primaryWindow));
  if (fiveHour) metrics.push(windowMetric(t, fiveHour));
  const shown = new Set([primaryWindow?.id, fiveHour?.id]);
  return {
    primary: metrics[0] ?? null,
    metrics,
    extra: windows
      .filter((window) => !shown.has(window.id))
      .map((window) => windowMetric(t, window, true)),
  };
};

const kimiRowModel = (t: TFunction, quota: KimiQuotaState): QuotaRowModel => {
  const rows = quota.rows ?? [];
  const toMetric = (row: KimiQuotaState['rows'][number]): QuotaMetric => ({
    id: row.id,
    label: row.labelKey ? String(t(row.labelKey, row.labelParams ?? {})) : (row.label ?? row.id),
    remainingPercent:
      row.limit > 0 ? clampPercent(((row.limit - row.used) / row.limit) * 100) : null,
    resetAtMs: finiteOrNull(row.resetAtMs),
  });
  const weekly = rows.find((row) => row.id === 'summary') ?? rows[rows.length - 1];
  const metrics = weekly ? [toMetric(weekly)] : [];
  rows.filter((row) => row !== weekly).forEach((row) => metrics.push(toMetric(row)));
  return { primary: metrics[0] ?? null, metrics, extra: [] };
};

const xaiRowModel = (t: TFunction, quota: XaiQuotaState): QuotaRowModel => {
  const billing = quota.billing;
  if (!billing) return { primary: null, metrics: [], extra: [] };
  const weekly = billing.periodType !== 'monthly';
  const metric: QuotaMetric = {
    id: weekly ? 'weekly' : 'monthly',
    label: String(t(weekly ? 'quota_overview.weekly_limit' : 'quota_overview.monthly_limit')),
    remainingPercent: remainingFromUsed(billing.usedPercent ?? billing.usagePercent),
    resetAtMs: finiteOrNull(billing.resetAtMs),
  };
  return { primary: metric, metrics: [metric], extra: [] };
};

/**
 * Row model for providers with a compact rendering; null means the row falls back
 * to the provider's full quota body.
 */
export const buildQuotaRowModel = (
  t: TFunction,
  type: QuotaProviderType,
  quota: QuotaCardState | undefined
): QuotaRowModel | null => {
  if (!quota || quota.status !== 'success') return null;
  switch (type) {
    case 'claude':
      return claudeRowModel(t, quota as ClaudeQuotaState);
    case 'codex':
      return codexRowModel(t, quota as CodexQuotaState);
    case 'kimi':
      return kimiRowModel(t, quota as KimiQuotaState);
    case 'xai':
      return xaiRowModel(t, quota as XaiQuotaState);
    default:
      return null;
  }
};

/** Adds up the primary bucket of every account of one provider. */
export const buildProviderSummary = (
  t: TFunction,
  type: QuotaProviderType,
  accounts: { key: string; quota: QuotaCardState | undefined }[],
  nowMs: number
): ProviderSummary => {
  let total: number | null = null;
  let secondaryTotal: number | null = null;
  let secondaryLabel: string | null = null;
  let loaded = 0;
  let nextResetAtMs: number | null = null;
  const labelCounts = new Map<string, number>();
  const segments = accounts.map(({ key, quota }) => {
    if (quota?.status === 'success') loaded += 1;
    const model = buildQuotaRowModel(t, type, quota);
    const primary = model?.primary ?? null;
    if (primary) {
      labelCounts.set(primary.label, (labelCounts.get(primary.label) ?? 0) + 1);
      if (primary.remainingPercent !== null) total = (total ?? 0) + primary.remainingPercent;
      if (primary.resetAtMs !== null && primary.resetAtMs > nowMs) {
        nextResetAtMs =
          nextResetAtMs === null ? primary.resetAtMs : Math.min(nextResetAtMs, primary.resetAtMs);
      }
    }
    const overall =
      type === 'claude' ? model?.metrics.find((metric) => metric.id === 'seven-day') : undefined;
    if (overall && overall !== primary) {
      secondaryLabel = overall.label;
      if (overall.remainingPercent !== null)
        secondaryTotal = (secondaryTotal ?? 0) + overall.remainingPercent;
    }
    return { key, remainingPercent: primary?.remainingPercent ?? null };
  });
  const bucketLabel = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    type,
    credentialCount: accounts.length,
    loadedCount: loaded,
    bucketLabel,
    totalRemaining: total,
    capacity: accounts.length * 100,
    segments,
    nextResetAtMs,
    secondary: secondaryLabel ? { label: secondaryLabel, totalRemaining: secondaryTotal } : null,
  };
};

const EMAIL_PATTERN = /([A-Za-z0-9._%+]+)@([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)*)/g;
const MASK = '•••';

/** `tooling@lumen.dev` becomes `t•••@l•••.dev`. */
export const maskEmail = (email: string): string =>
  email.replace(
    EMAIL_PATTERN,
    (_match, local: string, firstLabel: string, rest: string) =>
      `${local.slice(0, 1)}${MASK}@${firstLabel.slice(0, 1)}${MASK}${rest}`
  );

/**
 * Masks the email inside a credential file name while keeping the provider and account
 * prefix (`claude-`, `codex-ae5d455f-`) and the suffix readable, for example
 * `codex-ae5d455f-tooling@lumen.dev-pro.json` becomes `codex-ae5d455f-t•••@l•••.dev-pro.json`.
 */
export const maskCredentialName = (name: string): string => {
  const at = name.indexOf('@');
  if (at < 0) return name;
  const head = name.slice(0, at);
  const localStart = head.lastIndexOf('-') + 1;
  return `${head.slice(0, localStart)}${maskEmail(name.slice(localStart))}`;
};

/** Identity used to match routing previews to credential entries. */
export const credentialMatchesPreviewAuth = (
  file: AuthFileItem,
  authId: string | null | undefined,
  authIndex?: string | null
): boolean => {
  if (authIndex) {
    const fileIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (fileIndex && fileIndex === normalizeAuthIndex(authIndex)) return true;
  }
  if (!authId) return false;
  const fileId = typeof file['id'] === 'string' ? (file['id'] as string) : '';
  return fileId === authId || file.name === authId;
};
