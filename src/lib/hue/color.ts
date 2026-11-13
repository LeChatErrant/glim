/** Converts Hue colors (CIE xy or mirek) to sRGB hex, for display only. */

function gamma(v: number) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function toHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function xyToHex(x: number, y: number): string {
  if (y <= 0) return '#ffffff';
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const max = Math.max(r, g, b);
  if (max > 1) {
    r /= max;
    g /= max;
    b /= max;
  }
  return toHex(gamma(Math.max(0, r)), gamma(Math.max(0, g)), gamma(Math.max(0, b)));
}

/** Approximate blackbody color (Tanner Helland's fit). */
export function mirekToHex(mirek: number): string {
  const t = 1_000_000 / mirek / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return toHex(r / 255, g / 255, b / 255);
}

/** Warm white used for on/off plugs and lights without color info. */
export const PLUG_ON_COLOR = '#ffc46b';

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function linear(v: number) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB hex to CIE xy for the bridge (wide-gamut matrix; the bridge clamps to each light's gamut). */
export function hexToXy(hex: string): { x: number; y: number } {
  const [r, g, b] = hexRgb(hex).map(linear);
  const X = r * 0.649926 + g * 0.103455 + b * 0.197109;
  const Y = r * 0.234327 + g * 0.743075 + b * 0.022598;
  const Z = g * 0.053077 + b * 1.035763;
  const sum = X + Y + Z;
  if (!sum) return { x: 0.3227, y: 0.329 };
  return { x: Math.round((X / sum) * 10000) / 10000, y: Math.round((Y / sum) * 10000) / 10000 };
}

/** Hue in degrees (0–360) and saturation (0–1) of a hex color. */
export function hexHueSat(hex: string): { hue: number; sat: number } {
  const [r, g, b] = hexRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return { hue: 0, sat: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat: d / max };
}

/** HSV to hex. */
export function hsvHex(hue: number, sat: number, val = 1): string {
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return toHex(f(5), f(3), f(1));
}

/** Kelvin range of the white dial. */
export const KELVIN_MIN = 2200;
export const KELVIN_MAX = 6500;

const KELVIN_TINTS: [number, [number, number, number]][] = [
  [2200, [255, 154, 60]],
  [2700, [255, 184, 104]],
  [3300, [255, 213, 158]],
  [4000, [255, 240, 218]],
  [5000, [243, 242, 238]],
  [6500, [220, 235, 255]],
];

/** How a white temperature looks on screen (softer than the blackbody fit, as in the design). */
export function kelvinTint(k: number): string {
  for (let i = 0; i < KELVIN_TINTS.length - 1; i++) {
    const [k0, c0] = KELVIN_TINTS[i];
    const [k1, c1] = KELVIN_TINTS[i + 1];
    if (k <= k1) {
      const t = Math.max(0, (k - k0) / (k1 - k0));
      return toHex(...(c0.map((v, j) => (v + (c1[j] - v) * t) / 255) as [number, number, number]));
    }
  }
  return '#dcebff';
}

export const kelvinToMirek = (k: number) => Math.round(1_000_000 / k);
export const mirekToKelvin = (m: number) => Math.round(1_000_000 / m);

// Hue's gamut C (current color lights): red, green, blue corners in CIE xy.
const GAMUT_C: [number, number][] = [
  [0.6915, 0.3083],
  [0.17, 0.7],
  [0.1532, 0.0475],
];

/**
 * How a color sent to a color light can come back, to tell whether the light shows it: as sent
 * through xy (right after a command the bridge echoes what it got), and clamped to the gamut's
 * nearest edge (once the light took it: a pure red reads back orange-red). Gamut C; older lights
 * differ a little.
 */
export function readbackHexes(hex: string): string[] {
  const { x, y } = hexToXy(hex);
  return [...new Set([hex, xyToHex(x, y), gamutHex(hex)])];
}

/** A color clamped to Hue's gamut C, as the bridge reports it once the light took it. */
export function gamutHex(hex: string): string {
  const { x, y } = hexToXy(hex);
  const [a, b, c] = GAMUT_C;
  const side = (p: [number, number], q: [number, number]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  if (side(a, b) >= 0 && side(b, c) >= 0 && side(c, a) >= 0) return xyToHex(x, y);
  let best: [number, number] = [x, y];
  let d = Infinity;
  for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy)));
    const pt: [number, number] = [p[0] + dx * t, p[1] + dy * t];
    const dd = (pt[0] - x) ** 2 + (pt[1] - y) ** 2;
    if (dd < d) [d, best] = [dd, pt];
  }
  return xyToHex(best[0], best[1]);
}
