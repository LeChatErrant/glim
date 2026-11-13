import { hexHueSat, kelvinTint, mirekToHex } from './hue/color';

/** A color (hex) or a white (kelvin), as picked for a map-aware mood. */
export type Tint = { hex?: string; kelvin?: number };

/** How a tint looks on screen (dots, previews). */
export const tintHex = (t: Tint) => t.hex ?? kelvinTint(t.kelvin ?? 2700);

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
};
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/**
 * Mixes two colors as light mixes (in linear light), then brings it back to full strength:
 * brightness is the mood's job, so red to blue goes through a vivid magenta, not a dim purple.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = rgb(a).map(lin);
  const cb = rgb(b).map(lin);
  const m = ca.map((v, i) => v + (cb[i] - v) * t);
  const top = Math.max(...m);
  const want = Math.max(...ca) + (Math.max(...cb) - Math.max(...ca)) * t;
  const k = top > 0 ? want / top : 1;
  return `#${m.map((v) => hex2(gam(Math.min(1, v * k)))).join('')}`;
}

/** The light's own color of a tint: a white as its blackbody color (to mix with colors). */
const lightHex = (t: Tint) => t.hex ?? mirekToHex(1_000_000 / (t.kelvin ?? 2700));

/**
 * A point along a gradient of 2 or 3 tints (t from 0 to 1). Whites only: a white in between
 * (mixed in mirek, as the eye sees it). With a color in it: a color.
 */
export function tintAt(tints: Tint[], t: number): Tint {
  if (!tints.length) return { kelvin: 2700 };
  if (tints.length === 1) return tints[0];
  const x = Math.max(0, Math.min(1, t)) * (tints.length - 1);
  const i = Math.min(tints.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [tints[i], tints[i + 1]];
  if (a.kelvin && b.kelvin && !a.hex && !b.hex) {
    const m = 1_000_000 / a.kelvin + (1_000_000 / b.kelvin - 1_000_000 / a.kelvin) * f;
    return { kelvin: Math.round(1_000_000 / m / 50) * 50 };
  }
  return { hex: mixHex(lightHex(a), lightHex(b), f) };
}

/**
 * The white closest in feel to a color, for lights that only do whites: warm colors (reds,
 * ambers, rose) give candlelight, greens a neutral white, blues and violets a cool one.
 */
export function whiteFor(hex: string): number {
  const { hue, sat } = hexHueSat(hex);
  if (sat < 0.15) return 4000;
  if (hue < 70 || hue >= 320) return 2200;
  if (hue < 170) return 4000;
  return 6500;
}
