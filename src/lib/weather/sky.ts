// The outside around the map: the colors of the hour, recolored by the weather. Pure functions,
// shared by the app (Outside.tsx) and the map widget (scene.ts). Canvas:
// https://claude.ai/artifact/MKhL1BqDP4Peeh95xcXX2v ("Glim weather map").

export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'snow';
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow'];

export type RGB = [number, number, number];

/** Today's sunrise and sunset, in hours since local midnight. */
export type SunTimes = { rise: number; set: number };

/** A late-October day around 48°N, used until real sun times are known. */
export const DEFAULT_SUN: SunTimes = { rise: 7.4, set: 17.55 };

export type Sky = {
  weather: WeatherKind;
  /** The design clock: real time mapped so sunrise is 7.4 and sunset 17.55, whatever the season. */
  hour: number;
  /** Sun height in degrees on the design clock (negative below the horizon). */
  alt: number;
  /** 0 at sunrise, 1 at sunset (clamped). */
  arc: number;
  day: number;
  night: number;
  /** Low warm sun: sunrise and sunset light. */
  warm: number;
  /** How much the sky is covered (0 clear, ~1 storm). */
  cloud: number;
  wet: boolean;
  top: RGB;
  mid: RGB;
  low: RGB;
  near: RGB;
  far: RGB;
  vig: RGB;
  wash: RGB;
  washA: number;
  fog: RGB;
};

type Key = { top: RGB; mid: RGB; low: RGB; near: RGB; far: RGB; vig: RGB; wash: RGB; washA: number };

const NIGHT: Key = { top: [10, 14, 40], mid: [18, 24, 60], low: [32, 36, 82], near: [22, 30, 60], far: [11, 15, 34], vig: [3, 4, 12], wash: [150, 170, 235], washA: 0 };

// The colors of a clear sky through the day, on the design clock: sky top, middle, horizon,
// ground near the house, far ground, the dark beyond, and the sun's light.
const KEYS: [number, Key][] = [
  [0, NIGHT],
  [5.8, NIGHT],
  [6.7, { top: [22, 26, 70], mid: [64, 50, 112], low: [150, 96, 136], near: [44, 40, 76], far: [24, 22, 48], vig: [8, 8, 18], wash: [210, 150, 180], washA: 0.14 }],
  [7.6, { top: [54, 50, 114], mid: [196, 110, 142], low: [252, 170, 122], near: [124, 80, 96], far: [60, 42, 72], vig: [18, 12, 26], wash: [255, 178, 138], washA: 0.5 }],
  [9, { top: [86, 118, 172], mid: [176, 172, 194], low: [252, 216, 172], near: [108, 124, 90], far: [56, 70, 58], vig: [12, 16, 16], wash: [255, 226, 172], washA: 0.45 }],
  [12.5, { top: [92, 140, 202], mid: [154, 184, 214], low: [242, 228, 198], near: [122, 136, 86], far: [62, 78, 52], vig: [12, 16, 12], wash: [255, 244, 212], washA: 0.5 }],
  [15.3, { top: [100, 128, 192], mid: [180, 172, 192], low: [252, 214, 162], near: [130, 124, 76], far: [70, 66, 46], vig: [16, 14, 10], wash: [255, 228, 172], washA: 0.46 }],
  [16.6, { top: [94, 76, 152], mid: [234, 122, 112], low: [255, 172, 92], near: [154, 98, 60], far: [80, 48, 44], vig: [22, 12, 12], wash: [255, 170, 98], washA: 0.56 }],
  [17.5, { top: [58, 44, 112], mid: [180, 84, 132], low: [248, 122, 102], near: [104, 58, 86], far: [50, 30, 56], vig: [16, 8, 18], wash: [255, 132, 112], washA: 0.46 }],
  [18.3, { top: [24, 30, 82], mid: [62, 56, 122], low: [112, 82, 142], near: [38, 42, 82], far: [20, 22, 48], vig: [6, 7, 16], wash: [160, 140, 210], washA: 0.1 }],
  [20, NIGHT],
  [24, NIGHT],
];

