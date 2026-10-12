/**
 * Burn forecast: how fast a provider's pooled weekly quota is draining and
 * how long it will last.
 *
 * Every account's weekly window (Claude 7-day, Codex weekly) is added into one
 * pool, so six accounts make a 600% pool. The drain rate comes from quota
 * readings saved while the app was open, and the projection assumes the proxy
 * keeps that rate, spreading it over the accounts that still have quota, with
 * each account jumping back to 100% when its window resets.
 *
 * Pure functions; `nowMs` is always passed in.
 */

import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import type { QuotaProviderType } from './providers/types';
import type { QuotaRowModel } from './quotaOverview';

export const WEEK_MS = 7 * DAY_MS;

export const BURN_LOOKBACKS = ['24h', '3d', '7d'] as const;
export type BurnLookback = (typeof BURN_LOOKBACKS)[number];

export const BURN_LOOKBACK_MS: Record<BurnLookback, number> = {
  '24h': DAY_MS,
  '3d': 3 * DAY_MS,
  '7d': WEEK_MS,
};

export const BURN_HORIZON_DAYS = [3, 7, 14] as const;
export type BurnHorizonDays = (typeof BURN_HORIZON_DAYS)[number];

/** One saved reading of a weekly window: percent remaining at an instant. */
export interface BurnReading {
  at: number;
  remaining: number;
}

export interface BurnAccount {
  /** Percent remaining in the weekly window now, 0..100; null when not loaded. */
  remaining: number | null;
  /** When the current weekly window resets; null when none is pending. */
  resetAtMs: number | null;
  readings: readonly BurnReading[];
}

/** A point on the pooled curve. Two points at the same instant draw a reset jump. */
export interface BurnPoint {
  at: number;
  remaining: number;
}

export interface BurnReset {
  at: number;
  /** Percentage points the pool gains, e.g. 200 when two empty accounts reset. */
  gain: number;
}

export interface BurnForecast {
  /** Pooled percent remaining now. */
  remaining: number;
  /** 100 per account with a known quota. */
  capacity: number;
  /** Percent per hour the projection uses; null when it is unknown. */
  ratePerHour: number | null;
  rateSource: 'measured' | 'manual' | null;
  /** Pooled remaining from readings, oldest first, ending now. */
  history: BurnPoint[];
  /** Pooled remaining from now to the horizon. */
  projection: BurnPoint[];
  nextReset: BurnReset | null;
  /** When the pool is first empty within the horizon (now if it already is); null if never. */
  emptyAtMs: number | null;
}

interface LiveAccount {
  remaining: number;
  /** Next reset strictly after now, or null. */
  nextResetMs: number | null;
  readings: BurnReading[];
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/**
 * Accounts with a known quota, brought up to date with `nowMs`. A reset time
 * already in the past means the window reset since the quota loaded, so the
 * account is full again and its next reset is a whole number of weeks later.
 * Reset instants are rounded to the minute so accounts that reset together,
 * reported a few seconds apart, are treated as one reset.
 */
function liveAccounts(accounts: readonly BurnAccount[], nowMs: number): LiveAccount[] {
  return accounts.flatMap((account) => {
    if (account.remaining === null || !Number.isFinite(account.remaining)) return [];
    let remaining = clampPercent(account.remaining);
    let nextResetMs =
      account.resetAtMs !== null && Number.isFinite(account.resetAtMs)
        ? Math.round(account.resetAtMs / MINUTE_MS) * MINUTE_MS
        : null;
    if (nextResetMs !== null && nextResetMs <= nowMs) {
      remaining = 100;
      nextResetMs += Math.ceil((nowMs - nextResetMs + 1) / WEEK_MS) * WEEK_MS;
    }
    const readings = account.readings
      .filter((reading) => Number.isFinite(reading.at) && Number.isFinite(reading.remaining))
      .filter((reading) => reading.at <= nowMs)
      .sort((a, b) => a.at - b.at);
    return [{ remaining, nextResetMs, readings }];
  });
}

/**
 * One account's drain in percent per hour since `startMs`, or null with fewer
 * than two readings to compare.
 *
 * Adds up every drop between consecutive readings and ignores rises, which are
 * resets. A drop between a reading before `startMs` and one after it counts
 * only the share of the gap inside the lookback. Usage between a reset and the
 * next reading is lost, so the rate leans low after a reset.
 */
function accountRate(readings: readonly BurnReading[], startMs: number): number | null {
  let used = 0;
  let observedMs = 0;
  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1];
    const current = readings[index];
    if (current.at <= startMs) continue;
    const gapMs = current.at - previous.at;
    if (gapMs <= 0) continue;
    const insideMs = current.at - Math.max(previous.at, startMs);
    used += (Math.max(0, previous.remaining - current.remaining) * insideMs) / gapMs;
    observedMs += insideMs;
  }
  return observedMs > 0 ? (used / observedMs) * HOUR_MS : null;
}

