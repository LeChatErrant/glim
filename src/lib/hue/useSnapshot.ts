import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { cachedSnapshot, fetchSnapshot, type Snapshot } from './client';

/** Live-ish view of the bridge: cached state first, then polls while the screen is focused. */
export function useSnapshot(intervalMs = 3000) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await fetchSnapshot());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    cachedSnapshot().then((s) => s && setSnapshot((cur) => cur ?? s));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const t = setInterval(refresh, intervalMs);
      return () => clearInterval(t);
    }, [refresh, intervalMs]),
  );

  return { snapshot, setSnapshot, error, refresh };
}
