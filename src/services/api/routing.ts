/**
 * Routing preview (CLIProxyAPI fork): which credential the routing strategy would
 * pick next for a new session, per provider.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

const ROUTING_PREVIEW_TIMEOUT_MS = 10 * 1000;

export interface RoutingPreviewWindow {
  usedPercent: number | null;
  resetAtMs: number | null;
}

export interface RoutingPreviewCandidate {
  authId: string;
  authIndex: string | null;
  usable: boolean;
  skipReason: string | null;
  weekly: RoutingPreviewWindow | null;
  fiveHour: RoutingPreviewWindow | null;
}

export interface RoutingPreview {
  strategy: string;
  provider: string;
  /** Bound sessions keep their credential; the preview describes new sessions. */
  sessionAffinity: boolean;
  authId: string | null;
  candidates: RoutingPreviewCandidate[];
}

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeWindow = (value: unknown): RoutingPreviewWindow | null => {
  if (!isRecord(value)) return null;
  const used = value.used_percent;
  const reset = typeof value.reset_at === 'string' ? Date.parse(value.reset_at) : NaN;
  return {
    usedPercent: typeof used === 'number' && Number.isFinite(used) ? used : null,
    resetAtMs: Number.isFinite(reset) ? reset : null,
  };
};

const normalizeCandidate = (value: unknown): RoutingPreviewCandidate | null => {
  if (!isRecord(value)) return null;
  const authId = readString(value.auth_id);
  if (!authId) return null;
  return {
    authId,
    authIndex: readString(value.auth_index) || null,
    usable: value.usable !== false,
    skipReason: readString(value.skip_reason) || null,
    weekly: normalizeWindow(value.weekly),
    fiveHour: normalizeWindow(value.five_hour),
  };
};

export const normalizeRoutingPreviews = (payload: unknown): RoutingPreview[] => {
  const previews = isRecord(payload) && Array.isArray(payload.previews) ? payload.previews : [];
  return previews.flatMap((value): RoutingPreview[] => {
    if (!isRecord(value)) return [];
    const provider = readString(value.provider).toLowerCase();
    if (!provider) return [];
    return [
      {
        strategy: readString(value.strategy),
        provider,
        sessionAffinity: value.session_affinity === true,
        authId: readString(value.auth_id) || null,
        candidates: Array.isArray(value.candidates)
          ? value.candidates
              .map(normalizeCandidate)
              .filter((candidate): candidate is RoutingPreviewCandidate => candidate !== null)
          : [],
      },
    ];
  });
};

const isNotFound = (error: unknown): boolean =>
  isRecord(error) && (error.status === 404 || error.statusCode === 404);

export const routingApi = {
  /**
   * Returns null when the backend has no routing preview (upstream CLIProxyAPI), so
   * the page can hide the feature instead of reporting an error.
   */
  next: async (): Promise<RoutingPreview[] | null> => {
    try {
      const payload = await apiClient.get<unknown>('/routing/next', {
        timeout: ROUTING_PREVIEW_TIMEOUT_MS,
      });
      return normalizeRoutingPreviews(payload);
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },
};
