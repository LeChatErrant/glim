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
  /**
   * What lies past the band around the house: a deep shade of the hour's far color (navy at
   * noon, plum at golden hour, near black at night), or the fog's own color.
   */
  beyond: RGB;
};

type Key = { near: RGB; far: RGB; wash: RGB; washA: number };

const NIGHT: Key = { near: [30, 44, 96], far: [8, 10, 30], wash: [150, 170, 235], washA: 0 };

// The ground around the house under a clear sky, through the day, on the design clock: by the
// walls (the horizon's color), further out (the zenith's), and the sun's light. "Two-tone
// skies", picked from https://claude.ai/artifact/6FhBExVDbYTHiBnnaN7Qa1: apricot to periwinkle
// at sunrise, mint to blue, bright sky to deep blue, gold to magenta, coral to indigo.
const KEYS: [number, Key][] = [
  [0, NIGHT],
  [5.8, NIGHT],
  [6.7, { near: [96, 70, 120], far: [26, 26, 72], wash: [210, 150, 180], washA: 0.14 }],
  [7.6, { near: [240, 168, 120], far: [92, 90, 168], wash: [255, 178, 138], washA: 0.5 }],
  [8.3, { near: [206, 192, 162], far: [74, 108, 182], wash: [255, 210, 170], washA: 0.48 }],
  [9, { near: [168, 210, 196], far: [60, 130, 192], wash: [255, 226, 172], washA: 0.45 }],
  [12.5, { near: [110, 190, 230], far: [30, 80, 180], wash: [255, 244, 212], washA: 0.5 }],
  [15.3, { near: [122, 184, 222], far: [36, 76, 172], wash: [255, 228, 172], washA: 0.46 }],
  [16, { near: [200, 176, 164], far: [100, 74, 156], wash: [255, 200, 140], washA: 0.5 }],
  [16.6, { near: [255, 180, 90], far: [160, 80, 122], wash: [255, 170, 98], washA: 0.56 }],
  [17.5, { near: [238, 110, 90], far: [70, 50, 130], wash: [255, 132, 112], washA: 0.46 }],
  [18.3, { near: [122, 110, 200], far: [24, 30, 90], wash: [160, 140, 210], washA: 0.1 }],
  [20, NIGHT],
  [24, NIGHT],
];

/** Hours of the moments (sunrise, morning, noon, golden hour, sunset, blue hour, night) on the design clock. */
const AT = [7.6, 9, 12.5, 16.6, 17.5, 18.3];

/**
 * A weather's own ground, written color by color (greying the clear sky turned warm hours to
 * mud): [near, far] in hex at sunrise, morning, noon, golden hour, sunset, blue hour, night.
 * Noon holds through the afternoon; night holds from 20:00 to dawn.
 */
function own(pairs: [string, string][]): [number, RGB, RGB][] {
  const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const c = pairs.map(([a, b]) => [hex(a), hex(b)] as const);
  const night = c[6];
  return [
    [0, ...night],
    [5.8, ...night],
    ...AT.slice(0, 3).map((h, i) => [h, ...c[i]] as [number, RGB, RGB]),
    [15.3, ...c[2]],
    ...AT.slice(3).map((h, i) => [h, ...c[i + 3]] as [number, RGB, RGB]),
    [20, ...night],
    [24, ...night],
  ];
}

/** Cloudy: a low ceiling, an even slate, warm only by the house. */
const CEILING = own([['#B4868A', '#4C5674'], ['#8AA4AE', '#465C70'], ['#8EA6C0', '#4A5E7A'], ['#C09A7C', '#4E5470'], ['#A87484', '#3E4462'], ['#4E5078', '#262A46'], ['#262C44', '#12162A']]);
/** Storm: charcoal blue, the lamps and the lightning carry the scene. */
const CHARCOAL = own([['#3E3A4A', '#14161E'], ['#2C3A4C', '#10161E'], ['#2E3E54', '#101820'], ['#463E44', '#16161E'], ['#3A3040', '#121218'], ['#1C2232', '#0A0C14'], ['#0A0E16', '#040508']]);
/** Snow: icy blue, pink-lavender at low sun, cobalt at night. */
const ICE = own([['#B8B4D8', '#5E6AA0'], ['#A8D0E0', '#4C7CA8'], ['#B0D4EE', '#4C78B4'], ['#E0C4C0', '#7C7CB0'], ['#C0A0C8', '#4E4E8C'], ['#6670B0', '#262E64'], ['#2C3E72', '#101A3C']]);
/** Fog: the deep blue mist's own color through the day (the ground mixes it with the clear sky). */
const MIST = own([['#8278B4', '#8278B4'], ['#648CBE', '#648CBE'], ['#6492C8', '#6492C8'], ['#9678AA', '#9678AA'], ['#7860A0', '#7860A0'], ['#384082', '#384082'], ['#1E285A', '#1E285A']]);

/** A table's [near, far] at `hour`, eased between its keys. */
function at(table: [number, RGB, RGB][], hour: number): [RGB, RGB] {
  let i = 0;
  while (i < table.length - 2 && hour > table[i + 1][0]) i++;
  const [ha, an, af] = table[i];
  const [hb, bn, bf] = table[i + 1];
  const t = smooth(0, 1, (hour - ha) / (hb - ha || 1));
  return [mix(an, bn, t), mix(af, bf, t)];
}

const COVER: Record<WeatherKind, number> = { clear: 0, cloudy: 0.75, fog: 0.6, rain: 0.85, storm: 0.95, snow: 0.7 };

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const dim = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mul = (c: RGB, m: RGB): RGB => [c[0] * m[0], c[1] * m[1], c[2] * m[2]];
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

  // Each weather has its own colors, picked from https://claude.ai/artifact/6FhBExVDbYTHiBnnaN7Qa1.
  const mist = at(MIST, hour)[0];
  // The light of overcast (outdoor mist, snow) and of the fog's banks.
  const fog = weather === 'fog' ? mix(mist, [255, 255, 255], 0.15) : mix([50, 56, 80], mix([196, 206, 220], [216, 182, 170], warm), day);
  let ground: [RGB, RGB];
  switch (weather) {
    case 'clear':
      ground = [near, far];
      break;
    case 'cloudy':
      ground = at(CEILING, hour);
      break;
    // Deep blue mist: the clear sky by the walls drowning in it, navy past the house.
    case 'fog':
      ground = [dim(mix(near, mist, 0.7), 0.85), dim(mist, 0.45)];
      break;
    // Wet hour: the hour's own colors, darker and a touch cooler, as things look when wet.
    case 'rain':
      ground = [mul(dim(near, 0.66), [0.9, 0.97, 1.1]), mul(dim(far, 0.6), [0.9, 0.97, 1.1])];
      break;
    case 'storm':
      ground = at(CHARCOAL, hour);
      break;
    case 'snow':
      ground = at(ICE, hour);
      break;
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
    fog,
    beyond: weather === 'fog' ? dim(mist, 0.16) : dim(ground[1], 0.2 + 0.14 * day),
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
