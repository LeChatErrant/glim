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
