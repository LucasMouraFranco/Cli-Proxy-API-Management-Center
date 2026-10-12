/**
 * Usage by account: for the last hour, three hours, today or seven days, how
 * many requests and tokens went to each account and how much of its quota they
 * used.
 *
 * Requests and tokens are the backend's per-account buckets (see usageModel.ts),
 * refetched every minute. Quota used comes from readings this browser saves
 * (quotaReadings.ts), so the page also reloads quotas every few minutes while
 * it is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { formatTokenCount } from '@/utils/tokenUsage';
import { getQuotaAccountLabel, getQuotaCacheKey } from '@/utils/quota/identity';
import { Sparkline } from '@/features/dashboard/components/Sparkline';
import { toneForSuccessRate, type MeterTone } from '@/features/dashboard/utils';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import headerStyles from '@/features/quota/components/QuotaHeader.module.scss';
import { PrivateText } from '@/features/quota/components/PrivateText';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import { buildQuotaRowModel } from '@/features/quota/quotaOverview';
import { TRACKED_QUOTA_TYPES, useQuotaReadings, type QuotaReadingLog } from './quotaReadings';
import {
  formatConsumedPercent,
  periodStartMs,
  quotaConsumedSince,
  summarizeAccountUsage,
  summarizeTotals,
  USAGE_PERIODS,
  type AccountUsage,
  type UsagePeriod,
} from './usageModel';
import claudeLogo from '@/assets/icons/claude.svg';
import openaiLogo from '@/assets/icons/openai-light.svg';
import styles from './UsagePage.module.scss';

const FILES_REFRESH_MS = 60 * 1000;
/** Quota fetches hit each provider's API, so they run far less often than the file list. */
const QUOTA_REFRESH_MS = 5 * 60 * 1000;

interface AccountRow {
  key: string;
  file: AuthFileItem;
  usage: AccountUsage;
}

const percentText = (value: number) =>
  `${value >= 99.95 || value === 0 ? value.toFixed(0) : value.toFixed(1)}%`;

