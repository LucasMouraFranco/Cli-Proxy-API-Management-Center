import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  quotaGuardError,
  type QuotaGuardDraft,
} from '../quotaGuard';
import styles from './AuthFilePolicyFields.module.scss';

export function AuthFileQuotaGuardFields({
  draft,
  disabled,
  onChange,
}: {
  draft: QuotaGuardDraft;
  disabled: boolean;
  onChange: (value: QuotaGuardDraft) => void;
}) {
  const { t } = useTranslation();
  const error = quotaGuardError(draft);
  const set = (next: Partial<QuotaGuardDraft>) =>
    onChange({ ...draft, ...next, touched: true });

  return (
    <div className="form-group">
      <label>{t('auth_files.quota_guard_label')}</label>
      <ToggleSwitch
        checked={draft.enabled}
        onChange={(value) => set({ enabled: value })}
        disabled={disabled}
        ariaLabel={t('auth_files.quota_guard_label')}
      />
      <div className="hint">{t('auth_files.quota_guard_hint')}</div>
      {draft.enabled && (
        <div className={styles.policyFields}>
          {draft.steps.map((step, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
              <Input
                label={t('auth_files.quota_guard_hours')}
                type="number"
                min={0}
                step={1}
                value={String(step.hours)}
                disabled={disabled}
                onChange={(event) =>
                  set({
                    steps: draft.steps.map((row, i) =>
                      i === index ? { ...row, hours: Number(event.target.value) } : row
                    ),
                  })
                }
              />
              <Input
                label={t('auth_files.quota_guard_min_remaining')}
                type="number"
                min={0}
                max={100}
                step={1}
                value={String(step.minRemaining)}
                disabled={disabled}
                onChange={(event) =>
                  set({
                    steps: draft.steps.map((row, i) =>
                      i === index ? { ...row, minRemaining: Number(event.target.value) } : row
                    ),
                  })
                }
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled || draft.steps.length <= 1}
                onClick={() =>
                  set({ steps: draft.steps.filter((_, i) => i !== index) })
                }
              >
                {t('common.delete')}
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || draft.steps.length >= 8}
            onClick={() =>
              set({ steps: [...draft.steps, { hours: 0, minRemaining: 5 }] })
            }
          >
            {t('auth_files.quota_guard_add_step')}
          </Button>
          <div className="hint">{t('auth_files.quota_guard_steps_hint')}</div>
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {t(error)}
        </div>
      )}
    </div>
  );
}
