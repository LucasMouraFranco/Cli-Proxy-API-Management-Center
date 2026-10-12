/**
 * Burn forecast panel: the provider's pooled weekly quota, how fast it is
 * draining, and where it is headed as accounts run down and reset.
 *
 * All maths lives in burnForecast.ts; this file is layout and settings. The
 * plot is an SVG stretched to the box for the lines, with HTML for every label
 * so text never scales with the width.
 */

import { useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import { getTypeLabel } from '@/features/authFiles/constants';
import {
  BURN_HORIZON_DAYS,
  BURN_LOOKBACKS,
  buildBurnForecast,
  burnValueAt,
  type BurnAccount,
  type BurnHorizonDays,
  type BurnLookback,
  type BurnPoint,
} from '../burnForecast';
import { startOfDay, DAY_MS } from '../quotaTimelineModel';
import type { QuotaProviderType } from '../providers/types';
import { readQuotaUiState, writeQuotaUiState, type QuotaBurnUiState } from '../uiState';
import styles from './QuotaBurnPanel.module.scss';

export interface QuotaBurnPanelProps {
  type: QuotaProviderType;
  accounts: readonly BurnAccount[];
  nowMs: number;
  /** Sets the provider identity color as `--brand`. */
  style?: CSSProperties;
}

/** The SVG draws in a 1000 x 1000 box stretched over the plot. */
const BOX = 1000;
const Y_TICKS = [1, 0.75, 0.5, 0.25, 0];

const formatPercent = (value: number) => `${Math.round(value)}%`;
const formatRate = (value: number) => (value >= 10 ? value.toFixed(0) : value.toFixed(1));

/** Local midnights inside the span, thinned so at most about six are labelled. */
function dayTicks(startMs: number, endMs: number): number[] {
  const spanDays = (endMs - startMs) / DAY_MS;
  const step = spanDays <= 5 ? 1 : spanDays <= 10 ? 2 : 4;
  const ticks: number[] = [];
  const day = new Date(startOfDay(startMs));
  if (day.getTime() < startMs) day.setDate(day.getDate() + 1);
  for (let index = 0; day.getTime() <= endMs; index += 1) {
    if (index % step === 0) ticks.push(day.getTime());
    day.setDate(day.getDate() + 1);
  }
  return ticks;
}

export function QuotaBurnPanel({ type, accounts, nowMs, style }: QuotaBurnPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const gradientId = useId();
  const plotRef = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<QuotaBurnUiState>(() => readQuotaUiState()?.burn ?? {});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rateDraft, setRateDraft] = useState(() =>
    settings.manualRate === undefined ? '' : String(settings.manualRate)
  );
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const collapsed = settings.collapsed === true;
  const horizonDays: BurnHorizonDays = settings.horizonDays ?? 7;
  const lookback: BurnLookback = settings.lookback ?? '24h';

  const updateSettings = (patch: QuotaBurnUiState) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeQuotaUiState({ burn: next });
  };

  const forecast = useMemo(
    () =>
      buildBurnForecast({
        accounts,
        nowMs,
        lookback,
        horizonDays,
        manualRatePerHour: settings.manualRate ?? null,
      }),
    [accounts, nowMs, lookback, horizonDays, settings.manualRate]
  );
  // Measured separately so the settings can show it while a manual rate is in use.
  const measuredRate = useMemo(
    () =>
      settings.manualRate === undefined
        ? forecast.ratePerHour
        : buildBurnForecast({ accounts, nowMs, lookback, horizonDays }).ratePerHour,
    [accounts, nowMs, lookback, horizonDays, settings.manualRate, forecast.ratePerHour]
  );

  if (forecast.capacity === 0) return null;

  const { capacity, history, projection } = forecast;
  const startMs = Math.min(history[0]?.at ?? nowMs, nowMs);
  const endMs = nowMs + horizonDays * DAY_MS;
  const spanMs = Math.max(1, endMs - startMs);
  const xOf = (ms: number) => ((ms - startMs) / spanMs) * BOX;
  const yOf = (value: number) => (1 - value / capacity) * BOX;
  const leftPercent = (ms: number) => (xOf(ms) / BOX) * 100;

  const linePath = (points: readonly BurnPoint[]) =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(point.at)} ${yOf(point.remaining)}`)
      .join(' ');
  const areaPath = (points: readonly BurnPoint[]) =>
    points.length < 2
      ? ''
      : `${linePath(points)} L${xOf(points[points.length - 1].at)} ${BOX} L${xOf(points[0].at)} ${BOX} Z`;

  const typeLabel = getTypeLabel(t, type);
  const horizonLabel = t(`quota_burn.horizon_${horizonDays}`);
  const rateText =
    forecast.ratePerHour === null
      ? t('quota_burn.rate_unknown')
      : forecast.rateSource === 'manual'
        ? t('quota_burn.rate_manual', { rate: formatRate(forecast.ratePerHour) })
        : t('quota_burn.rate', { rate: formatRate(forecast.ratePerHour) });
  const nextReset = forecast.nextReset;
  const whenText = (ms: number) =>
    `${formatRelativeInstant(ms, nowMs, locale)} · ${formatInstantShort(ms)}`;

  const hoverValue =
    hoverMs === null ? null : burnValueAt(hoverMs <= nowMs ? history : projection, hoverMs);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverMs(startMs + fraction * spanMs);
  };

  return (
    <section className={styles.panel} style={style} aria-label={t('quota_burn.panel_label')}>
      <header className={styles.head}>
        <div className={styles.headline}>
          <span className={styles.total}>{formatPercent(forecast.remaining)}</span>
          <span className={styles.capacity}>
            {t('quota_burn.remaining_of', { capacity: formatPercent(capacity) })}
          </span>
          <span className={styles.rate}>{rateText}</span>
          {forecast.emptyAtMs !== null && (
            <span className={styles.runsOut}>
              {t('quota_burn.runs_out', {
                when: formatRelativeInstant(forecast.emptyAtMs, nowMs, locale),
              })}
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('quota_burn.expand') : t('quota_burn.collapse')}
          title={collapsed ? t('quota_burn.expand') : t('quota_burn.collapse')}
          onClick={() => updateSettings({ collapsed: !collapsed })}
        >
          {collapsed ? (
            <IconChevronDown size={16} aria-hidden="true" />
          ) : (
            <IconChevronUp size={16} aria-hidden="true" />
          )}
        </button>
      </header>

      {!collapsed && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.legendDot} aria-hidden="true" />
                {t('quota_burn.legend_remaining')}
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDash} aria-hidden="true" />
                {t('quota_burn.legend_projected')}
              </span>
            </div>
            <label className={styles.horizon}>
              <span>{t('quota_burn.horizon_label')}</span>
              <Select
                value={String(horizonDays)}
                options={BURN_HORIZON_DAYS.map((days) => ({
                  value: String(days),
                  label: t(`quota_burn.horizon_${days}`),
                }))}
                onChange={(value) =>
                  updateSettings({ horizonDays: Number(value) as BurnHorizonDays })
                }
                ariaLabel={t('quota_burn.horizon_label')}
                size="sm"
              />
            </label>
          </div>

          <div className={styles.chart}>
            <div className={styles.yAxis} aria-hidden="true">
              {Y_TICKS.map((fraction) => (
                <span key={fraction} style={{ top: `${(1 - fraction) * 100}%` }}>
                  {formatPercent(capacity * fraction)}
                </span>
              ))}
            </div>
            <div
              ref={plotRef}
              className={styles.plot}
              role="img"
              aria-label={t('quota_burn.chart_label', {
                provider: typeLabel,
                remaining: formatPercent(forecast.remaining),
                capacity: formatPercent(capacity),
                horizon: horizonLabel,
              })}
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverMs(null)}
            >
              {Y_TICKS.map((fraction) => (
                <span
                  key={fraction}
                  className={styles.gridLine}
                  style={{ top: `${(1 - fraction) * 100}%` }}
                />
              ))}
              <svg
                className={styles.svg}
                viewBox={`0 0 ${BOX} ${BOX}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" className={styles.fillTop} />
                    <stop offset="100%" className={styles.fillBottom} />
                  </linearGradient>
                </defs>
                <path d={areaPath(history)} fill={`url(#${gradientId})`} />
                <path d={areaPath(projection)} fill={`url(#${gradientId})`} opacity={0.6} />
                <path d={linePath(history)} className={styles.historyLine} />
                <path d={linePath(projection)} className={styles.projectionLine} />
              </svg>
              <span className={styles.nowLine} style={{ left: `${leftPercent(nowMs)}%` }}>
                <span className={styles.nowLabel}>{t('quota_burn.now')}</span>
              </span>
              {hoverMs !== null && hoverValue !== null && (
                <>
                  <span className={styles.crosshair} style={{ left: `${leftPercent(hoverMs)}%` }} />
                  <span
                    className={styles.hoverDot}
                    style={{
                      left: `${leftPercent(hoverMs)}%`,
                      top: `${(yOf(hoverValue) / BOX) * 100}%`,
                    }}
                  />
                  <span
                    className={styles.tooltip}
                    data-flip={leftPercent(hoverMs) > 70 ? 'true' : undefined}
                    style={{ left: `${leftPercent(hoverMs)}%` }}
                  >
                    <strong>{formatPercent(hoverValue)}</strong>
                    <span>
                      {hoverMs <= nowMs
                        ? t('quota_burn.tooltip_recorded')
                        : t('quota_burn.tooltip_projected')}
                      {' · '}
                      {formatInstantShort(hoverMs)}
                    </span>
                  </span>
                </>
              )}
            </div>
            <div className={styles.xAxis} aria-hidden="true">
              {dayTicks(startMs, endMs).map((ms) => {
                const left = leftPercent(ms);
                return (
                  <span
                    key={ms}
                    data-edge={left < 4 ? 'start' : left > 96 ? 'end' : undefined}
                    style={{ left: `${left}%` }}
                  >
                    {new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                  </span>
                );
              })}
            </div>
          </div>

          <footer className={styles.footer}>
            <span className={styles.nextReset}>
              {nextReset
                ? t('quota_burn.next_reset', {
                    gain: formatPercent(nextReset.gain),
                    when: whenText(nextReset.at),
                  })
                : t('quota_burn.no_reset')}
            </span>
            <button
              type="button"
              className={styles.settingsToggle}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              {settingsOpen ? (
                <IconChevronUp size={14} aria-hidden="true" />
              ) : (
                <IconChevronDown size={14} aria-hidden="true" />
              )}
              {t('quota_burn.settings')}
            </button>
          </footer>

          {settingsOpen && (
            <div className={styles.settings}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('quota_burn.lookback_label')}</span>
                <Select
                  value={lookback}
                  options={BURN_LOOKBACKS.map((value) => ({
                    value,
                    label: t(`quota_burn.lookback_${value}`),
                  }))}
                  onChange={(value) => updateSettings({ lookback: value as BurnLookback })}
                  ariaLabel={t('quota_burn.lookback_label')}
                  size="sm"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('quota_burn.manual_rate_label')}</span>
                <span className={styles.rateRow}>
                  <input
                    className={styles.rateInput}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.1}
                    value={rateDraft}
                    placeholder={measuredRate === null ? '' : formatRate(measuredRate)}
                    onChange={(event) => {
                      const text = event.target.value;
                      setRateDraft(text);
                      const value = Number(text);
                      updateSettings({
                        manualRate:
                          text.trim() !== '' && Number.isFinite(value) && value >= 0
                            ? value
                            : undefined,
                      });
                    }}
                  />
                  {settings.manualRate !== undefined && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setRateDraft('');
                        updateSettings({ manualRate: undefined });
                      }}
                    >
                      {t('quota_burn.use_measured')}
                    </Button>
                  )}
                </span>
                <span className={styles.fieldHint}>
                  {measuredRate === null
                    ? t('quota_burn.manual_rate_unmeasured')
                    : t('quota_burn.manual_rate_measured', {
                        rate: t('quota_burn.rate', { rate: formatRate(measuredRate) }),
                      })}
                </span>
              </label>
              <p className={styles.note}>{t('quota_burn.readings_note')}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
