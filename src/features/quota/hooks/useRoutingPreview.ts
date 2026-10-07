import { useEffect, useState } from 'react';
import { apiClient, routingApi, type RoutingPreview } from '@/services/api';

/**
 * Next-pick preview per provider from the CLIProxyAPI fork. Returns null while
 * loading, on errors, and on backends without the endpoint.
 */
export function useRoutingPreview(enabled: boolean, refreshKey: number): RoutingPreview[] | null {
  const [previews, setPreviews] = useState<RoutingPreview[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () => !cancelled && revision === apiClient.getConnectionRevision();
    routingApi
      .next()
      .then((result) => {
        if (isCurrent()) setPreviews(result);
      })
      .catch(() => {
        if (isCurrent()) setPreviews(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  return enabled ? previews : null;
}
