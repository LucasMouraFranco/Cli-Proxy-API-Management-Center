/**
 * One summary card per provider: the weekly (model) bucket added up across
 * accounts ("409% of 500%"), a segment per account, the soonest reset, and the
 * account the routing strategy would pick next.
 */

import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { toneForRemaining, type ProviderSummary } from '../quotaOverview';
import styles from './QuotaSummaryCards.module.scss';

export interface QuotaSummaryCardsProps {
  summaries: ProviderSummary[];
  resolvedTheme: ResolvedTheme;
  nowMs: number;
  /** Display name of the next pick per provider, already masked when emails are hidden. */
  nextPickName: (provider: string) => string | null;
  nextPickStrategy: (provider: string) => string | null;
  showExtraBuckets: boolean;
  onToggleExtraBuckets: () => void;
}

const formatTotal = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

export function QuotaSummaryCards(props: QuotaSummaryCardsProps) {
  const {
    summaries,
    resolvedTheme,
    nowMs,
    nextPickName,
    nextPickStrategy,
    showExtraBuckets,
    onToggleExtraBuckets,
  } = props;
  const { t, i18n } = useTranslation();
  if (summaries.length === 0) return null;

  return (
    <section className={styles.summary} aria-label={t('quota_overview.summary_label')}>
      {summaries.map((summary) => {
        const typeLabel = getTypeLabel(t, summary.type);
        const iconSrc = getAuthFileIcon(summary.type, resolvedTheme);
        const nextPick = nextPickName(summary.type);
        const strategy = nextPickStrategy(summary.type);
        const tone = toneForRemaining(
          summary.totalRemaining === null || summary.credentialCount === 0
            ? null
            : summary.totalRemaining / summary.credentialCount
        );
        return (
          <article key={summary.type} className={styles.card}>
            <header className={styles.head}>
              <span className={styles.provider}>
                <span
                  className={styles.iconWrap}
                  style={
                    isThemeSurfaceIconProvider(summary.type)
                      ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                      : undefined
                  }
                >
                  {iconSrc ? (
                    <img src={iconSrc} alt="" className={styles.icon} />
                  ) : (
                    <span className={styles.iconFallback}>
                      {typeLabel.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                {typeLabel}
              </span>
              <span className={styles.count}>
                {t('quota_overview.credentials', { count: summary.credentialCount })}
              </span>
            </header>

            <div className={styles.bucket}>
              {summary.bucketLabel ?? t('quota_overview.weekly_limit')}
            </div>
            <div className={styles.total}>
              <span className={`${styles.totalValue} ${styles[`tone_${tone}`]}`}>
                {formatTotal(summary.totalRemaining)}
              </span>
              <span className={styles.totalOf}>
                {t('quota_overview.of_capacity', { capacity: `${summary.capacity}%` })}
              </span>
            </div>
            <div
              className={styles.segments}
              role="img"
              aria-label={t('quota_overview.segments_label', {
                total: formatTotal(summary.totalRemaining),
                capacity: `${summary.capacity}%`,
              })}
            >
              {summary.segments.map((segment) => (
                <span key={segment.key} className={styles.segment}>
                  <span
                    className={`${styles.segmentFill} ${
                      styles[`fill_${toneForRemaining(segment.remainingPercent)}`]
                    }`}
                    style={{ width: `${segment.remainingPercent ?? 0}%` }}
                  />
                </span>
              ))}
            </div>
            <div className={styles.reset}>
              {summary.nextResetAtMs === null ? (
                <span className={styles.resetMuted}>{t('quota_overview.no_reset_known')}</span>
              ) : (
                <>
                  <span className={styles.resetRelative}>
                    {formatRelativeInstant(summary.nextResetAtMs, nowMs, i18n.resolvedLanguage)}
                  </span>
                  <span className={styles.resetAbsolute}>
                    {formatInstantShort(summary.nextResetAtMs)}
                  </span>
                </>
              )}
            </div>

            {nextPick && (
              <div
                className={styles.next}
                title={strategy ? t('quota_overview.next_pick_strategy', { strategy }) : undefined}
              >
                <span className={styles.nextLabel}>{t('quota_overview.next_pick')}</span>
                <span className={styles.nextName}>{nextPick}</span>
              </div>
            )}

            {summary.secondary && (
              <footer className={styles.footer}>
                <span className={styles.secondary}>
                  {summary.secondary.label}{' '}
                  <span className={styles.secondaryValue}>
                    {formatTotal(summary.secondary.totalRemaining)}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.footerToggle}
                  aria-pressed={showExtraBuckets}
                  aria-label={t(
                    showExtraBuckets
                      ? 'quota_overview.hide_extra_buckets_label'
                      : 'quota_overview.show_extra_buckets_label'
                  )}
                  onClick={onToggleExtraBuckets}
                >
                  {t(showExtraBuckets ? 'quota_overview.hide' : 'quota_overview.show')}
                </button>
              </footer>
            )}
          </article>
        );
      })}
    </section>
  );
}