export function UsagePage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const nowMs = useNow();

  const [period, setPeriod] = useState<UsagePeriod>('1h');
  const [files, setFiles] = useState<AuthFileItem[] | null>(null);
  const [error, setError] = useState('');

  /* ---------- Account list (requests and tokens) ---------- */

  const listRequestRef = useRef(0);
  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    if (!connected) return;
    // A response from an older request or an earlier connection must not land here.
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(data?.files ?? []);
      setError('');
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    }
  }, [connected, sessionGeneration, t]);

  useEffect(() => {
    setFiles(null);
    void loadFiles();
    const timer = window.setInterval(() => void loadFiles(), FILES_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  /* ---------- Quotas (for quota used) ---------- */

  const quotaEntries = useMemo(
    () => classifyQuotaFiles(files ?? []).filter((entry) => TRACKED_QUOTA_TYPES.has(entry.type)),
    [files]
  );
  const readings = useQuotaReadings(quotaEntries);
  const { loadQuota } = useQuotaBatchLoader();

  // Timers read the latest list without restarting every time the file list refetches.
  // Declared before the loading effect so it is up to date when that one runs.
  const quotaEntriesRef = useRef(quotaEntries);
  useEffect(() => {
    quotaEntriesRef.current = quotaEntries;
  }, [quotaEntries]);
  const hasQuotaEntries = quotaEntries.length > 0;
  useEffect(() => {
    if (!connected || !hasQuotaEntries) return;
    void loadQuota(quotaEntriesRef.current);
    const timer = window.setInterval(
      () => void loadQuota(quotaEntriesRef.current),
      QUOTA_REFRESH_MS
    );
    return () => window.clearInterval(timer);
  }, [connected, hasQuotaEntries, loadQuota, sessionGeneration]);

  const refreshAll = useCallback(async () => {
    await loadFiles();
    await loadQuota(quotaEntriesRef.current);
  }, [loadFiles, loadQuota]);
  useHeaderRefresh(refreshAll, connected);

  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);
  const getQuota = useCallback(
    (type: QuotaProviderType, key: string): QuotaCardState | undefined => {
      const maps = { claude: claudeQuota, codex: codexQuota, kimi: kimiQuota, xai: xaiQuota };
      return (
        maps as unknown as Partial<Record<QuotaProviderType, Record<string, QuotaCardState>>>
      )[type]?.[key];
    },
    [claudeQuota, codexQuota, kimiQuota, xaiQuota]
  );

  /* ---------- Rows and totals ---------- */

  const rows = useMemo<AccountRow[]>(() => {
    if (!files) return [];
    return files
      .filter((file) => !file.disabled)
      .map((file) => ({
        key: getQuotaCacheKey(file),
        file,
        usage: summarizeAccountUsage(
          {
            recentRequests: file.recentRequests,
            recentTokens: file.tokenUsage?.recent,
            hourly: file.tokenUsage?.hourly,
          },
          period,
          nowMs
        ),
      }))
      .sort(
        (a, b) =>
          b.usage.requests - a.usage.requests ||
          b.usage.tokens.total - a.usage.tokens.total ||
          a.file.name.localeCompare(b.file.name)
      );
  }, [files, period, nowMs]);

  const totals = useMemo(() => summarizeTotals(rows.map((row) => row.usage)), [rows]);
  const maxRequests = rows[0]?.usage.requests ?? 0;
  const busiest = maxRequests > 0 ? rows[0] : null;
  const startMs = periodStartMs(period, nowMs);
  const periodLabel = t(`usage_page.period_label_${period}`);

  // "since" times on an earlier day (possible for today and 7 days) also name the day.
  const formatTime = useMemo(() => {
    const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
    const dayTime = new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return (ms: number) =>
      new Date(ms).toDateString() === new Date(nowMs).toDateString()
        ? time.format(ms)
        : dayTime.format(ms);
  }, [i18n.language, nowMs]);

  // Header entrance cascade, as on the Quota page.
  const revealRef = useRevealGroup<HTMLDivElement>();

  const shareOf = (requests: number) =>
    totals.requests > 0 ? percentText((requests / totals.requests) * 100) : '0%';

  return (
    <div className={styles.page} ref={revealRef}>
      {/* Same header as the Quota and Auth Files pages: title, then a mono status line. */}
      <header className={headerStyles.header}>
        <div className={headerStyles.copy}>
          <h1 className={headerStyles.title} data-reveal>
            {t('usage_page.title')}
          </h1>
          <p className={headerStyles.meta} data-reveal>
            <span className={headerStyles.metaTotal}>
              {t('usage_page.meta_accounts', { count: totals.accountCount })}
            </span>
            <span className={headerStyles.metaDot} aria-hidden="true">
              ·
            </span>
            <span
              className={
                totals.activeAccounts > 0 ? headerStyles.metaLoaded : headerStyles.metaMuted
              }
            >
              {t('usage_page.meta_active', { count: totals.activeAccounts })}
            </span>
            <span className={headerStyles.metaDot} aria-hidden="true">
              ·
            </span>
            <span className={headerStyles.metaMuted}>{periodLabel}</span>
          </p>
        </div>
        <div
          data-reveal
          className={styles.segmented}
          role="radiogroup"
          aria-label={t('usage_page.period_aria')}
        >
          {USAGE_PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              className={`${styles.segment} ${period === value ? styles.segmentActive : ''}`}
              onClick={() => setPeriod(value)}
            >
              {t(`usage_page.period_${value}`)}
            </button>
          ))}
        </div>
      </header>

      <section className={styles.statsRow} aria-label={t('usage_page.stats_aria')}>
        <StatTile
          tone={toneForSuccessRate(totals.successRate)}
          label={t('usage_page.stat_requests')}
          value={totals.requests.toLocaleString()}
          hint={
            totals.successRate === null
              ? t('usage_page.stat_requests_empty')
              : t('usage_page.stat_requests_hint', {
                  rate: percentText(totals.successRate),
                  failed: totals.failed.toLocaleString(),
                })
          }
        />
        <StatTile
          label={t('usage_page.stat_tokens')}
          value={formatTokenCount(totals.tokens.total)}
          hint={t('usage_page.stat_tokens_hint', {
            input: formatTokenCount(totals.tokens.input),
            output: formatTokenCount(totals.tokens.output),
            cache: formatTokenCount(totals.tokens.cacheRead),
          })}
        />
        <StatTile
          label={t('usage_page.stat_accounts')}
          value={
            <>
              {totals.activeAccounts}
              <span className={styles.statValueMuted}> / {totals.accountCount}</span>
            </>
          }
          hint={t('usage_page.stat_accounts_hint', {
            count: totals.accountCount - totals.activeAccounts,
          })}
        />
        <StatTile
          label={t('usage_page.stat_busiest')}
          value={busiest ? getQuotaAccountLabel(busiest.file).name : '—'}
          valueTitle={busiest ? getQuotaAccountLabel(busiest.file).name : undefined}
          hint={
            busiest
              ? t('usage_page.stat_busiest_hint', { share: shareOf(busiest.usage.requests) })
              : t('usage_page.stat_busiest_none')
          }
        />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>{t('usage_page.list_title')}</h2>
          <span className={styles.panelMeta}>
            {t('usage_page.list_meta', { period: periodLabel })}
          </span>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {files === null && !error ? (
          <p className={styles.emptyNote}>{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          files !== null && <p className={styles.emptyNote}>{t('usage_page.empty')}</p>
        ) : (
          <div className={styles.table} role="table" aria-label={t('usage_page.list_title')}>
            <div className={styles.colsHead} role="row">
              <span role="columnheader" aria-label={t('usage_page.col_rank')}>
                #
              </span>
              <span role="columnheader">{t('usage_page.col_account')}</span>
              <span role="columnheader">{t('usage_page.col_requests')}</span>
              <span role="columnheader" className={styles.tokensHead}>
                {t('usage_page.col_tokens')}
                <span className={styles.legend} aria-hidden="true">
                  <i className={styles.tokIn} />
                  {t('usage_page.legend_in')}
                  <i className={styles.tokOut} />
                  {t('usage_page.legend_out')}
                  <i className={styles.tokCache} />
                  {t('usage_page.legend_cache')}
                </span>
              </span>
              <span role="columnheader">{t('usage_page.col_quota')}</span>
              <span role="columnheader">{t('usage_page.col_activity')}</span>
            </div>
            {rows.map((row, index) => (
              <UsageRow
                key={row.key}
                row={row}
                rank={index + 1}
                maxRequests={maxRequests}
                share={shareOf(row.usage.requests)}
                quotaType={resolveQuotaProviderType(row.file)}
                getQuota={getQuota}
                readings={readings}
                startMs={startMs}
                formatTime={formatTime}
              />
            ))}
          </div>
        )}
      </section>

      <p className={styles.footnote}>{t('usage_page.footnote')}</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  valueTitle,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  valueTitle?: string;
  hint: string;
  tone?: MeterTone;
}) {
  return (
    <div className={`${styles.statTile} ${tone ? styles[`tone_${tone}`] : ''}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} title={valueTitle}>
        {value}
      </span>
      <span className={styles.statHint}>{hint}</span>
    </div>
  );
}

function UsageRow({
  row,
  rank,
  maxRequests,
  share,
  quotaType,
  getQuota,
  readings,
  startMs,
  formatTime,
}: {
  row: AccountRow;
  rank: number;
  maxRequests: number;
  share: string;
  quotaType: QuotaProviderType | null;
  getQuota: (type: QuotaProviderType, key: string) => QuotaCardState | undefined;
  readings: QuotaReadingLog;
  startMs: number;
  formatTime: (ms: number) => string;
}) {
  const { t } = useTranslation();
  const { file, usage, key } = row;
  const label = getQuotaAccountLabel(file);
  const idle = usage.requests === 0 && usage.tokens.total === 0;
  const barWidth = (value: number) => (maxRequests > 0 ? (value / maxRequests) * 100 : 0);
  const tokenWidth = (value: number) =>
    usage.tokens.total > 0 ? (value / usage.tokens.total) * 100 : 0;

  return (
    <div className={`${styles.row} ${idle ? styles.rowIdle : ''}`} role="row">
      <span className={styles.rank} role="cell">
        {String(rank).padStart(2, '0')}
      </span>

      <div className={styles.identity} role="cell">
        <div className={styles.nameLine}>
          <PrivateText text={label.name} className={styles.name} showEmails={false} />
          <ProviderBadge type={String(file.type ?? file.provider ?? '')} quotaType={quotaType} />
        </div>
        {label.detail && (
          <PrivateText text={label.detail} className={styles.detail} showEmails={false} />
        )}
      </div>

      {idle ? (
        <span className={`${styles.idleNote} ${styles.spanTwo}`} role="cell">
          {t('usage_page.idle')}
        </span>
      ) : (
        <>
          <div className={`${styles.metric} ${styles.metricRequests}`} role="cell">
            <div className={styles.metricTop}>
              <span className={styles.metricTotal}>{usage.requests.toLocaleString()}</span>
              <span className={styles.metricLabel}>{t('usage_page.share', { share })}</span>
              {usage.failed > 0 && (
                <span className={styles.failBadge}>
                  {t('usage_page.failed_badge', { count: usage.failed })}
                </span>
              )}
            </div>
            <div className={styles.ratioBar} aria-hidden="true">
              {usage.success > 0 && (
                <span
                  className={`${styles.ratioSegment} ${styles.splitSuccess}`}
                  style={{ width: `${barWidth(usage.success)}%` }}
                />
              )}
              {usage.failed > 0 && (
                <span
                  className={`${styles.ratioSegment} ${styles.splitFailure}`}
                  style={{ width: `${barWidth(usage.failed)}%` }}
                />
              )}
            </div>
          </div>

          <div className={`${styles.metric} ${styles.metricTokens}`} role="cell">
            <span className={styles.metricTotal}>{formatTokenCount(usage.tokens.total)}</span>
            <div className={styles.tokenBar} aria-hidden="true">
              {(
                [
                  ['tokIn', usage.tokens.input],
                  ['tokOut', usage.tokens.output],
                  ['tokCache', usage.tokens.cacheRead],
                ] as const
              ).map(([className, value]) =>
                value > 0 ? (
                  <span
                    key={className}
                    className={styles[className]}
                    style={{ width: `${tokenWidth(value)}%` }}
                  />
                ) : null
              )}
            </div>
            <span className={styles.metricSplit}>
              {formatTokenCount(usage.tokens.input)} / {formatTokenCount(usage.tokens.output)} /{' '}
              {formatTokenCount(usage.tokens.cacheRead)}
            </span>
          </div>
        </>
      )}

      <div className={styles.quota} role="cell">
        <QuotaUsed
          accountKey={key}
          quotaType={quotaType}
          getQuota={getQuota}
          readings={readings}
          startMs={startMs}
          formatTime={formatTime}
        />
      </div>

      <div className={styles.activity} role="cell">
        <Sparkline
          points={usage.series}
          ariaLabel={t('usage_page.activity_aria', { name: label.name })}
          className={styles.spark}
        />
      </div>
    </div>
  );
}

function QuotaUsed({
  accountKey,
  quotaType,
  getQuota,
  readings,
  startMs,
  formatTime,
}: {
  accountKey: string;
  quotaType: QuotaProviderType | null;
  getQuota: (type: QuotaProviderType, key: string) => QuotaCardState | undefined;
  readings: QuotaReadingLog;
  startMs: number;
  formatTime: (ms: number) => string;
}) {
  const { t } = useTranslation();
  if (!quotaType || !TRACKED_QUOTA_TYPES.has(quotaType)) {
    return <span className={styles.quotaMuted}>{t('usage_page.quota_not_tracked')}</span>;
  }
  const state = getQuota(quotaType, accountKey);
  const model = buildQuotaRowModel(t, quotaType, state);
  if (!model || model.metrics.length === 0) {
    return (
      <span className={styles.quotaMuted}>
        {state?.status === 'error' ? t('usage_page.quota_unavailable') : t('common.loading')}
      </span>
    );
  }

  const windows = model.metrics.map((metric) => ({
    metric,
    consumption: quotaConsumedSince(readings[accountKey]?.[metric.id] ?? [], startMs),
  }));
  const measured = windows.filter((window) => window.consumption !== null);
  const partialSinceMs = measured.reduce<number | null>((latest, window) => {
    const since = window.consumption?.partialSinceMs ?? null;
    return since === null ? latest : Math.max(latest ?? 0, since);
  }, null);

  return (
    <>
      {windows.map(({ metric, consumption }) => {
        const used = consumption?.usedPercent ?? null;
        return (
          <span
            key={metric.id}
            className={`${styles.quotaPill} ${used === null || used <= 0 ? styles.quotaPillQuiet : ''}`}
          >
            <b>{used === null ? '—' : used > 0 ? `−${formatConsumedPercent(used)}` : '0%'}</b>
            {metric.label}
          </span>
        );
      })}
      {measured.length === 0 ? (
        <span className={styles.quotaHint}>{t('usage_page.quota_collecting')}</span>
      ) : (
        partialSinceMs !== null && (
          <span className={styles.quotaHint}>
            {t('usage_page.quota_since', { time: formatTime(partialSinceMs) })}
          </span>
        )
      )}
    </>
  );
}

/** Claude and Codex get their brand logo and colour; other providers keep a neutral pill. */
const BRANDED_PROVIDERS: Partial<Record<QuotaProviderType, { logo: string; className: string }>> = {
  claude: { logo: claudeLogo, className: styles.brandClaude },
  codex: { logo: openaiLogo, className: styles.brandCodex },
};

function ProviderBadge({ type, quotaType }: { type: string; quotaType: QuotaProviderType | null }) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const brand = quotaType ? BRANDED_PROVIDERS[quotaType] : undefined;
  const label = getTypeLabel(t, type);

  if (brand) {
    // The logo is a mask filled with the text colour, so it always matches the pill.
    const mask = `url("${brand.logo}")`;
    return (
      <span className={`${styles.provider} ${brand.className}`}>
        <span
          className={styles.providerLogo}
          style={{ maskImage: mask, WebkitMaskImage: mask }}
          aria-hidden="true"
        />
        {label}
      </span>
    );
  }

  const icon = getAuthFileIcon(type, resolvedTheme);
  return (
    <span className={styles.provider}>
      {icon && <img className={styles.providerIcon} src={icon} alt="" aria-hidden="true" />}
      {label}
    </span>
  );
}
