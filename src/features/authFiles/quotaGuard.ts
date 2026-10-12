/**
 * Shared-account quota guard: per-account steps that keep a minimum
 * remaining percent based on how long is left until the weekly reset.
 * Mirrors the backend contract in CLIProxyAPI sdk/cliproxy/auth/quota_guard.go.
 * Pure and React-free so tests cover it directly.
 */

export interface QuotaGuardStep {
  hours: number;
  minRemaining: number;
}

export interface QuotaGuardConfig {
  enabled: boolean;
  steps: QuotaGuardStep[];
}

export interface QuotaGuardDraft {
  enabled: boolean;
  steps: QuotaGuardStep[];
  touched: boolean;
}

export const DEFAULT_QUOTA_GUARD_STEPS: QuotaGuardStep[] = [
  { hours: 48, minRemaining: 50 },
  { hours: 24, minRemaining: 30 },
  { hours: 6, minRemaining: 15 },
  { hours: 0, minRemaining: 5 },
];

export type QuotaGuardError = 'auth_files.quota_guard_invalid';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readRaw = (json: Record<string, unknown>): unknown =>
  Object.prototype.hasOwnProperty.call(json, 'quota_guard')
    ? json['quota_guard']
    : json['quota-guard'];

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Parse stored JSON into a config. Null means absent or invalid (fail open). */
export function parseQuotaGuard(value: unknown): QuotaGuardConfig | null {
  if (!isRecord(value)) return null;
  const enabled = value.enabled === undefined ? true : value.enabled;
  if (typeof enabled !== 'boolean') return null;
  if (!Array.isArray(value.steps)) return enabled ? null : { enabled: false, steps: [] };
  if (enabled && value.steps.length === 0) return null;
  if (value.steps.length > 8) return null;
  const steps: QuotaGuardStep[] = [];
  const seen = new Set<number>();
  for (const item of value.steps) {
    if (!isRecord(item)) return null;
    const hours = finiteNumber(item.hours);
    const minRemaining = finiteNumber(item.min_remaining ?? item.minRemaining);
    if (hours === null || minRemaining === null) return null;
    if (hours < 0 || hours > 24 * 366 || minRemaining < 0 || minRemaining > 100) return null;
    if (seen.has(hours)) return null;
    seen.add(hours);
    steps.push({ hours, minRemaining });
  }
  steps.sort((a, b) => b.hours - a.hours);
  return { enabled, steps };
}

export function readQuotaGuard(json: Record<string, unknown>): QuotaGuardDraft {
  const parsed = parseQuotaGuard(readRaw(json));
  if (!parsed) return { enabled: false, steps: [...DEFAULT_QUOTA_GUARD_STEPS], touched: false };
  return {
    enabled: parsed.enabled,
    steps: parsed.steps.length ? parsed.steps : [...DEFAULT_QUOTA_GUARD_STEPS],
    touched: false,
  };
}

export function quotaGuardError(draft?: QuotaGuardDraft): QuotaGuardError | null {
  if (!draft?.touched || !draft.enabled) return null;
  if (draft.steps.length === 0 || draft.steps.length > 8) return 'auth_files.quota_guard_invalid';
  const seen = new Set<number>();
  for (const step of draft.steps) {
    if (!Number.isFinite(step.hours) || !Number.isFinite(step.minRemaining)) {
      return 'auth_files.quota_guard_invalid';
    }
    if (step.hours < 0 || step.hours > 24 * 366 || step.minRemaining < 0 || step.minRemaining > 100) {
      return 'auth_files.quota_guard_invalid';
    }
    if (seen.has(step.hours)) return 'auth_files.quota_guard_invalid';
    seen.add(step.hours);
  }
  return null;
}

export function serializeQuotaGuard(config: QuotaGuardConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    steps: [...config.steps]
      .sort((a, b) => b.hours - a.hours)
      .map((step) => ({ hours: step.hours, min_remaining: step.minRemaining })),
  };
}

/** Floor percent for a time to reset in milliseconds. Null when unguarded. */
export function quotaGuardFloor(
  config: QuotaGuardConfig | null,
  timeToResetMs: number | null
): number | null {
  if (!config?.enabled || config.steps.length === 0) return null;
  if (timeToResetMs === null || !Number.isFinite(timeToResetMs) || timeToResetMs <= 0) return null;
  const hoursLeft = timeToResetMs / 3_600_000;
  const sorted = [...config.steps].sort((a, b) => b.hours - a.hours);
  for (const step of sorted) {
    if (hoursLeft >= step.hours) return step.minRemaining;
  }
  return sorted[sorted.length - 1].minRemaining;
}

export function isQuotaGuarded(
  config: QuotaGuardConfig | null,
  remainingPercent: number | null,
  timeToResetMs: number | null
): boolean {
  const floor = quotaGuardFloor(config, timeToResetMs);
  if (floor === null || remainingPercent === null || !Number.isFinite(remainingPercent)) {
    return false;
  }
  return remainingPercent <= floor;
}

export function buildQuotaGuardPatch(
  original: Record<string, unknown>,
  draft?: QuotaGuardDraft
): { quota_guard?: Record<string, unknown> | null } {
  if (!draft?.touched) return {};
  if (quotaGuardError(draft)) throw new Error('auth_files.quota_guard_invalid');
  const initialRaw = readRaw(original);
  const initial = parseQuotaGuard(initialRaw);
  // Disabling clears the guard entirely, so leftover invalid step edits in
  // the draft can never make a disable impossible to save.
  if (!draft.enabled) return initialRaw === undefined ? {} : { quota_guard: null };
  const next: QuotaGuardConfig = { enabled: true, steps: draft.steps };
  const serialized = serializeQuotaGuard(next);
  const initialSerialized = initial ? serializeQuotaGuard(initial) : null;
  if (JSON.stringify(serialized) === JSON.stringify(initialSerialized)) return {};
  return { quota_guard: serialized };
}
