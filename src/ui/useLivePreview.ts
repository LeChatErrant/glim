import { useEffect, useRef, useState } from 'react';

import type { Snapshot } from '../lib/hue/client';
import { actHome } from '../lib/hue/useHome';
import { captureLights, planLights, type MoodLight } from '../lib/moods';

/**
 * Live preview of a mood being edited: the real lights follow each change. Starting captures
 * how every light looks; stopping (or leaving the screen without keeping it) puts them back.
 * Only the lights whose look changed are sent, a quarter of a second after the last change.
 */
export function useLivePreview(snapshot: Snapshot | null, lights: MoodLight[]) {
  const [live, setLive] = useState(false);
  const before = useRef<Map<string, MoodLight> | null>(null);
  const sent = useRef(new Map<string, string>());
  const kept = useRef(false);

  const send = (next: MoodLight[]) => {
    const now = new Map(next.map((m) => [m.lightId, m]));
    // Lights the mood no longer sets go back to how they were (target changed, left out).
    for (const id of sent.current.keys()) if (!now.has(id) && before.current?.has(id)) now.set(id, before.current.get(id)!);
    const changed = [...now.values()].filter((m) => sent.current.get(m.lightId) !== JSON.stringify(m));
    for (const m of changed) sent.current.set(m.lightId, JSON.stringify(m));
    for (const id of [...sent.current.keys()]) if (!now.has(id)) sent.current.delete(id);
    if (changed.length) actHome((s) => planLights(s, changed));
  };

  const latest = useRef({ send, lights, live });
  useEffect(() => {
    latest.current = { send, lights, live };
  });
  const key = JSON.stringify(lights);
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => latest.current.send(latest.current.lights), 250);
    return () => clearTimeout(t);
  }, [live, key]);

  const putBack = () => {
    const b = before.current;
    if (b) actHome((s) => planLights(s, [...b.values()]));
    before.current = null;
    sent.current.clear();
  };

  // Leaving without keeping the mood puts the lights back.
  useEffect(
    () => () => {
      if (latest.current.live && !kept.current) putBack();
    },
    [],
  );

  return {
    live,
    start: () => {
      if (!snapshot) return;
      kept.current = false;
      if (!before.current) before.current = new Map(captureLights(snapshot.lights).map((m) => [m.lightId, m]));
      sent.current.clear();
      send(lights);
      setLive(true);
    },
    stop: () => {
      putBack();
      setLive(false);
    },
    /** The mood was saved: the lights keep it. */
    keep: () => {
      kept.current = true;
      before.current = null;
      setLive(false);
    },
  };
}
