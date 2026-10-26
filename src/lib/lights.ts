import type { Light, Room, Snapshot } from './hue/client';

/**
 * What a light is, from what the user said it looks like (the Hue device archetype). Drives its
 * icon and its glow. Unknown archetypes fall back to a bulb.
 */
export type LightType = 'pendant' | 'ceiling' | 'bulb' | 'candle' | 'spot' | 'go' | 'table' | 'floor' | 'bar' | 'strip' | 'string' | 'lantern' | 'plug';

export function lightType(archetype: string): LightType {
  const a = archetype.toLowerCase();
  if (a === 'plug') return 'plug';
  if (a.startsWith('pendant') || a === 'chandelier') return 'pendant';
  if (a.startsWith('ceiling') || a.includes('flush') || a === 'recessed_ceiling') return 'ceiling';
  if (a.includes('candle')) return 'candle';
  if (a.includes('spot') || a === 'recessed_floor') return 'spot';
  if (a === 'hue_go' || a === 'hue_iris' || a === 'hue_bloom') return 'go';
  if (a.includes('table') || a === 'flexible_lamp') return 'table';
  if (a.includes('floor') || a.startsWith('up_and_down') || a === 'hue_signe') return 'floor';
  if (a.includes('lightstrip') || a === 'hue_neon' || a === 'hue_omniglow') return 'strip';
  if (a.startsWith('hue_play') || a.includes('bar') || a === 'hue_tube' || a === 'hue_centris' || a === 'wall_washer') return 'bar';
  if (a.includes('string') || a.includes('christmas') || a.includes('festavia')) return 'string';
  if (a.includes('wall') || a.includes('lantern') || a.includes('flood') || a.includes('pedestal') || a.includes('bollard') || a.includes('garden') || a.startsWith('twilight')) return 'lantern';
  return 'bulb';
}

/** Types offered in "What is it?", with the Hue archetype written to the bridge for each. */
export const LIGHT_TYPES: { type: LightType; label: string; archetype: string }[] = [
  { type: 'pendant', label: 'Pendant', archetype: 'pendant_round' },
  { type: 'ceiling', label: 'Ceiling light', archetype: 'ceiling_round' },
  { type: 'bulb', label: 'Bulb', archetype: 'classic_bulb' },
  { type: 'candle', label: 'Candle bulb', archetype: 'candle_bulb' },
  { type: 'spot', label: 'Spot', archetype: 'single_spot' },
  { type: 'go', label: 'Portable lamp', archetype: 'hue_go' },
  { type: 'table', label: 'Table lamp', archetype: 'table_shade' },
  { type: 'floor', label: 'Floor lamp', archetype: 'floor_shade' },
  { type: 'bar', label: 'Light bar', archetype: 'hue_play' },
  { type: 'strip', label: 'Lightstrip', archetype: 'hue_lightstrip' },
  { type: 'string', label: 'String lights', archetype: 'string_light' },
  { type: 'lantern', label: 'Wall lantern', archetype: 'wall_lantern' },
  { type: 'plug', label: 'Smart plug', archetype: 'plug' },
];

const TYPE_LABEL = Object.fromEntries(LIGHT_TYPES.map((t) => [t.type, t.label])) as Record<LightType, string>;

/** A smart plug (from the hardware, not the name): whatever is plugged in only turns on and off. */
export const isPlug = (l: Light) => l.plug ?? l.kind === 'onoff';

/** How a light glows on the map: each shape casts its own pool (Nocturne design). */
export type LightShape = 'pendant' | 'bulb' | 'portable' | 'bar' | 'string' | 'lantern';

const SHAPE: Record<LightType, LightShape> = {
  pendant: 'pendant',
  ceiling: 'pendant',
  bulb: 'bulb',
  candle: 'bulb',
  spot: 'bulb',
  plug: 'bulb',
  go: 'portable',
  table: 'portable',
  floor: 'portable',
  bar: 'bar',
  strip: 'bar',
  string: 'string',
  lantern: 'lantern',
};

export const lightShape = (archetype: string): LightShape => SHAPE[lightType(archetype)];

/** "Pendant", "String lights · plug", "Smart plug". */
export function lightTypeLabel(light: Light) {
  const type = lightType(light.archetype);
  if (!isPlug(light) || type === 'plug') return TYPE_LABEL[type];
  // A plug's type is whatever the user said is plugged into it.
  return `${TYPE_LABEL[type]} · plug`;
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
