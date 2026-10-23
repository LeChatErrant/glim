import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from './hue/bridge';
import { hexHueSat } from './hue/color';

/** A color to offer as a swatch. */
export type Swatch = { name: string; hex: string };

/** Offered until the user has picked colors of their own. */
export const DEFAULT_SWATCHES: Swatch[] = [
  { name: 'Warm amber', hex: '#FFC27A' },
  { name: 'Ember', hex: '#FF9E6B' },
  { name: 'Rose', hex: '#FF6FB1' },
  { name: 'Violet', hex: '#8B7BFF' },
  { name: 'Lagoon', hex: '#6FC3FF' },
  { name: 'Sage', hex: '#9BE8B0' },
];

/** White temperature presets of the white dial. */
export const WHITE_PRESETS = [
  { name: 'Candle', kelvin: 2200 },
  { name: 'Warm', kelvin: 2700 },
  { name: 'Neutral', kelvin: 4000 },
  { name: 'Daylight', kelvin: 5500 },
  { name: 'Cool', kelvin: 6500 },
];

// Hue angle where each name ends.
const HUE_NAMES: [number, string][] = [
  [12, 'Red'],
  [28, 'Ember'],
  [44, 'Amber'],
  [62, 'Gold'],
  [85, 'Lime'],
  [150, 'Green'],
  [178, 'Teal'],
  [212, 'Lagoon'],
  [242, 'Blue'],
  [272, 'Violet'],
  [305, 'Magenta'],
  [342, 'Rose'],
  [360, 'Red'],
];

/** A short name for a color: "Amber", "Lagoon", "Pale amber" for soft tones. */
export function colorName(hex: string) {
  const known = DEFAULT_SWATCHES.find((s) => near(s.hex, hex));
  if (known) return known.name;
  const { hue, sat } = hexHueSat(hex);
  if (sat < 0.12) return 'White';
  const name = HUE_NAMES.find(([end]) => hue < end)?.[1] ?? 'Red';
  return sat < 0.45 ? `Pale ${name.toLowerCase()}` : name;
}

/** "Candlelight", "Warm white", … */
export function kelvinName(k: number) {
  if (k < 2450) return 'Candlelight';
  if (k < 3100) return 'Warm white';
  if (k < 3600) return 'Soft white';
  if (k < 4700) return 'Neutral white';
  if (k < 6000) return 'Daylight';
  return 'Cool white';
}

/** "2 700" (thin space thousands, as in the design). */
export const formatKelvin = (k: number) => String(k).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Two colors look the same on a light: close hue and saturation. Brightness is ignored, since the
 * bridge reports color without it, and saturation is loose: the bridge returns the color clamped to
 * the light's gamut, often more saturated than the one sent.
 */
export function near(a: string, b: string) {
  const x = hexHueSat(a);
  const y = hexHueSat(b);
  if (x.sat < 0.12 && y.sat < 0.12) return true;
  const d = Math.abs(x.hue - y.hue);
  return Math.min(d, 360 - d) < 8 && Math.abs(x.sat - y.sat) < 0.3;
}

const MAX_RECENT = 6;
const key = async () => `recent-colors:${(await getBridge())?.id ?? 'none'}`;

async function mine(k: string): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(k)) ?? '[]');
  } catch {
    return [];
  }
}

/** The last colors picked on this bridge, most recent first, padded with the defaults. */
export async function loadRecentColors(): Promise<Swatch[]> {
  const list: Swatch[] = (await mine(await key())).map((hex) => ({ hex, name: colorName(hex) }));
  for (const s of DEFAULT_SWATCHES) {
    if (list.length >= MAX_RECENT) break;
    if (!list.some((x) => near(x.hex, s.hex))) list.push(s);
  }
  return list.slice(0, MAX_RECENT);
}

export async function addRecentColor(hex: string): Promise<Swatch[]> {
  const k = await key();
  const next = [hex, ...(await mine(k)).filter((x) => !near(x, hex))].slice(0, MAX_RECENT);
  await AsyncStorage.setItem(k, JSON.stringify(next));
  return loadRecentColors();
}
