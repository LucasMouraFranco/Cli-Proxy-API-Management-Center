import { describe, expect, test } from 'bun:test';
import {
  WEEK_MS,
  buildBurnForecast,
  burnAccountFromRow,
  burnValueAt,
  measureDrainRate,
  pooledHistory,
  projectBurn,
} from '../src/features/quota/burnForecast';
import type { BurnAccount } from '../src/features/quota/burnForecast';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

const account = (overrides: Partial<BurnAccount> = {}): BurnAccount => ({
  remaining: 100,
  resetAtMs: null,
  readings: [],
  ...overrides,
});

describe('measureDrainRate', () => {
  test('adds up drops per hour and ignores the rise of a reset', () => {
    const readings = [
      { at: NOW - 4 * HOUR, remaining: 30 },
      { at: NOW - 3 * HOUR, remaining: 10 },
      // Reset: the rise is not usage.
      { at: NOW - 2 * HOUR, remaining: 100 },
      { at: NOW, remaining: 80 },
    ];
    // 20 + 20 points over 4 observed hours.
    expect(measureDrainRate([account({ readings })], DAY, NOW)).toBeCloseTo(10);
  });

  test('counts only the part of a gap inside the lookback', () => {
    const readings = [
      { at: NOW - 30 * HOUR, remaining: 100 },
      { at: NOW - 12 * HOUR, remaining: 82 },
      { at: NOW, remaining: 70 },
    ];
    // Lookback starts 24h ago: 12 of the 18 hours of the first gap count (12 of its 18 points),
    // plus the 12 points of the second gap, over 24 hours.
    expect(measureDrainRate([account({ readings })], DAY, NOW)).toBeCloseTo(1);
  });

  test('adds accounts together, each measured over the time it was observed', () => {
    const a = account({
      readings: [
        { at: NOW - 10 * HOUR, remaining: 50 },
        { at: NOW, remaining: 30 },
      ],
    });
    const b = account({
      readings: [
        { at: NOW - HOUR, remaining: 90 },
        { at: NOW, remaining: 87 },
      ],
    });
    expect(measureDrainRate([a, b], DAY, NOW)).toBeCloseTo(2 + 3);
  });

  test('is unknown without two readings to compare', () => {
    expect(measureDrainRate([account({ readings: [{ at: NOW, remaining: 50 }] })], DAY, NOW)).toBe(
      null
    );
    expect(measureDrainRate([], DAY, NOW)).toBe(null);
  });
});

describe('projectBurn', () => {
  test('drains in a straight line and stops at zero', () => {
    const { points, emptyAtMs } = projectBurn([account({ remaining: 50 })], 10, NOW, DAY);
    expect(emptyAtMs).toBe(NOW + 5 * HOUR);
    expect(points).toEqual([
      { at: NOW, remaining: 50 },
      { at: NOW + 5 * HOUR, remaining: 0 },
      { at: NOW + DAY, remaining: 0 },
    ]);
  });

  test('an empty pool is empty now', () => {
    expect(projectBurn([account({ remaining: 0 })], 5, NOW, DAY).emptyAtMs).toBe(NOW);
  });

  test("moves an empty account's share onto the others, so its reset refills it fully", () => {
    const accounts = [
      account({ remaining: 10, resetAtMs: NOW + 2 * HOUR }),
      account({ remaining: 90 }),
    ];
    const { points, resets } = projectBurn(accounts, 20, NOW, 3 * HOUR);
    // 40 points over 2 hours: the first account gives its 10, the second the other 30.
    expect(resets[0]).toEqual({ at: NOW + 2 * HOUR, gain: 100 });
    expect(points).toContainEqual({ at: NOW + 2 * HOUR, remaining: 60 });
    expect(points).toContainEqual({ at: NOW + 2 * HOUR, remaining: 160 });
    expect(points[points.length - 1]).toEqual({ at: NOW + 3 * HOUR, remaining: 140 });
  });

  test('resets repeat every week', () => {
    const { resets } = projectBurn(
      [account({ remaining: 40, resetAtMs: NOW + DAY })],
      0,
      NOW,
      14 * DAY
    );
    expect(resets).toEqual([
      { at: NOW + DAY, gain: 60 },
      { at: NOW + DAY + WEEK_MS, gain: 0 },
    ]);
  });

  test('accounts resetting a few seconds apart count as one reset', () => {
    const { resets } = projectBurn(
      [
        account({ remaining: 0, resetAtMs: NOW + DAY + 4_000 }),
        account({ remaining: 0, resetAtMs: NOW + DAY + 9_000 }),
      ],
      0,
      NOW,
      2 * DAY
    );
    expect(resets).toEqual([{ at: NOW + DAY, gain: 200 }]);
  });

  test('a reset time already past means the account is full again', () => {
    const { points, resets } = projectBurn(
      [account({ remaining: 5, resetAtMs: NOW - HOUR })],
      0,
      NOW,
      7 * DAY
    );
    expect(points[0]).toEqual({ at: NOW, remaining: 100 });
    expect(resets[0]?.at).toBe(NOW - HOUR + WEEK_MS);
  });
});

