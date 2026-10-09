/**
 * One account on the Quota Management page: identity, the provider's quota bars
 * (weekly model bucket, 5-hour, 7-day), Codex plan/renewal/manual resets, xAI
 * monthly credits, cache usage, and the refresh/reset actions. Providers without a
 * compact model render their full quota body in the row.
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { CredentialCacheUsage } from '@/components/usage/CredentialCacheUsage';
import type { ClaudeQuotaState, CodexQuotaState, XaiQuotaState } from '@/types';
import {
  formatInstantShort,
  formatRelativeInstant,
  parseIsoToMs,
  resolveQuotaErrorMessage,
  resolveResetMs,
} from '@/utils/quota';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { getCodexPlanLabel } from '../providers/codex/planLabel';
import { formatXaiOnDemandAmount, formatXaiRemainingAmount } from '../providers/xai/amounts';
import { toneForRemaining, type QuotaMetric, type QuotaRowModel } from '../quotaOverview';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaAccountRow.module.scss';

/** Full quota bodies rendered inside a row bind the shared QuotaBody class contract. */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export interface QuotaAccountRowProps {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  model: QuotaRowModel | null;
  displayName: string;
  /** Shown under a nickname so the account's email stays visible. */
  displayDetail: string | null;
  nowMs: number;
  isNextPick: boolean;
  showExtraBuckets: boolean;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
}

const formatPercent = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

