import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState, XaiQuotaState } from '@/types';
import { normalizeRoutingPreviews } from '@/services/api/routing';
import { QuotaSummaryCards } from '@/features/quota/components/QuotaSummaryCards';
import {
  buildProviderSummary,
  buildQuotaRowModel,
  credentialMatchesPreviewAuth,
  maskCredentialName,
  maskEmail,
  remainingFromUsed,
  toneForRemaining,
} from '@/features/quota/quotaOverview';

const now = Date.parse('2026-10-05T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const t = i18n.t.bind(i18n);

let previousLanguage = 'en';
beforeAll(async () => {
  previousLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

const claudeWindow = (
  id: string,
  labelKey: string,
  usedPercent: number | null,
  resetAtMs: number | null
) => ({ id, label: id, labelKey, usedPercent, resetLabel: '', resetAtMs });

const claudeQuota = (fableUsed: number | null, sevenDayUsed: number, resetInHours: number) =>
  ({
    status: 'success',
    planType: 'plan_max',
    windows: [
      claudeWindow('five-hour', 'claude_quota.five_hour', 0, null),
      claudeWindow('seven-day', 'claude_quota.seven_day', sevenDayUsed, now + resetInHours * HOUR),
      claudeWindow('seven-day-opus', 'claude_quota.seven_day_opus', 12, now + 30 * HOUR),
      ...(fableUsed === null
        ? []
        : [
            claudeWindow(
              'seven-day-fable',
              'claude_quota.seven_day_fable',
              fableUsed,
              now + resetInHours * HOUR
            ),
          ]),
    ],
  }) satisfies ClaudeQuotaState;

const codexQuota = (weeklyUsed: number, resetInHours: number): CodexQuotaState => ({
  status: 'success',
  planType: 'pro',
  windows: [
    {
      id: 'weekly',
      label: 'weekly',
      labelKey: 'codex_quota.secondary_window',
      usedPercent: weeklyUsed,
      resetLabel: '',
      resetAtMs: now + resetInHours * HOUR,
    },
  ],
  rateLimitResetCreditsAvailableCount: 2,
  rateLimitResetCredits: [],
});

describe('quota overview row model', () => {
  test('Claude rows lead with the 7-day Fable bucket and keep Opus out of the way', () => {
    const model = buildQuotaRowModel(t, 'claude', claudeQuota(42, 21, 30));
    expect(model?.primary?.id).toBe('seven-day-fable');
    expect(model?.primary?.remainingPercent).toBe(58);
    expect(model?.metrics.map((metric) => metric.id)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
    expect(model?.metrics[2]?.muted).toBe(true);
    expect(model?.extra.map((metric) => metric.id)).toEqual(['seven-day-opus']);
  });

  test('Claude rows fall back to the overall 7-day bucket when Fable is unknown', () => {
    const model = buildQuotaRowModel(t, 'claude', claudeQuota(null, 25, 30));
    expect(model?.primary?.id).toBe('seven-day');
    expect(model?.primary?.muted).toBeUndefined();
    expect(model?.metrics.map((metric) => metric.id)).toEqual(['seven-day', 'five-hour']);
  });

  test('rows without a successful quota have no model', () => {
    expect(buildQuotaRowModel(t, 'claude', undefined)).toBeNull();
    expect(
      buildQuotaRowModel(t, 'claude', { status: 'loading', windows: [] } as ClaudeQuotaState)
    ).toBeNull();
  });

  test('xAI rows read the billing period and unknown usage stays unknown', () => {
    const quota: XaiQuotaState = {
      status: 'success',
      billing: { periodType: 'weekly', usedPercent: null, resetAtMs: now + 5 * 24 * HOUR },
    } as XaiQuotaState;
    const model = buildQuotaRowModel(t, 'xai', quota);
    expect(model?.primary?.label).toBe('Weekly limit');
    expect(model?.primary?.remainingPercent).toBeNull();
  });

  test('remaining percentages are clamped and toned', () => {
    expect(remainingFromUsed(120)).toBe(0);
    expect(remainingFromUsed(-5)).toBe(100);
    expect(remainingFromUsed(null)).toBeNull();
    expect(toneForRemaining(83)).toBe('high');
    expect(toneForRemaining(51)).toBe('medium');
    expect(toneForRemaining(17)).toBe('low');
    expect(toneForRemaining(null)).toBe('unknown');
  });
});

describe('provider summary', () => {
  test('adds up the Claude model bucket across accounts, like "409% of 500%"', () => {
    const accounts = [
      { key: 'a', quota: claudeQuota(0, 0, 120) },
      { key: 'b', quota: claudeQuota(49, 25, 21) },
      { key: 'c', quota: claudeQuota(0, 0, 96) },
      { key: 'd', quota: claudeQuota(0, 0, 100) },
      { key: 'e', quota: claudeQuota(42, 21, 30) },
    ];
    const summary = buildProviderSummary(t, 'claude', accounts, now);
    expect(summary.totalRemaining).toBe(409);
    expect(summary.capacity).toBe(500);
    expect(summary.loadedCount).toBe(5);
    expect(summary.bucketLabel).toBe(t('claude_quota.seven_day_fable'));
    expect(summary.nextResetAtMs).toBe(now + 21 * HOUR);
    expect(summary.segments.map((segment) => segment.remainingPercent)).toEqual([
      100, 51, 100, 100, 58,
    ]);
    expect(summary.secondary?.totalRemaining).toBe(454);
  });

  test('adds up Codex weekly limits, like "17% of 300%"', () => {
    const summary = buildProviderSummary(
      t,
      'codex',
      [
        { key: 'a', quota: codexQuota(83, 27) },
        { key: 'b', quota: codexQuota(100, 49) },
        { key: 'c', quota: codexQuota(100, 27) },
      ],
      now
    );
    expect(summary.totalRemaining).toBe(17);
    expect(summary.capacity).toBe(300);
    expect(summary.secondary).toBeNull();
  });

  test('accounts that have not loaded keep the total unknown and skip past resets', () => {
    const summary = buildProviderSummary(
      t,
      'codex',
      [
        { key: 'a', quota: undefined },
        { key: 'b', quota: codexQuota(10, -1) },
      ],
      now
    );
    expect(summary.loadedCount).toBe(1);
    expect(summary.totalRemaining).toBe(90);
    expect(summary.nextResetAtMs).toBeNull();
    expect(
      buildProviderSummary(t, 'codex', [{ key: 'a', quota: undefined }], now).totalRemaining
    ).toBeNull();
  });
});

describe('email masking', () => {
  test('masks the local part and the first domain label', () => {
    expect(maskEmail('tooling@lumen.dev')).toBe('t•••@l•••.dev');
    expect(maskEmail('no email here')).toBe('no email here');
  });

  test('keeps the provider and account prefix of credential names readable', () => {
    expect(maskCredentialName('claude-tasks@tide.gg.json')).toBe('claude-t•••@t•••.gg.json');
    expect(maskCredentialName('codex-ae5d455f-tooling@lumen.dev-pro.json')).toBe(
      'codex-ae5d455f-t•••@l•••.dev-pro.json'
    );
    expect(maskCredentialName('vertex-project.json')).toBe('vertex-project.json');
  });
});

describe('routing preview', () => {
  test('normalizes previews and matches them to credentials', () => {
    const previews = normalizeRoutingPreviews({
      previews: [
        {
          strategy: 'soonest-reset',
          provider: 'Claude',
          session_affinity: true,
          auth_id: 'claude-tasks@tide.gg.json',
          candidates: [
            {
              auth_id: 'claude-tasks@tide.gg.json',
              auth_index: '3',
              usable: true,
              weekly: { used_percent: 49, reset_at: '2026-10-06T09:00:00Z' },
            },
            {
              auth_id: 'claude-main@grove.com.json',
              usable: false,
              skip_reason: 'five_hour_limit',
            },
            { usable: true },
          ],
        },
        { provider: '' },
        'junk',
      ],
    });
    expect(previews).toHaveLength(1);
    const [preview] = previews;
    expect(preview.provider).toBe('claude');
    expect(preview.sessionAffinity).toBe(true);
    expect(preview.candidates).toHaveLength(2);
    expect(preview.candidates[0].weekly).toEqual({
      usedPercent: 49,
      resetAtMs: Date.parse('2026-10-06T09:00:00Z'),
    });
    expect(preview.candidates[1].skipReason).toBe('five_hour_limit');
    expect(normalizeRoutingPreviews(null)).toEqual([]);

    const file = {
      name: 'claude-tasks@tide.gg.json',
      type: 'claude',
      auth_index: '3',
    } as AuthFileItem;
    expect(credentialMatchesPreviewAuth(file, preview.authId)).toBe(true);
    expect(credentialMatchesPreviewAuth(file, 'other', '3')).toBe(true);
    expect(credentialMatchesPreviewAuth(file, 'other', '4')).toBe(false);
    expect(credentialMatchesPreviewAuth(file, null)).toBe(false);
  });
});

describe('quota overview rendering', () => {
  test('summary card shows the total, capacity, reset and next pick', () => {
    const summary = buildProviderSummary(
      t,
      'codex',
      [
        { key: 'a', quota: codexQuota(83, 27) },
        { key: 'b', quota: codexQuota(100, 49) },
        { key: 'c', quota: codexQuota(100, 27) },
      ],
      now
    );
    const html = renderToStaticMarkup(
      createElement(QuotaSummaryCards, {
        summaries: [summary],
        resolvedTheme: 'dark',
        nowMs: now,
        nextPickName: () => 'codex-ae5d455f-t•••@l•••.dev-pro.json',
        nextPickStrategy: () => 'soonest-reset',
        showExtraBuckets: false,
        onToggleExtraBuckets: () => {},
      })
    );
    expect(html).toContain('17%');
    expect(html).toContain('300%');
    expect(html).toContain('3 credentials');
    expect(html).toContain('codex-ae5d455f-t•••@l•••.dev-pro.json');
    expect(html).not.toContain('tooling@lumen.dev');
  });

  test('account rows show the private name, the next-pick badge and keep the Codex reset', async () => {
    // The row binds the QuotaBody class contract at load, which bun's stubbed
    // stylesheets cannot satisfy, so its wiring is checked in source.
    const source = await Bun.file('src/features/quota/components/QuotaAccountRow.tsx').text();
    expect(source).toContain('<PrivateText text={label.name}');
    expect(source).toContain('<PrivateText text={label.detail}');
    expect(source).toContain("t('quota_overview.next_pick')");
    expect(source).toContain('adapter.canResetQuota?.(quota)');
    expect(source).toContain("t('codex_quota.reset_button')");
    expect(source).toContain('<CredentialCacheUsage usage={file.tokenUsage} compact />');
    expect(source).toContain('...(showExtraBuckets ? model.extra : [])');
  });
});