describe('pooledHistory', () => {
  test('carries each account forward and backfills one recorded late', () => {
    const a = account({
      remaining: 60,
      readings: [
        { at: NOW - 3 * HOUR, remaining: 80 },
        { at: NOW - HOUR, remaining: 60 },
      ],
    });
    const b = account({ remaining: 40, readings: [{ at: NOW - 2 * HOUR, remaining: 40 }] });
    expect(pooledHistory([a, b], NOW - DAY, NOW)).toEqual([
      { at: NOW - 3 * HOUR, remaining: 120 },
      { at: NOW - 2 * HOUR, remaining: 120 },
      { at: NOW - HOUR, remaining: 100 },
      { at: NOW, remaining: 100 },
    ]);
  });
});

describe('buildBurnForecast', () => {
  const readings = [
    { at: NOW - 10 * HOUR, remaining: 80 },
    { at: NOW, remaining: 50 },
  ];

  test('pools only loaded accounts and measures the rate', () => {
    const forecast = buildBurnForecast({
      accounts: [account({ remaining: 50, readings }), account({ remaining: null })],
      nowMs: NOW,
      lookback: '24h',
      horizonDays: 7,
    });
    expect(forecast.remaining).toBe(50);
    expect(forecast.capacity).toBe(100);
    expect(forecast.ratePerHour).toBeCloseTo(3);
    expect(forecast.rateSource).toBe('measured');
  });

  test('a manual rate replaces the measured one', () => {
    const forecast = buildBurnForecast({
      accounts: [account({ remaining: 50, readings })],
      nowMs: NOW,
      lookback: '24h',
      horizonDays: 7,
      manualRatePerHour: 10,
    });
    expect(forecast.ratePerHour).toBe(10);
    expect(forecast.rateSource).toBe('manual');
    expect(forecast.emptyAtMs).toBe(NOW + 5 * HOUR);
  });

  test('without a rate it still projects resets', () => {
    const forecast = buildBurnForecast({
      accounts: [account({ remaining: 0, resetAtMs: NOW + DAY })],
      nowMs: NOW,
      lookback: '24h',
      horizonDays: 3,
    });
    expect(forecast.ratePerHour).toBe(null);
    expect(forecast.rateSource).toBe(null);
    expect(forecast.nextReset).toEqual({ at: NOW + DAY, gain: 100 });
  });
});

describe('burnValueAt', () => {
  const points = [
    { at: NOW, remaining: 100 },
    { at: NOW + 10 * HOUR, remaining: 50 },
    { at: NOW + 10 * HOUR, remaining: 150 },
    { at: NOW + 20 * HOUR, remaining: 100 },
  ];

  test('interpolates between points and takes the value after a reset jump', () => {
    expect(burnValueAt(points, NOW + 5 * HOUR)).toBe(75);
    expect(burnValueAt(points, NOW + 10 * HOUR)).toBe(150);
    expect(burnValueAt(points, NOW + 15 * HOUR)).toBe(125);
  });

  test('holds the end values outside the curve', () => {
    expect(burnValueAt(points, NOW - HOUR)).toBe(100);
    expect(burnValueAt(points, NOW + 30 * HOUR)).toBe(100);
    expect(burnValueAt([], NOW)).toBe(null);
  });
});

describe('burnAccountFromRow', () => {
  const metric = (id: string, remainingPercent: number | null) => ({
    id,
    label: id,
    remainingPercent,
    resetAtMs: NOW + DAY,
  });
  const readings = [{ at: NOW, remaining: 40 }];

  test("pools Claude's 7-day limit and Codex's weekly limit with their readings", () => {
    const claude = burnAccountFromRow(
      'claude',
      { primary: null, metrics: [metric('five-hour', 10), metric('seven-day', 40)], extra: [] },
      (windowId) => (windowId === 'seven-day' ? readings : [])
    );
    expect(claude).toEqual({ remaining: 40, resetAtMs: NOW + DAY, readings });

    const codex = burnAccountFromRow(
      'codex',
      { primary: null, metrics: [metric('weekly', 70)], extra: [] },
      () => []
    );
    expect(codex.remaining).toBe(70);
  });

  test('an unloaded account, a monthly Codex plan or another provider is unknown', () => {
    const unknown = { remaining: null, resetAtMs: null, readings: [] };
    expect(burnAccountFromRow('claude', null, () => readings)).toEqual(unknown);
    expect(
      burnAccountFromRow(
        'codex',
        { primary: null, metrics: [metric('monthly', 70)], extra: [] },
        () => []
      )
    ).toEqual(unknown);
    expect(
      burnAccountFromRow(
        'kimi',
        { primary: null, metrics: [metric('weekly', 70)], extra: [] },
        () => []
      )
    ).toEqual(unknown);
  });
});