const COVER: Record<WeatherKind, number> = { clear: 0, cloudy: 0.75, fog: 0.6, rain: 0.85, storm: 0.95, snow: 0.7 };

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c: RGB, m: RGB): RGB => [c[0] * m[0], c[1] * m[1], c[2] * m[2]];
const desat = (c: RGB, t: number): RGB => {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return mix(c, [l, l, l], t);
};
export const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))},${clamp(a, 0, 1).toFixed(3)})`;

/** Real clock time (hours since midnight) to the design clock the colors are written for. */
export function designHour(h: number, sun: SunTimes = DEFAULT_SUN) {
  const { rise, set } = sun;
  if (h >= rise && h <= set) return DEFAULT_SUN.rise + ((h - rise) / (set - rise)) * (DEFAULT_SUN.set - DEFAULT_SUN.rise);
  if (h < rise) return clamp(DEFAULT_SUN.rise - (rise - h), 0, DEFAULT_SUN.rise);
  return clamp(DEFAULT_SUN.set + (h - set), DEFAULT_SUN.set, 24);
}

/** The other way: a moment on the design clock (golden hour is 16.6) to today's clock time. */
export function clockHourFor(design: number, sun: SunTimes = DEFAULT_SUN) {
  const { rise, set } = DEFAULT_SUN;
  if (design >= rise && design <= set) return sun.rise + ((design - rise) / (set - rise)) * (sun.set - sun.rise);
  if (design < rise) return Math.max(0, sun.rise - (rise - design));
  return Math.min(23.99, sun.set + (design - set));
}

/** Moments of the day worth jumping to, on the design clock. */
export const MOMENTS: { label: string; design: number }[] = [
  { label: 'Sunrise', design: 7.6 },
  { label: 'Morning', design: 9 },
  { label: 'Noon', design: 12.5 },
  { label: 'Golden hour', design: 16.6 },
  { label: 'Sunset', design: 17.5 },
  { label: 'Blue hour', design: 18.3 },
  { label: 'Night', design: 22 },
];

/** The sky for a weather at a real clock time (hours since midnight). */
export function skyAt(weather: WeatherKind, clockHour: number, sun: SunTimes = DEFAULT_SUN): Sky {
  const hour = designHour(((clockHour % 24) + 24) % 24, sun);
  const { rise: RISE, set: SET } = DEFAULT_SUN;
  const frac = (hour - RISE) / (SET - RISE);
  const alt = frac >= 0 && frac <= 1 ? 28 * Math.sin(Math.PI * frac) : -Math.min(18, (hour < RISE ? RISE - hour : hour - SET) * 11);
  const day = smooth(-6, 10, alt);
  const night = 1 - smooth(-10, -1, alt);
  const warm = alt > -5 ? 1 - smooth(2, 16, alt) : 0;
  const cloud = COVER[weather];

  let i = 0;
  while (i < KEYS.length - 2 && hour > KEYS[i + 1][0]) i++;
  const [ha, a] = KEYS[i];
  const [hb, b] = KEYS[i + 1];
  const t = smooth(0, 1, (hour - ha) / (hb - ha || 1));
  const key = (k: Exclude<keyof Key, 'washA'>) => mix(a[k], b[k], t);

  // The weather recolors the hour: grey, rain-teal, storm-violet, snow-blue, fog-pale.
  const fog = mix([60, 62, 72], [176, 176, 172], day);
  const snow = mix([54, 66, 108], [198, 206, 224], day);
  const wx = (c: RGB, sky = false): RGB => {
    switch (weather) {
      case 'cloudy':
        return mul(desat(c, 0.6), [0.84, 0.84, 0.88]);
      case 'rain':
        return mul(desat(c, 0.5), [0.72, 0.86, 1.02]);
      case 'storm':
        return mul(desat(c, 0.6), [0.62, 0.6, 0.84]);
      case 'snow':
        return mix(desat(c, 0.45), snow, sky ? 0.35 : 0.55);
      case 'fog':
        return mix(c, fog, 0.75);
      default:
        return c;
    }
  };
  const vig = key('vig');
  return {
    weather,
    hour,
    alt,
    arc: clamp(frac, 0, 1),
    day,
    night,
    warm,
    cloud,
    wet: weather === 'rain' || weather === 'storm',
    top: wx(key('top'), true),
    mid: wx(key('mid'), true),
    low: wx(key('low'), true),
    near: wx(key('near')),
    far: wx(key('far')),
    vig: weather === 'fog' ? mix(vig, mul(fog, [0.82, 0.82, 0.82]), 0.92) : wx(vig),
    wash: key('wash'),
    washA: (a.washA + (b.washA - a.washA) * t) * (1 - cloud * 0.85),
    fog,
  };
}

/** Small deterministic random numbers, so particles stay put between renders. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