/**
 * Pooled drain rate in percent per hour over the lookback, or null when no
 * account has readings to measure. Each account is measured over the time it
 * was actually observed, then the rates are added.
 */
export function measureDrainRate(
  accounts: readonly BurnAccount[],
  lookbackMs: number,
  nowMs: number
): number | null {
  const startMs = nowMs - lookbackMs;
  let total: number | null = null;
  liveAccounts(accounts, nowMs).forEach((account) => {
    const rate = accountRate(account.readings, startMs);
    if (rate !== null) total = (total ?? 0) + rate;
  });
  return total;
}

/**
 * Pooled remaining from `fromMs` to now. At every reading instant each account
 * counts at its latest reading so far, or its earliest reading when it has none
 * yet, so an account that started being recorded late doesn't look like a jump.
 */
export function pooledHistory(
  accounts: readonly BurnAccount[],
  fromMs: number,
  nowMs: number
): BurnPoint[] {
  const live = liveAccounts(accounts, nowMs);
  const withReadings = live.filter((account) => account.readings.length > 0);
  const instants = [
    ...new Set(
      withReadings.flatMap((account) =>
        account.readings.map((reading) => reading.at).filter((at) => at >= fromMs && at < nowMs)
      )
    ),
  ].sort((a, b) => a - b);

  const points = instants.map((at) => ({
    at,
    remaining: live.reduce((sum, account) => {
      if (account.readings.length === 0) return sum + account.remaining;
      let value = account.readings[0].remaining;
      for (const reading of account.readings) {
        if (reading.at > at) break;
        value = reading.remaining;
      }
      return sum + clampPercent(value);
    }, 0),
  }));
  points.push({ at: nowMs, remaining: live.reduce((sum, account) => sum + account.remaining, 0) });
  return points;
}

/**
 * Take `amount` percentage points out of the accounts that still have quota,
 * evenly, moving an empty account's share onto the others.
 */
function drainEvenly(accounts: LiveAccount[], amount: number) {
  let left = amount;
  while (left > 1e-9) {
    const active = accounts.filter((account) => account.remaining > 0);
    if (active.length === 0) return;
    const share = left / active.length;
    const step = Math.min(share, ...active.map((account) => account.remaining));
    active.forEach((account) => {
      account.remaining = Math.max(0, account.remaining - step);
    });
    left -= step * active.length;
  }
}

const poolOf = (accounts: readonly LiveAccount[]) =>
  accounts.reduce((sum, account) => sum + account.remaining, 0);

interface Projection {
  points: BurnPoint[];
  resets: BurnReset[];
  emptyAtMs: number | null;
}

/**
 * Pooled remaining from now until `nowMs + horizonMs` at a constant drain.
 *
 * The pool drains in a straight line while any account has quota, so points
 * are only needed where that line bends: resets (one point before, one after),
 * the moment the pool runs dry, and the end of the horizon.
 */
