import type { Light, Room, Snapshot } from './hue/client';

/**
 * How a light looks on the map: each shape casts its own glow (Nocturne design).
 * Unknown types fall back to a bulb.
 */
export type LightShape = 'pendant' | 'bulb' | 'portable' | 'bar' | 'string' | 'lantern';

export function lightShape(archetype: string): LightShape {
  const a = archetype.toLowerCase();
  if (a.startsWith('pendant') || a.startsWith('ceiling') || a === 'chandelier' || a.includes('flush')) return 'pendant';
  if (a === 'hue_go' || a.includes('table') || a.includes('floor') || a === 'hue_iris' || a === 'hue_signe') return 'portable';
  if (a === 'hue_play' || a.includes('lightstrip') || a.includes('bar') || a === 'hue_tube' || a === 'hue_centris') return 'bar';
  if (a.includes('string') || a.includes('christmas') || a.includes('festavia')) return 'string';
  if (a.includes('wall') || a.includes('lantern') || a.includes('flood') || a.includes('pedestal') || a.includes('bollard') || a.includes('garden')) return 'lantern';
  return 'bulb';
}

const SHAPE_LABEL: Record<LightShape, string> = {
  pendant: 'Pendant',
  bulb: 'Bulb',
  portable: 'Portable lamp',
  bar: 'Light bar',
  string: 'String lights',
  lantern: 'Wall lantern',
};

/** "Pendant", "String lights · plug", "Plug". */
export function lightTypeLabel(light: Light) {
  const shape = lightShape(light.archetype);
  if (light.kind !== 'onoff') return SHAPE_LABEL[shape];
  // A plug's type is whatever the user said is plugged into it; a plain plug reads as "bulb".
  return shape === 'bulb' ? 'Plug' : `${SHAPE_LABEL[shape]} · plug`;
}

/** Level shown next to a light: "62%", "On", "Off", "Unreachable". */
export function lightLevel(light: Light) {
  if (!light.reachable) return 'Unreachable';
  if (!light.on) return 'Off';
  return light.brightness === null ? 'On' : `${light.brightness}%`;
}

/** Lights that count: reachable ones (unreachable lights report a stale state). */
export const isLit = (l: Light) => l.on && l.reachable;

export function lightsOf(room: Room, s: Snapshot) {
  return s.lights.filter((l) => room.lightIds.includes(l.id));
}

/** Average brightness of the lit, dimmable lights; null if none. */
export function averageBrightness(lights: Light[]) {
  const dim = lights.filter((l) => isLit(l) && l.brightness !== null);
  return dim.length ? Math.round(dim.reduce((s, l) => s + l.brightness!, 0) / dim.length) : null;
}

/** Average white temperature in kelvin of the lit lights in white mode, rounded to 100 K. */
export function ambienceKelvin(lights: Light[]) {
  const ct = lights.filter((l) => isLit(l) && l.mirek);
  if (!ct.length) return null;
  const k = ct.reduce((s, l) => s + 1_000_000 / l.mirek!, 0) / ct.length;
  return Math.round(k / 100) * 100;
}

function hexRgb(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The headline word: "The house is …". */
export function houseMood(lights: Light[]) {
  const reachable = lights.filter((l) => l.reachable);
  const lit = reachable.filter((l) => l.on);
  if (!lit.length) return 'asleep';
  const colorful = lit.filter((l) => {
    const [r, g, b] = hexRgb(l.color);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Saturated, and not on the warm white axis.
    return max > 0 && (max - min) / max > 0.5 && b > g * 0.9;
  });
  if (colorful.length * 2 >= lit.length) return 'full of color';
  const avg = averageBrightness(lit);
  if (lit.length * 3 <= reachable.length || (avg !== null && avg < 35)) return 'softly lit';
  const cool = lit.filter((l) => {
    const [r, , b] = hexRgb(l.color);
    return b >= r * 0.95;
  });
  return cool.length * 2 > lit.length ? 'brightly lit' : 'warmly lit';
}
