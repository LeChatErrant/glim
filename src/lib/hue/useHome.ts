import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Connection } from '../../ui/controls';
import { refreshAllWidgets } from '../../widgets/task-handler';
import type { Planned } from '../actions';
import { cachedSnapshot, fetchSnapshot, saveCachedSnapshot, type Snapshot } from './client';

/**
 * The home as the screens see it: last known state first, then polled from the bridge while the
 * screen is focused. `act` applies a planned change optimistically: the UI and widgets update at
 * once, the bridge follows. Polls are ignored while changes are in flight so they don't flicker back.
 */
export function useHome(intervalMs = 3000) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('home');
  const current = useRef<Snapshot | null>(null);
  const inFlight = useRef(0);

  const show = useCallback((s: Snapshot) => {
    current.current = s;
    setSnapshot(s);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchSnapshot();
      if (!inFlight.current) show(s);
      setConnection('home');
    } catch {
      // Cloud access comes later: off the home network, the bridge is out of reach.
      setConnection('offline');
    }
  }, [show]);

  useEffect(() => {
    cachedSnapshot().then((s) => s && !current.current && show(s));
  }, [show]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const t = setInterval(refresh, intervalMs);
      return () => clearInterval(t);
    }, [refresh, intervalMs]),
  );

  const act = useCallback(
    async (plan: (s: Snapshot) => Planned | null) => {
      const s = current.current ?? (await cachedSnapshot());
      const p = s && plan(s);
      if (!p) return;
      show(p.next);
      inFlight.current++;
      try {
        await saveCachedSnapshot(p.next);
        refreshAllWidgets(p.next).catch(() => null);
        await p.send();
      } catch {
        setConnection('offline');
      } finally {
        inFlight.current--;
      }
      if (!inFlight.current) {
        await refresh();
        refreshAllWidgets().catch(() => null);
      }
    },
    [refresh, show],
  );

  return { snapshot, connection, act, refresh };
}
