/**
 * Account text on the Quota page. Emails stay blurred until clicked, like T3 Code's
 * "Authenticated as" line, unless the page-wide "Show emails" toggle is on.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PrivateText.module.scss';

export function PrivateText({
  text,
  className,
  showEmails,
}: {
  text: string;
  className: string;
  showEmails: boolean;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  if (showEmails || !text.includes('@')) {
    return (
      <span className={className} title={text}>
        {text}
      </span>
    );
  }
  const hint = t(revealed ? 'quota_overview.hide_email' : 'quota_overview.reveal_email');
  return (
    <button
      type="button"
      className={`${className} ${styles.private}`}
      data-revealed={revealed || undefined}
      title={hint}
      // While blurred, announce the action instead of reading the hidden email aloud.
      aria-label={revealed ? undefined : hint}
      onClick={() => setRevealed((value) => !value)}
    >
      <span className={styles.privateText}>{text}</span>
    </button>
  );
}
