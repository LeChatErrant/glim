import { useEffect, useRef, useState } from 'react';

import type { Light } from '../lib/hue/client';

const DURATION = 300;

type Look = { level: number; bri: number; rgb: [number, number, number] };

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = ([r, g, b]: number[]) => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
const lookOf = (l: Light): Look => ({ level: l.on && l.reachable ? 1 : 0, bri: l.brightness ?? 100, rgb: rgbOf(l.color) });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Lights as they should be drawn right now: when one turns on or off, dims or changes color, its
 * glow eases there in about 300 ms instead of jumping (Nocturne motion). `fade` (0–1) is how
 * lit each glow is; a light fading out still reads as on until it's dark.
 */
export function useLightTween(lights: Light[]) {
  const shown = useRef(new Map<string, Look>());
  const [frame, setFrame] = useState<{ lights: Light[]; fade: Map<string, number> }>(() => ({
    lights,
    fade: new Map(lights.map((l) => [l.id, lookOf(l).level])),
  }));

  useEffect(() => {
    const from = new Map(lights.map((l) => [l.id, shown.current.get(l.id) ?? lookOf(l)]));
    const to = new Map(lights.map((l) => [l.id, lookOf(l)]));
    const same = (a: Look, b: Look) => a.level === b.level && a.bri === b.bri && a.rgb.every((c, i) => Math.abs(c - b.rgb[i]) < 1);
    // A poll that changed nothing: no animation, just the new objects.
    if (lights.every((l) => same(from.get(l.id)!, to.get(l.id)!))) {
      lights.forEach((l) => shown.current.set(l.id, to.get(l.id)!));
      const id = requestAnimationFrame(() => setFrame({ lights, fade: new Map(lights.map((l) => [l.id, to.get(l.id)!.level])) }));
      return () => cancelAnimationFrame(id);
    }
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / DURATION);
      const e = 1 - (1 - t) ** 3;
      const fade = new Map<string, number>();
      const out = lights.map((l) => {
        const a = from.get(l.id)!;
        const b = to.get(l.id)!;
        const now: Look = { level: mix(a.level, b.level, e), bri: mix(a.bri, b.bri, e), rgb: [0, 1, 2].map((i) => mix(a.rgb[i], b.rgb[i], e)) as Look['rgb'] };
        shown.current.set(l.id, now);
        fade.set(l.id, now.level);
        if (t >= 1) return l;
        return { ...l, on: l.on || now.level > 0.01, brightness: l.brightness === null ? null : Math.round(now.bri), color: hexOf(now.rgb) };
      });
      setFrame({ lights: out, fade });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [lights]);

  return frame;
}