function MetricCell({
  metric,
  nowMs,
  locale,
}: {
  metric: QuotaMetric;
  nowMs: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const tone = toneForRemaining(metric.remainingPercent);
  const resetAt = metric.resetAtMs !== null && metric.resetAtMs > nowMs ? metric.resetAtMs : null;
  return (
    <div className={`${styles.metric} ${metric.muted ? styles.metricMuted : ''}`}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel}>{metric.label}</span>
        <span className={styles.metricValue}>{formatPercent(metric.remainingPercent)}</span>
      </div>
      <div className={styles.bar}>
        <div
          className={`${styles.barFill} ${styles[`fill_${tone}`]}`}
          style={{ width: `${metric.remainingPercent ?? 0}%` }}
        />
      </div>
      <div className={styles.metricReset}>
        {resetAt === null ? (
          <span className={styles.resetMuted}>{t('quota_overview.no_reset_pending')}</span>
        ) : (
          <>
            <span className={styles.resetRelative}>
              {formatRelativeInstant(resetAt, nowMs, locale)}
            </span>
            <span className={styles.resetAbsolute}>{formatInstantShort(resetAt)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function CodexResetCreditsCell({
  quota,
  nowMs,
  locale,
}: {
  quota: CodexQuotaState;
  nowMs: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const available = quota.rateLimitResetCreditsAvailableCount;
  if (available === null || available === undefined) return null;
  const nextExpiry = (quota.rateLimitResetCredits ?? [])
    .map((credit) => parseIsoToMs(credit.expiresAt))
    .filter((ms): ms is number => ms !== null && ms > nowMs)
    .sort((a, b) => a - b)[0];
  return (
    <div className={styles.metric}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel}>{t('codex_quota.reset_credits_label')}</span>
      </div>
      <div className={styles.credits}>
        <span className={styles.creditsCount}>{available}</span>
        <span className={styles.creditsLabel}>{t('quota_overview.available')}</span>
      </div>
      {nextExpiry !== undefined && (
        <div
          className={styles.creditsExpiry}
          title={`${t('quota_overview.next_credit_expiry')} ${formatInstantShort(nextExpiry)}`}
        >
          {t('quota_overview.next_credit_expiry')}{' '}
          <span className={styles.resetRelative}>
            {formatRelativeInstant(nextExpiry, nowMs, locale)}
          </span>
          {' · '}
          {formatInstantShort(nextExpiry)}
        </div>
      )}
    </div>
  );
}

function XaiCreditsCell({
  quota,
  nowMs,
  locale,
}: {
  quota: XaiQuotaState;
  nowMs: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const billing = quota.billing;
  if (!billing || billing.mode !== 'billing') return null;
  if (billing.monthlyLimitCents === null && billing.usedCents === null) return null;
  const onDemand =
    (billing.onDemandCapCents ?? 0) > 0
      ? formatXaiOnDemandAmount(billing)
      : t('xai_quota.pay_as_you_go_disabled');
  const periodEnd = parseIsoToMs(billing.billingPeriodEnd);
  const detail = `${t('xai_quota.pay_as_you_go_label')}: ${onDemand}`;
  return (
    <div className={styles.metric}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel}>{t('xai_quota.monthly_credits')}</span>
      </div>
      <div className={styles.credits}>
        <span className={styles.creditsCount}>{formatXaiRemainingAmount(billing)}</span>
      </div>
      <div className={styles.creditsExpiry} title={detail}>
        {detail}
        {periodEnd !== null && periodEnd > nowMs && (
          <>
            {' · '}
            <span className={styles.resetRelative}>
              {formatRelativeInstant(periodEnd, nowMs, locale)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function QuotaAccountRow(props: QuotaAccountRowProps) {
  const {
    entry,
    quota,
    model,
    displayName,
    displayDetail,
    nowMs,
    isNextPick,
    showExtraBuckets,
    canRefresh,
    resetting,
    onRefresh,
    onReset,
  } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';

  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const showClaudeReset = entry.type === 'claude' && (claudeReset.count ?? 0) > 0;
  const showCodexReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  const subline: string[] = [];
  let renewal: { relative: string; absolute: string } | null = null;
  if (status === 'success' && entry.type === 'claude') {
    const planType = (quota as ClaudeQuotaState).planType;
    if (planType) subline.push(t(`claude_quota.${planType}`));
  }
  if (status === 'success' && entry.type === 'codex') {
    const codex = quota as CodexQuotaState;
    const planLabel = getCodexPlanLabel(t, codex.planType);
    if (planLabel) subline.push(planLabel);
    const renewsAt = resolveResetMs([codex.subscriptionActiveUntil ?? null]);
    if (renewsAt !== null) {
      renewal = {
        relative: formatRelativeInstant(renewsAt, nowMs, locale),
        absolute: formatInstantShort(renewsAt),
      };
    }
  }

  const renewalText = renewal
    ? `${t('quota_overview.renews', { date: renewal.absolute })} · ${renewal.relative}`
    : '';
  const sublineTitle = [subline.join(' · '), renewalText].filter(Boolean).join(' · ');

  const errorMessage =
    status === 'error'
      ? resolveQuotaErrorMessage(t, quota?.errorStatus, quota?.error || t('common.unknown_error'))
      : '';
  const metrics = model ? [...model.metrics, ...(showExtraBuckets ? model.extra : [])] : [];

  return (
    <article className={styles.row} data-next-pick={isNextPick || undefined}>
      <div className={styles.identity}>
        <div className={styles.nameLine}>
          <span className={styles.name} title={displayName}>
            {displayName}
          </span>
          {isNextPick && (
            <span className={styles.nextBadge} title={t('quota_overview.next_pick_hint')}>
              {t('quota_overview.next_pick')}
            </span>
          )}
        </div>
        {displayDetail && (
          <div className={styles.detail} title={displayDetail}>
            {displayDetail}
          </div>
        )}
        {(subline.length > 0 || renewal) && (
          <div className={styles.subline} title={sublineTitle}>
            {subline.length > 0 && <span className={styles.plan}>{subline.join(' · ')}</span>}
            {renewal && (
              <span className={styles.renewal}>
                {t('quota_overview.renews', { date: renewal.absolute })}
                <span className={styles.renewalRelative}>{renewal.relative}</span>
              </span>
            )}
          </div>
        )}
        {entry.type === 'claude' && claudeReset.count !== null && claudeReset.count > 0 && (
          <div className={styles.subline}>
            <span className={styles.plan}>
              {t('claude_reset.remaining')} {claudeReset.count}
            </span>
          </div>
        )}
        {file.tokenUsage && (
          <div className={styles.cache}>
            <CredentialCacheUsage usage={file.tokenUsage} compact />
          </div>
        )}
      </div>

      <div className={styles.body}>
        {status === 'idle' ? (
          <button
            type="button"
            className={styles.loadButton}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={13} aria-hidden="true" />
            {t(`${adapter.i18nPrefix}.idle`)}
          </button>
        ) : loading && !model ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1, 2].map((cell) => (
              <span key={cell} className={styles.skeletonCell} aria-hidden="true" />
            ))}
          </div>
        ) : status === 'error' ? (
          <div className={styles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
          </div>
        ) : model ? (
          <div className={styles.metrics}>
            {metrics.map((metric) => (
              <MetricCell key={metric.id} metric={metric} nowMs={nowMs} locale={locale} />
            ))}
            {entry.type === 'codex' && quota && (
              <CodexResetCreditsCell
                quota={quota as CodexQuotaState}
                nowMs={nowMs}
                locale={locale}
              />
            )}
            {entry.type === 'xai' && quota && (
              <XaiCreditsCell quota={quota as XaiQuotaState} nowMs={nowMs} locale={locale} />
            )}
          </div>
        ) : quota ? (
          <div className={styles.fullBody}>
            <adapter.Body quota={quota} classes={quotaClasses} />
          </div>
        ) : null}
      </div>

      {status !== 'idle' && (
        <div className={styles.actions}>
          {showClaudeReset && (
            <button
              type="button"
              className={styles.action}
              disabled={claudeReset.blocked}
              onClick={claudeReset.confirm}
              title={t(`claude_reset.${claudeReset.buttonLabel}`)}
            >
              <IconRefreshCw size={12} className={claudeReset.busy ? styles.spinning : undefined} />
              {t(`claude_reset.${claudeReset.buttonLabel}`)}
            </button>
          )}
          {showCodexReset && (
            <button
              type="button"
              className={styles.action}
              onClick={onReset}
              disabled={!canRefresh || loading || resetting}
              title={t('codex_quota.reset_button')}
            >
              <IconRefreshCw size={12} className={resetting ? styles.spinning : undefined} />
              {t('codex_quota.reset_button')}
            </button>
          )}
          <button
            type="button"
            className={styles.action}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={12} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </div>
      )}
    </article>
  );
}
