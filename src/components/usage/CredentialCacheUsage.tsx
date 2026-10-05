import { useTranslation } from 'react-i18next';
import {
  cacheReadShare,
  detectCacheWriteSpike,
  formatTokenCount,
  type CredentialTokenUsage,
} from '@/utils/tokenUsage';
import styles from './CredentialCacheUsage.module.scss';

interface CredentialCacheUsageProps {
  usage: CredentialTokenUsage;
  /** Totals only, for dense rows; the recent-activity bars are omitted. */
  compact?: boolean;
}

const formatBucketTime = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Prompt-cache reads and writes for one credential. A burst of cache writes usually
 * means a conversation moved to this account and its cache was rebuilt.
 */
export function CredentialCacheUsage({ usage, compact = false }: CredentialCacheUsageProps) {
  const { t } = useTranslation();
  const share = cacheReadShare(usage);
  const spike = detectCacheWriteSpike(usage.recent);
  const maxWrite = Math.max(0, ...usage.recent.map((bucket) => bucket.cacheWriteTokens));
  const spikeMessage = spike
    ? Number.isFinite(spike.ratio)
      ? t('cache_usage.spike', {
          time: formatBucketTime(spike.bucket.time),
          tokens: formatTokenCount(spike.bucket.cacheWriteTokens),
          ratio: Math.round(spike.ratio),
        })
      : t('cache_usage.spike_idle', {
          time: formatBucketTime(spike.bucket.time),
          tokens: formatTokenCount(spike.bucket.cacheWriteTokens),
        })
    : '';

  return (
    <div className={`${styles.root} ${compact ? styles.compact : ''}`}>
      <div className={styles.head}>
        <span className={styles.label}>{t('cache_usage.title')}</span>
        <span className={styles.counts}>
          <span className={styles.count}>
            {t('cache_usage.read')}{' '}
            <span className={styles.value}>{formatTokenCount(usage.cacheReadTokens)}</span>
          </span>
          <span className={styles.count}>
            {t('cache_usage.write')}{' '}
            <span className={`${styles.value} ${spike ? styles.valueSpike : ''}`}>
              {formatTokenCount(usage.cacheWriteTokens)}
            </span>
          </span>
          {share !== null && (
            <span className={styles.share} title={t('cache_usage.read_share_hint')}>
              {t('cache_usage.read_share', { percent: Math.round(share * 100) })}
            </span>
          )}
        </span>
      </div>
      {!compact && usage.recent.length > 0 && (
        <div className={styles.bars} role="img" aria-label={t('cache_usage.bars_label')}>
          {usage.recent.map((bucket) => {
            const height =
              maxWrite > 0 && bucket.cacheWriteTokens > 0
                ? Math.max(12, Math.round((bucket.cacheWriteTokens / maxWrite) * 100))
                : 0;
            const isSpike = spike?.bucket.time === bucket.time;
            return (
              <span
                key={bucket.time}
                className={styles.barSlot}
                title={t('cache_usage.bar_title', {
                  time: formatBucketTime(bucket.time),
                  tokens: formatTokenCount(bucket.cacheWriteTokens),
                })}
              >
                <span
                  className={`${styles.bar} ${isSpike ? styles.barSpike : ''} ${
                    height === 0 ? styles.barIdle : ''
                  }`}
                  style={height > 0 ? { height: `${height}%` } : undefined}
                />
              </span>
            );
          })}
        </div>
      )}
      {spike && (
        <div className={styles.spikeNote} role="status">
          {spikeMessage}
        </div>
      )}
    </div>
  );
}
