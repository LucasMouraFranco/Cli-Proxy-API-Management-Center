import {
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  BURN_HORIZON_DAYS,
  BURN_LOOKBACKS,
  type BurnHorizonDays,
  type BurnLookback,
} from './burnForecast';
import type { QuotaProviderType } from './providers/types';

/** Burn forecast panel preferences; written as a whole object. */
export type QuotaBurnUiState = {
  collapsed?: boolean;
  horizonDays?: BurnHorizonDays;
  lookback?: BurnLookback;
  /** Percent per hour typed by the user, per provider; absent means use the measured rate. */
  manualRates?: Partial<Record<QuotaProviderType, number>>;
};

/** 额度页 UI 偏好：会话级持久化（sessionStorage），跨会话不携带。 */
export type QuotaUiState = {
  tab?: QuotaTabId;
  sortMode?: QuotaSortMode;
  /** Account emails are masked unless the user asks to see them. */
  showEmails?: boolean;
  /** Extra weekly buckets (Opus, Sonnet, code review) stay hidden unless asked for. */
  showExtraBuckets?: boolean;
  burn?: QuotaBurnUiState;
};

const QUOTA_UI_STATE_KEY = 'quotaPage.uiState';

const QUOTA_TAB_ID_SET = new Set<string>(['all', ...QUOTA_TAB_ORDER]);
const QUOTA_SORT_MODE_SET = new Set<string>(QUOTA_SORT_MODES);

export const isQuotaTabId = (value: unknown): value is QuotaTabId =>
  typeof value === 'string' && QUOTA_TAB_ID_SET.has(value);

export const isQuotaSortMode = (value: unknown): value is QuotaSortMode =>
  typeof value === 'string' && QUOTA_SORT_MODE_SET.has(value);

const readBurnUiState = (value: unknown): QuotaBurnUiState | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const burn = value as Record<string, unknown>;
  const manualRates: Partial<Record<QuotaProviderType, number>> = {};
  if (burn.manualRates && typeof burn.manualRates === 'object') {
    Object.entries(burn.manualRates as Record<string, unknown>).forEach(([type, rate]) => {
      if (!(QUOTA_TAB_ORDER as readonly string[]).includes(type)) return;
      if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) {
        manualRates[type as QuotaProviderType] = rate;
      }
    });
  }
  return {
    collapsed: burn.collapsed === true ? true : undefined,
    horizonDays: (BURN_HORIZON_DAYS as readonly unknown[]).includes(burn.horizonDays)
      ? (burn.horizonDays as BurnHorizonDays)
      : undefined,
    lookback: (BURN_LOOKBACKS as readonly unknown[]).includes(burn.lookback)
      ? (burn.lookback as BurnLookback)
      : undefined,
    manualRates: Object.keys(manualRates).length > 0 ? manualRates : undefined,
  };
};

export const readQuotaUiState = (): QuotaUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(QUOTA_UI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuotaUiState;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      tab: isQuotaTabId(parsed.tab) ? parsed.tab : undefined,
      sortMode: isQuotaSortMode(parsed.sortMode) ? parsed.sortMode : undefined,
      showEmails: parsed.showEmails === true ? true : undefined,
      showExtraBuckets: parsed.showExtraBuckets === true ? true : undefined,
      burn: readBurnUiState(parsed.burn),
    };
  } catch {
    return null;
  }
};

/**
 * Merge into whatever is already stored.
 *
 * Callers write one preference at a time — the tab strip knows nothing about
 * the sort control — so a whole-object write would silently drop the other
 * field every time either one changed.
 */
export const writeQuotaUiState = (state: QuotaUiState) => {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readQuotaUiState(), ...state };
    window.sessionStorage.setItem(QUOTA_UI_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
};
