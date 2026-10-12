import { describe, expect, test } from 'bun:test';
import {
  buildQuotaGuardPatch,
  isQuotaGuarded,
  parseQuotaGuard,
  quotaGuardFloor,
  readQuotaGuard,
  type QuotaGuardConfig,
} from '../src/features/authFiles/quotaGuard';

const config: QuotaGuardConfig = {
  enabled: true,
  steps: [
    { hours: 48, minRemaining: 50 },
    { hours: 24, minRemaining: 30 },
    { hours: 6, minRemaining: 15 },
    { hours: 0, minRemaining: 5 },
  ],
};

const HOUR = 3_600_000;

describe('quota guard floor', () => {
  test('spec example: 24h left and 30% remaining is guarded', () => {
    expect(quotaGuardFloor(config, 24 * HOUR)).toBe(30);
    expect(isQuotaGuarded(config, 30, 24 * HOUR)).toBe(true);
    expect(isQuotaGuarded(config, 31, 24 * HOUR)).toBe(false);
  });

  test('floor relaxes near reset', () => {
    expect(quotaGuardFloor(config, 72 * HOUR)).toBe(50);
    expect(quotaGuardFloor(config, 12 * HOUR)).toBe(15);
    expect(quotaGuardFloor(config, 1 * HOUR)).toBe(5);
    expect(isQuotaGuarded(config, 30, 1 * HOUR)).toBe(false);
  });

  test('unknown quota never guards', () => {
    expect(quotaGuardFloor(config, null)).toBeNull();
    expect(isQuotaGuarded(config, null, 24 * HOUR)).toBe(false);
    expect(isQuotaGuarded(null, 0, 24 * HOUR)).toBe(false);
  });
});

describe('quota guard parsing', () => {
  test('parses backend snake_case steps and sorts them', () => {
    const parsed = parseQuotaGuard({
      enabled: true,
      steps: [
        { hours: 0, min_remaining: 5 },
        { hours: 24, min_remaining: 30 },
      ],
    });
    expect(parsed?.steps.map((s) => s.hours)).toEqual([24, 0]);
  });

  test('rejects invalid values', () => {
    expect(parseQuotaGuard('nope')).toBeNull();
    expect(parseQuotaGuard({ enabled: true, steps: [] })).toBeNull();
    expect(
      parseQuotaGuard({ enabled: true, steps: [{ hours: 1, min_remaining: 101 }] })
    ).toBeNull();
  });

  test('read falls back to defaults when absent', () => {
    const draft = readQuotaGuard({});
    expect(draft.enabled).toBe(false);
    expect(draft.steps.length).toBeGreaterThan(0);
  });
});

describe('quota guard patch', () => {
  test('untouched draft produces no patch', () => {
    expect(buildQuotaGuardPatch({}, readQuotaGuard({}))).toEqual({});
  });

  test('disabling clears the guard even with invalid draft steps', () => {
    const original = { quota_guard: { enabled: true, steps: [{ hours: 24, min_remaining: 30 }] } };
    const draft = {
      enabled: false,
      touched: true,
      steps: [
        { hours: 1, minRemaining: 10 },
        { hours: 1, minRemaining: 20 },
      ],
    };
    expect(buildQuotaGuardPatch(original, draft)).toEqual({ quota_guard: null });
  });

  test('enabling writes serialized steps', () => {
    const draft = { ...readQuotaGuard({}), enabled: true, touched: true };
    expect(buildQuotaGuardPatch({}, draft)).toEqual({
      quota_guard: {
        enabled: true,
        steps: [
          { hours: 48, min_remaining: 50 },
          { hours: 24, min_remaining: 30 },
          { hours: 6, min_remaining: 15 },
          { hours: 0, min_remaining: 5 },
        ],
      },
    });
  });
});
