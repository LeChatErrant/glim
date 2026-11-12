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
  /** The ground by the walls, and further out: the light of the hour, recolored by the weather. */
  near: RGB;
  far: RGB;
  /** The sun's light. */
  wash: RGB;
  washA: number;
  /** The light of fog and overcast: fog banks, the wisps of a pearl sky, mist on outdoor floors. */
  fog: RGB;
  /** What lies past the band around the house: null is the screen's own black (fog: the fog). */
  beyond: RGB | null;
};

type Key = { near: RGB; far: RGB; wash: RGB; washA: number };

const NIGHT: Key = { near: [15, 19, 47], far: [9, 13, 33], wash: [150, 170, 235], washA: 0 };

// The ground around the house under a clear sky, through the day, on the design clock: by the
// walls, further out, and the sun's light. Always saturated (a grey-ish hour reads as fog):
// rose sunrise, periwinkle, aqua morning, cerulean noon, violet, coral golden hour, plum sunset.
const KEYS: [number, Key][] = [
  [0, NIGHT],
  [5.8, NIGHT],
  [6.7, { near: [62, 44, 85], far: [29, 25, 60], wash: [210, 150, 180], washA: 0.14 }],
  [7.6, { near: [151, 90, 99], far: [86, 54, 84], wash: [255, 178, 138], washA: 0.5 }],
  [8.3, { near: [112, 116, 176], far: [48, 54, 116], wash: [255, 210, 170], washA: 0.48 }],
  [9, { near: [64, 150, 158], far: [22, 74, 104], wash: [255, 226, 172], washA: 0.45 }],
  [12.5, { near: [44, 124, 204], far: [18, 52, 124], wash: [255, 244, 212], washA: 0.5 }],
  [15.3, { near: [52, 116, 186], far: [22, 50, 118], wash: [255, 228, 172], washA: 0.46 }],
  [16, { near: [120, 92, 150], far: [58, 46, 104], wash: [255, 200, 140], washA: 0.5 }],
  [16.6, { near: [172, 97, 77], far: [111, 66, 84], wash: [255, 170, 98], washA: 0.56 }],
  [17.5, { near: [142, 67, 90], far: [81, 43, 80], wash: [255, 132, 112], washA: 0.46 }],
  [18.3, { near: [54, 45, 91], far: [29, 29, 67], wash: [160, 140, 210], washA: 0.1 }],
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
export const dim = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
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
  const near = key('near');
  const far = key('far');

  // Fog and overcast take the hour's light: milky white by day, peach in a low sun, blue-grey
  // at night (lit by the lamps).
  const fog = weather === 'cloudy' ? mix([50, 56, 80], mix([196, 206, 220], [216, 182, 170], warm), day) : mix([84, 90, 112], mix([224, 223, 220], [240, 204, 178], warm), day);
  // Storm-violet: recolor the sky's light (the ground is it, dimmed by `k`), then dim again,
  // darker under a thick sky.
  const recolor = (c: RGB, k: number): RGB => dim(mul(desat(dim(c, 1 / k), 0.6), [0.62, 0.6, 0.84]), k * (1 - 0.3 * cloud));
  // In a low sun, fog and a pearl sky keep the hour's rose and lilac instead of greying it.
  const glow = mix(mix(near, [255, 255, 255], 0.45), [230, 170, 200], 0.3);
  const veil = mix(fog, glow, warm);
  let ground: [RGB, RGB];
  switch (weather) {
    case 'clear':
      ground = [near, far];
      break;
    // A pearl sky: bright and silvery, still tinted by the hour; rosy in a low sun.
    case 'cloudy':
      ground = [dim(mix(near, veil, 0.55 - 0.1 * warm), 0.84 + 0.06 * warm), dim(mix(far, veil, 0.55 - 0.1 * warm), 0.6 + 0.06 * warm)];
      break;
    // A milky veil: the world past the house dissolves into it; pink at sunrise, violet at sunset.
    case 'fog':
      ground = [dim(mix(near, veil, 0.5 - 0.12 * warm), 0.8 + 0.1 * warm), dim(mix(far, veil, 0.72 - 0.07 * warm), 0.82 + 0.04 * warm)];
      break;
    // A snow cover that takes the hour's light: rose at sunrise, white at noon, gold at golden
    // hour, a blue glow at night.
    case 'snow': {
      const cover = mix([62, 78, 128], mix([236, 240, 248], [250, 214, 182], warm), day);
      ground = [dim(mix(cover, near, 0.22), 0.92), dim(mix(cover, far, 0.4), 0.62)];
      break;
    }
    // Ink blue rain: a deep blue-teal at every hour, with a touch of the hour's color.
    case 'rain': {
      const ink = mix([16, 26, 50], [36, 86, 116], day);
      ground = [mix(ink, near, 0.3), dim(mix(ink, far, 0.3), 0.6)];
      break;
    }
    default:
      ground = [recolor(near, 0.72), recolor(far, 0.648)];
  }
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
    near: ground[0],
    far: ground[1],
    wash: key('wash'),
    washA: (a.washA + (b.washA - a.washA) * t) * (1 - cloud * 0.85),
    fog: weather === 'fog' || weather === 'cloudy' ? veil : fog,
    beyond: weather === 'fog' ? dim(veil, 0.8) : null,
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