export function projectBurn(
  accounts: readonly BurnAccount[],
  ratePerHour: number,
  nowMs: number,
  horizonMs: number
): Projection {
  const live = liveAccounts(accounts, nowMs);
  const rate = Math.max(0, ratePerHour);
  const endMs = nowMs + Math.max(0, horizonMs);
  const points: BurnPoint[] = [{ at: nowMs, remaining: poolOf(live) }];
  const resets: BurnReset[] = [];
  let emptyAtMs: number | null = null;
  let clock = nowMs;

  while (clock < endMs) {
    const resetTimes = live
      .map((account) => account.nextResetMs)
      .filter((at): at is number => at !== null);
    const nextEvent = Math.min(endMs, ...resetTimes);

    const pool = poolOf(live);
    const demand = (rate * (nextEvent - clock)) / HOUR_MS;
    if (pool <= 0) {
      emptyAtMs ??= clock;
    } else if (demand >= pool) {
      const dryAt = clock + (pool / rate) * HOUR_MS;
      emptyAtMs ??= dryAt;
      if (dryAt < nextEvent) points.push({ at: dryAt, remaining: 0 });
    }
    drainEvenly(live, demand);
    clock = nextEvent;
    points.push({ at: clock, remaining: poolOf(live) });
    if (clock >= endMs) break;

    let gain = 0;
    live.forEach((account) => {
      if (account.nextResetMs !== clock) return;
      gain += 100 - account.remaining;
      account.remaining = 100;
      account.nextResetMs = clock + WEEK_MS;
    });
    resets.push({ at: clock, gain });
    points.push({ at: clock, remaining: poolOf(live) });
  }

  return { points, resets, emptyAtMs };
}

export interface BurnForecastInput {
  accounts: readonly BurnAccount[];
  nowMs: number;
  lookback: BurnLookback;
  horizonDays: BurnHorizonDays;
  /** Percent per hour typed by the user; replaces the measured rate when set. */
  manualRatePerHour?: number | null;
}

export function buildBurnForecast({
  accounts,
  nowMs,
  lookback,
  horizonDays,
  manualRatePerHour,
}: BurnForecastInput): BurnForecast {
  const live = liveAccounts(accounts, nowMs);
  const lookbackMs = BURN_LOOKBACK_MS[lookback];
  const manual =
    manualRatePerHour !== null &&
    manualRatePerHour !== undefined &&
    Number.isFinite(manualRatePerHour) &&
    manualRatePerHour >= 0
      ? manualRatePerHour
      : null;
  const measured = manual === null ? measureDrainRate(accounts, lookbackMs, nowMs) : null;
  const ratePerHour = manual ?? measured;
  // An unknown rate still projects the resets, as if nothing were being used.
  const projection = projectBurn(accounts, ratePerHour ?? 0, nowMs, horizonDays * DAY_MS);

  return {
    remaining: poolOf(live),
    capacity: live.length * 100,
    ratePerHour,
    rateSource: manual !== null ? 'manual' : measured !== null ? 'measured' : null,
    history: pooledHistory(accounts, nowMs - lookbackMs, nowMs),
    projection: projection.points,
    nextReset: projection.resets[0] ?? null,
    emptyAtMs: projection.emptyAtMs,
  };
}

/**
 * Pooled remaining at `atMs` along a curve, interpolating between points. At a
 * reset jump (two points at one instant) the value after the jump wins.
 */
export function burnValueAt(points: readonly BurnPoint[], atMs: number): number | null {
  if (points.length === 0) return null;
  let index = -1;
  while (index + 1 < points.length && points[index + 1].at <= atMs) index += 1;
  if (index < 0) return points[0].remaining;
  const point = points[index];
  const next = points[index + 1];
  if (!next) return point.remaining;
  const fraction = (atMs - point.at) / (next.at - point.at);
  return point.remaining + (next.remaining - point.remaining) * fraction;
}

/**
 * The weekly window each provider pools. Codex team plans report a monthly
 * window instead; those accounts stay out, since the projection resets weekly.
 */
export const BURN_WINDOW_IDS: Partial<Record<QuotaProviderType, string>> = {
  claude: 'seven-day',
  codex: 'weekly',
};

/** An account's weekly window, or an unknown quota when it isn't loaded or has none. */
export function burnAccountFromRow(
  type: QuotaProviderType,
  model: QuotaRowModel | null,
  readingsFor: (windowId: string) => readonly BurnReading[]
): BurnAccount {
  const windowId = BURN_WINDOW_IDS[type];
  const metric = windowId ? model?.metrics.find((item) => item.id === windowId) : undefined;
  if (!windowId || !metric || metric.remainingPercent === null) {
    return { remaining: null, resetAtMs: null, readings: [] };
  }
  return {
    remaining: metric.remainingPercent,
    resetAtMs: metric.resetAtMs,
    readings: readingsFor(windowId),
  };
}
