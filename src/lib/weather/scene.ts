import type { Light } from '../hue/client';
import { placeLights, walledRooms } from '../map/glow';
import type { Plan } from '../map/map';
import { clamp, mix, rgba, rng, type RGB, type Sky } from './sky';

// The outside drawn as SVG pieces. The app shows the static pieces with SvgXml and moves the
// particle layers with Animated (Outside.tsx); the map widget bakes everything into a loop of
// frames that the launcher flips through (widgetFrames). Sizes are in px, `u` scales them
// (1 on a phone-size map).

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export type HouseGeom = {
  /** Indoor rooms with walls. */
  indoor: Pt[][];
  /** Outdoor areas (terrace, balcony): they take the weather inside them. */
  outdoor: Pt[][];
  /** Bounding box of every room. */
  box: Box | null;
  /** Lit lights standing in outdoor areas. */
  outdoorLights: { x: number; y: number; color: string; r: number; beads: Pt[] }[];
  /** Anything lit indoors (the house leaks a warm halo at night). */
  indoorLit: boolean;
};

type Fit = { scale: number; x: (u: number) => number; y: (v: number) => number };

/** Screen geometry of a plan laid out with `fitPlan`. */
export function houseGeom(plan: Plan, f: Fit, lights: Light[]): HouseGeom {
  const walled = walledRooms(plan);
  const pts = (r: Plan['rooms'][number]) => r.pts.map((p) => ({ x: f.x(p.u), y: f.y(p.v) }));
  const indoor = walled.filter((r) => !r.outdoor).map(pts);
  const outdoor = walled.filter((r) => r.outdoor).map(pts);
  const all = [...indoor, ...outdoor].flat();
  const box = all.length
    ? (() => {
        const xs = all.map((p) => p.x);
        const ys = all.map((p) => p.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      })()
    : null;
  const placed = placeLights(plan, lights);
  const lit = placed.filter((p) => p.light.on && p.light.reachable);
  return {
    indoor,
    outdoor,
    box,
    indoorLit: lit.some((p) => !p.room?.outdoor),
    outdoorLights: lit
      .filter((p) => p.room?.outdoor)
      .map((p) => ({
        x: f.x(p.u),
        y: f.y(p.v),
        color: p.light.color,
        r: clamp((p.pools[0] ? Math.max(p.pools[0].rx, p.pools[0].ry) : 1) * f.scale, 24, 80),
        beads: p.beads.map((b) => ({ x: f.x(b.u), y: f.y(b.v) })),
      })),
  };
}

const n = (v: number) => (Math.round(v * 10) / 10).toString();
const poly = (pts: Pt[]) => 'M' + pts.map((p) => `${n(p.x)},${n(p.y)}`).join('L') + 'Z';
const hexRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Gradient stops from rgba() strings: SVG wants the color and its opacity apart. */
const stops = (list: [number, string][]) =>
  list
    .map(([o, c]) => {
      const [r, g, b, a] = c.slice(5, -1).split(',');
      return `<stop offset="${o}" stop-color="rgb(${r},${g},${b})" stop-opacity="${a}"/>`;
    })
    .join('');
const radial = (id: string, cx: number, cy: number, r: number, list: [number, string][]) =>
  `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}">${stops(list)}</radialGradient>`;
const soft = (id: string, cx: number, cy: number, r: number, c: RGB, a: number) => radial(id, cx, cy, r, [[0, rgba(c, a)], [1, rgba(c, 0)]]);
/** A soft ellipse: radial fade from its center, drawn as a scaled unit circle. */
function ellipseBlob(id: string, cx: number, cy: number, rx: number, ry: number, c: RGB, a: number) {
  return (
    `<defs>${soft(id, 0, 0, 1, c, a)}</defs>` +
    `<circle cx="0" cy="0" r="1" fill="url(#${id})" transform="translate(${n(cx)} ${n(cy)}) scale(${n(rx)} ${n(ry)})"/>`
  );
}

export function svg(w: number, h: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">${body}</svg>`;
}

/** Where the sun and moon are: across the sky band from left (sunrise) to right (sunset). */
export function lights(sky: Sky, W: number, skyH: number, u: number) {
  const s = Math.sin(Math.PI * sky.arc);
  return {
    sun: { x: W * (0.12 + 0.76 * sky.arc), y: skyH ? skyH * (0.86 - 0.6 * s) : -70 * u - 50 * u * s },
    moon: { x: W * 0.78, y: skyH ? skyH * 0.3 : -60 * u },
  };
}

/** Far ground, the ground near the house, the sun's and the moon's light. */
export function groundSvg(sky: Sky, W: number, H: number, geom: HouseGeom, skyH: number, u: number) {
  const { sun, moon } = lights(sky, W, skyH, u);
  const R = Math.max(W, H) * 1.15;
  const c = geom.box ? { x: geom.box.x + geom.box.w / 2, y: geom.box.y + geom.box.h / 2 } : { x: W / 2, y: H / 2 };
  const nearR = geom.box ? Math.max(geom.box.w, geom.box.h) * 0.85 + 40 * u : Math.max(W, H) * 0.5;
  const moonA = 0.18 * sky.night * (sky.weather === 'clear' ? 1 : sky.weather === 'cloudy' ? 0.2 : 0);
  const defs =
    radial('gn', c.x, c.y, nearR, [[0, rgba(sky.near, 1)], [0.5, rgba(sky.near, 0.7)], [1, rgba(sky.near, 0)]]) +
    radial('gs', sun.x, sun.y, R, [[0, rgba(sky.wash, sky.washA)], [0.45, rgba(sky.wash, sky.washA * 0.3)], [1, rgba(sky.wash, 0)]]) +
    radial('gm', moon.x, moon.y, R * 0.8, [[0, rgba([150, 170, 235], moonA)], [1, rgba([150, 170, 235], 0)]]);
  const all = `x="${n(-W)}" y="${n(-H)}" width="${n(W * 3)}" height="${n(H * 3)}"`;
  return `<defs>${defs}</defs><rect ${all} fill="${rgba(sky.far)}"/><rect ${all} fill="url(#gn)"/><rect ${all} fill="url(#gs)"/><rect ${all} fill="url(#gm)"/>`;
}

/** Around the house: its soft shadow by day, the warm light it leaks at night, a snowy rim. */
/** `origin`: where `geom`'s (0, 0) sits on the screen the sky is laid out on (W wide). */
export function houseSvg(sky: Sky, W: number, geom: HouseGeom, skyH: number, u: number, sparkle = true, origin: Pt = { x: 0, y: 0 }) {
  const out: string[] = [];
  const box = geom.box;
  if (!box) return '';
  const seen = lights(sky, W, skyH, u).sun;
  const sun = { x: seen.x - origin.x, y: seen.y - origin.y };
  const shA = sky.day * (1 - sky.cloud * 0.85) * 0.75;
  if (shA > 0.03 && sky.alt > 1) {
    const len = clamp(14 / Math.tan((sky.alt * Math.PI) / 180), 8, 60) * u;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const d = Math.hypot(cx - sun.x, cy - sun.y) || 1;
    const sc = rgba(mix([26, 22, 58], sky.far, 0.2));
    // Copies smeared along the light, fading out: a soft shadow without blur.
    for (let i = 0; i < 9; i++) {
      const k = 0.2 + i * 0.12;
      const dx = ((cx - sun.x) / d) * len * k;
      const dy = ((cy - sun.y) / d) * len * k;
      out.push(`<g opacity="${(shA * 0.15 * (1 - i / 12)).toFixed(3)}" transform="translate(${n(dx)} ${n(dy)})">${geom.indoor.map((r) => `<path d="${poly(r)}" fill="${sc}"/>`).join('')}</g>`);
    }
  }
  const haloA = geom.indoorLit ? 0.1 + 0.5 * sky.night * (1 - sky.day) : 0;
  if (haloA > 0.02) {
    // Many thin layers so the glow fades without visible steps (no blur in widget SVG).
    for (let k = 10; k >= 1; k--) {
      const stroke = rgba([255, 172, 104], (haloA * 0.07 * (11 - k)) / 5.5);
      out.push(...geom.indoor.map((r) => `<path d="${poly(r)}" fill="none" stroke="${stroke}" stroke-width="${n(k * 7 * u)}" stroke-linejoin="round" opacity="0.5"/>`));
    }
  }
  if (sky.weather === 'snow') {
    for (const [w, a] of [[14, 0.08], [9, 0.14], [5, 0.22], [2.5, 0.35]]) {
      for (const r of geom.indoor) out.push(`<path d="${poly(r)}" fill="none" stroke="rgba(244,246,252,${a})" stroke-width="${n(w * u)}" stroke-linejoin="round"/>`);
    }
  }
  out.push(outdoorSvg(sky, geom, u, sparkle));
  return out.join('');
}

/** Outdoor areas take the weather: wet floors that mirror their lights, snow with drifts. */
function outdoorSvg(sky: Sky, geom: HouseGeom, u: number, sparkle: boolean) {
  const out: string[] = [];
  geom.outdoor.forEach((pts, i) => {
    const ys = pts.map((p) => p.y);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const grad = (id: string, list: [number, string][]) =>
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(top)}" x2="0" y2="${n(bottom)}">${stops(list)}</linearGradient>`;
    if (sky.wet) {
      out.push(`<defs>${grad(`ow${i}`, [[0, 'rgba(150,175,220,0.18)'], [1, 'rgba(150,175,220,0.06)']])}</defs><path d="${poly(pts)}" fill="url(#ow${i})"/>`);
    }
    if (sky.weather === 'snow') {
      out.push(
        `<defs>${grad(`os${i}`, [[0, 'rgba(234,240,252,0.5)'], [0.38, 'rgba(226,234,250,0.22)'], [0.7, 'rgba(226,234,250,0.18)'], [1, 'rgba(234,240,252,0.34)']])}</defs>` +
          `<path d="${poly(pts)}" fill="url(#os${i})"/>`,
      );
      // Drifts piled along the edges and in the corners.
      pts.forEach((a, j) => {
        const b = pts[(j + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const along = Math.max(1, Math.round(len / (60 * u)));
        for (let k = 0; k <= along; k++) {
          const t = k / along;
          const corner = k === 0;
          const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
          const rx = (corner ? 20 : horizontal ? 34 : 12) * u;
          const ry = (corner ? 16 : horizontal ? 9 : 30) * u;
          out.push(ellipseBlob(`od${i}-${j}-${k}`, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, rx, ry, [250, 252, 255], 0.55));
        }
      });
      if (sparkle) out.push(sparklesSvg(pts, u, 0));
    }
  });
  // Lights mirrored in the wet floor.
  if (sky.wet) {
    geom.outdoorLights.forEach((l, i) => {
      const c = hexRgb(l.color);
      for (const b of l.beads) {
        out.push(
          `<defs><linearGradient id="rb${i}-${n(b.x)}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(b.y + 3 * u)}" x2="0" y2="${n(b.y + 12 * u)}">${stops([[0, rgba(c, 0.55)], [1, rgba(c, 0)]])}</linearGradient></defs>` +
            `<rect x="${n(b.x - u)}" y="${n(b.y + 3 * u)}" width="${n(2 * u)}" height="${n(9 * u)}" fill="url(#rb${i}-${n(b.x)})"/>`,
        );
      }
      if (!l.beads.length) out.push(ellipseBlob(`rl${i}`, l.x, l.y + 26 * u, 7 * u, 20 * u, c, 0.5));
    });
  }
  if (sky.weather === 'snow') {
    geom.outdoorLights.forEach((l, i) => out.push(ellipseBlob(`sl${i}`, l.x, l.y, l.r * 1.6, l.r * 1.15, hexRgb(l.color), 0.36)));
  }
  return out.join('');
}

/** Glitter on snow-covered outdoor areas; `group` 0/1 twinkle in turn. */
export function sparklePoints(pts: Pt[], u: number, group: number): Pt[] {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  const r = rng(37 + group);
  const count = clamp(Math.round((w * h) / (700 * u * u)), 6, 40);
  const dots: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const p = { x: x0 + r() * w, y: y0 + r() * h };
    if (inside(p, pts)) dots.push(p);
  }
  return dots;
}

function sparklesSvg(pts: Pt[], u: number, group: number) {
  return sparklePoints(pts, u, group)
    .map((p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(0.8 * u)}" fill="rgba(255,255,255,0.95)"/>`)
    .join('');
}

function inside(p: Pt, pts: Pt[]) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (pts[i].y > p.y !== pts[j].y > p.y && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c;
  }
  return c;
}

/** The far outside fades into the dark (into pale grey in fog); a band around the house stays. */
/** `rings`: more steps give a smoother edge (the app can afford it; widget frames use fewer). */
export function vignetteSvg(sky: Sky, W: number, H: number, geom: HouseGeom, u: number, extend = 0, rings = 18) {
  const box = geom.box;
  if (!box) return '';
  const M = 44 * u;
  const A = sky.weather === 'fog' ? 0.82 : 0.9;
  const x0 = -extend;
  const y0 = -extend;
  const x1 = W + extend;
  const y1 = H + extend;
  const out: string[] = [];
  for (let i = 0; i < rings; i++) {
    // Ease the steps: dense near the house, wider further out.
    const t = i / (rings - 1);
    const m = M * (0.3 + 1.9 * t * t * (3 - 2 * t) * 0.5 + 0.95 * t);
    const x = box.x - m;
    const y = box.y - m;
    const w = box.w + 2 * m;
    const h = box.h + 2 * m;
    const r = Math.min(30 * u + m * 0.6, w / 2, h / 2);
    const hole =
      `M${n(x + r)},${n(y)}H${n(x + w - r)}A${n(r)},${n(r)} 0 0 1 ${n(x + w)},${n(y + r)}V${n(y + h - r)}A${n(r)},${n(r)} 0 0 1 ${n(x + w - r)},${n(y + h)}` +
      `H${n(x + r)}A${n(r)},${n(r)} 0 0 1 ${n(x)},${n(y + h - r)}V${n(y + r)}A${n(r)},${n(r)} 0 0 1 ${n(x + r)},${n(y)}Z`;
    out.push(`<path fill-rule="evenodd" d="M${n(x0)},${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z${hole}" fill="${rgba(sky.vig, A / rings)}"/>`);
  }
  return out.join('');
}

/** The sky band at the top of the screen, the sun and the moon in it. */
export function skySvg(sky: Sky, W: number, skyH: number, u: number) {
  if (!skyH) return '';
  const { sun, moon } = lights(sky, W, skyH, u);
  const out: string[] = [
    `<defs><linearGradient id="sb" x1="0" y1="0" x2="0" y2="1">${stops([[0, rgba(sky.top, 0.92)], [0.42, rgba(sky.mid, 0.82)], [0.78, rgba(sky.low, 0.62)], [1, rgba(sky.low, 0)]])}</linearGradient></defs>`,
    `<rect x="0" y="0" width="${n(W)}" height="${n(skyH)}" fill="url(#sb)"/>`,
  ];
  const sunO = sky.weather === 'clear' ? 1 : sky.weather === 'fog' || sky.weather === 'cloudy' || sky.weather === 'snow' ? 0.3 : 0;
  if (sky.day > 0.05 && sunO > 0) {
    const disc = mix([255, 246, 220], [255, 150, 92], sky.warm);
    out.push(ellipseBlob('sh', sun.x, sun.y, 140 * u, 140 * u, sky.wash, 0.55 * sky.day * sunO));
    out.push(
      `<defs>${radial('sd', sun.x, sun.y, 16 * u, [[0, rgba(disc, sunO)], [0.52, rgba(disc, sunO)], [1, rgba(disc, 0)]])}</defs><circle cx="${n(sun.x)}" cy="${n(sun.y)}" r="${n(16 * u)}" fill="url(#sd)"/>`,
    );
  }
  const moonA = sky.night * (sky.weather === 'clear' ? 1 : sky.weather === 'cloudy' ? 0.2 : 0);
  if (moonA > 0.15) {
    const r = 10 * u;
    out.push(ellipseBlob('mh', moon.x, moon.y, 85 * u, 85 * u, [190, 200, 240], 0.3 * moonA));
    // A crescent: the moon's disc minus a slightly smaller one, offset to the right.
    out.push(
      `<path d="M${n(moon.x)},${n(moon.y - r)}A${n(r)},${n(r)} 0 1 0 ${n(moon.x)},${n(moon.y + r)}A${n(r * 0.78)},${n(r)} 0 1 1 ${n(moon.x)},${n(moon.y - r)}Z" fill="${rgba([244, 238, 222], 0.95 * moonA)}"/>`,
    );
  }
  // Thin clouds lit pink and gold at sunrise and sunset.
  if (sky.weather === 'clear' && sky.warm * sky.day > 0.25) {
    const lit = mix(mix(sky.mid, sky.low, 0.55), [255, 236, 220], 0.25);
    [[0.08, 0.42, 110, 8], [0.48, 0.58, 130, 7], [0.22, 0.7, 90, 6]].forEach(([x, y, rx, ry], i) =>
      out.push(ellipseBlob(`lc${i}`, W * x + rx * u, skyH * y, rx * u, ry * u, lit, 0.7 * sky.warm * sky.day)),
    );
  }
  return out.join('');
}

/** Cloud banks drifting through the sky band. */
export function skyCloudsSvg(sky: Sky, W: number, skyH: number, u: number) {
  if (!skyH || sky.weather === 'clear' || sky.weather === 'fog') return '';
  const r = rng(11);
  const cc = sky.weather === 'storm' ? mix(sky.top, [40, 38, 64], 0.5) : mix(mix(sky.mid, [236, 236, 240], 0.35 * sky.day), sky.top, 0.25);
  const ca = { cloudy: 0.62, rain: 0.66, storm: 0.85, snow: 0.55 }[sky.weather];
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const rx = (85 + 65 * r()) * u;
    const ry = (23 + 20 * r()) * u;
    out.push(ellipseBlob(`sc${i}`, -40 * u + r() * (W + 80 * u), skyH * (0.04 + 0.6 * r()), rx, ry, cc, ca));
  }
  return out.join('');
}

/** Cloud shadows crossing the ground on a grey day. */
export function cloudShadowsSvg(sky: Sky, W: number, H: number, u: number) {
  if (sky.day < 0.1 || (sky.weather !== 'cloudy' && sky.weather !== 'snow')) return '';
  const r = rng(12);
  const out: string[] = [];
  for (let i = 0; i < 3; i++) out.push(ellipseBlob(`cs${i}`, r() * W, H * (0.25 + 0.6 * r()), 150 * u, 90 * u, [22, 20, 46], 0.38 * sky.day));
  return out.join('');
}

export type Star = Pt & { big: boolean; alpha: number; group: 0 | 1 };

/** Stars in the dark beyond the house; group 1 twinkles. */
export function stars(sky: Sky, W: number, H: number, u: number): Star[] {
  const a = sky.night * (sky.weather === 'clear' ? 1 : sky.weather === 'cloudy' ? 0.15 : 0);
  if (a < 0.02) return [];
  const r = rng(7);
  const count = Math.round(clamp((W * H) / (5200 * u * u), 20, 90));
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    const big = r() < 0.16;
    out.push({ x: r() * W, y: r() * H, big, alpha: (0.35 + 0.55 * r()) * a, group: (i % 2) as 0 | 1 });
  }
  return out;
}

export function starsSvg(sky: Sky, W: number, H: number, u: number, group: 0 | 1) {
  return stars(sky, W, H, u)
    .filter((s) => s.group === group)
    .map(
      (s) =>
        (s.big ? `<circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n(3 * u)}" fill="${rgba([200, 210, 255], s.alpha * 0.18)}"/>` : '') +
        `<circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n((s.big ? 1.1 : 0.6) * u)}" fill="${rgba([246, 240, 228], s.alpha)}"/>`,
    )
    .join('');
}

/** Fog banks; `layer` 0 lies under the dark edge, 1 over it. */
export function fogSvg(sky: Sky, W: number, H: number, u: number, layer: 0 | 1) {
  if (sky.weather !== 'fog') return '';
  const r = rng(13 + layer);
  const out: string[] = [];
  const count = layer ? 5 : 7;
  for (let i = 0; i < count; i++) {
    out.push(ellipseBlob(`fb${layer}-${i}`, -60 * u + r() * (W + 120 * u), r() * H, (210 + 80 * r()) * u, (85 + 40 * r()) * u, sky.fog, layer ? 0.34 : 0.42));
  }
  return out.join('');
}

/** A streak (w×h, drawn vertical) or a dot (w = h) in a particle tile; `glow` adds a soft halo. */
export type Particle = { x: number; y: number; w: number; h: number; color: string; glow?: string };

/**
 * A seamless particle layer: one tile, repeated, turned by `angle` (the rain's slant), sliding
 * along its own vertical by `tilesPerLoop` tiles every `loopMs` (negative = upward).
 */
export type ParticleLayer = { tileW: number; tileH: number; angle: number; particles: Particle[]; tilesPerLoop: number; loopMs: number };

/** Rain, storm rain, snow or golden dust, in depths from far to near. */
export function particleLayers(sky: Sky, u: number): ParticleLayer[] {
  if (sky.wet) {
    const storm = sky.weather === 'storm';
    const specs = storm
      ? [
          { w: 90, h: 120, tiles: 1, n: 4, len: 8, a: 0.26, width: 0.9 },
          { w: 110, h: 120, tiles: 2, n: 6, len: 13, a: 0.42, width: 1 },
          { w: 145, h: 120, tiles: 3, n: 6, len: 18, a: 0.6, width: 1.3 },
        ]
      : [
          { w: 90, h: 100, tiles: 2, n: 3, len: 7, a: 0.22, width: 0.8 },
          { w: 100, h: 140, tiles: 2, n: 5, len: 10, a: 0.35, width: 1 },
          { w: 130, h: 160, tiles: 3, n: 7, len: 14, a: 0.5, width: 1.2 },
        ];
    return specs.map((s, i) => {
      const w = s.w * u;
      const h = s.h * u;
      const r = rng(17 + i + (storm ? 10 : 0));
      const particles: Particle[] = [];
      for (let j = 0; j < s.n; j++) {
        particles.push({ x: 2 * u + r() * (w - 4 * u), y: 2 * u + r() * (h - (s.len + 4) * u), w: s.width * u, h: s.len * u, color: `rgba(206,220,240,${s.a})` });
      }
      return { tileW: w, tileH: h, angle: storm ? 22 : 14, particles, tilesPerLoop: s.tiles, loopMs: storm ? 600 : 800 };
    });
  }
  if (sky.weather === 'snow') {
    return [
      { s: 48, n: 2, d: 1.4, a: 0.4 },
      { s: 60, n: 3, d: 2, a: 0.62 },
      { s: 80, n: 3, d: 3, a: 0.88 },
    ].map((s, i) => {
      const t = s.s * u;
      const r = rng(23 + i);
      const particles: Particle[] = [];
      for (let j = 0; j < s.n; j++) {
        const d = (s.d + r()) * u;
        particles.push({ x: 4 * u + r() * (t - 8 * u), y: 4 * u + r() * (t - 8 * u), w: d, h: d, color: `rgba(248,248,252,${s.a})` });
      }
      return { tileW: t, tileH: t, angle: 0, particles, tilesPerLoop: 1, loopMs: 3000 };
    });
  }
  if (sky.weather === 'clear' && sky.warm * sky.day > 0.3) {
    const t = 260 * u;
    const r = rng(29);
    const c = rgba(mix(sky.wash, [255, 255, 255], 0.4), 0.9);
    const particles: Particle[] = [];
    for (let j = 0; j < 7; j++) particles.push({ x: 8 * u + r() * (t - 16 * u), y: 8 * u + r() * (t - 16 * u), w: 2.2 * u, h: 2.2 * u, color: c, glow: rgba(sky.wash, 0.25) });
    return [{ tileW: t, tileH: t, angle: 0, particles, tilesPerLoop: -1, loopMs: 6000 }];
  }
  return [];
}

/** A layer's tile as SVG, for patterns. */
function tileSvg(l: ParticleLayer) {
  return l.particles
    .map((p) => {
      if (p.w === p.h) {
        const c = `cx="${n(p.x + p.w / 2)}" cy="${n(p.y + p.h / 2)}"`;
        const halo = p.glow ? `<circle ${c} r="${n(p.w * 1.8)}" fill="${p.glow}"/>` : '';
        return `${halo}<circle ${c} r="${n(p.w / 2)}" fill="${p.color}"/>`;
      }
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="${n(p.w / 2)}" fill="${p.color}"/>`;
    })
    .join('');
}

/** Rain rings: on outdoor floors and on the ground around the house. */
export function ripples(sky: Sky, geom: HouseGeom, u: number) {
  if (!sky.wet || !geom.box) return [];
  const r = rng(5);
  const spots: (Pt & { phase: number; ms: number })[] = [];
  const add = (p: Pt) => spots.push({ ...p, phase: r(), ms: 1600 + r() * 1000 });
  for (const pts of geom.outdoor) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0;
    const h = Math.max(...ys) - y0;
    const count = clamp(Math.round((w * h) / (2400 * u * u)), 3, 12);
    for (let i = 0, tries = 0; i < count && tries < 60; tries++) {
      const p = { x: x0 + r() * w, y: y0 + r() * h };
      if (inside(p, pts)) {
        add(p);
        i++;
      }
    }
  }
  const b = geom.box;
  const m = 18 * u;
  for (let i = 0; i < 10; i++) {
    const t = r();
    const side = i % 4;
    add(
      side === 0
        ? { x: b.x + t * b.w, y: b.y - m }
        : side === 1
          ? { x: b.x + b.w + m, y: b.y + t * b.h }
          : side === 2
            ? { x: b.x + t * b.w, y: b.y + b.h + m }
            : { x: b.x - m, y: b.y + t * b.h },
    );
  }
  return spots;
}

/** Fireflies drifting in the band around the house on a clear night. */
export function fireflies(sky: Sky, geom: HouseGeom, u: number) {
  if (sky.weather !== 'clear' || sky.night < 0.6 || !geom.box) return [];
  const b = geom.box;
  const r = rng(19);
  const out: (Pt & { phase: number })[] = [];
  for (let i = 0; i < 10; i++) {
    const t = r();
    const d = (8 + r() * 26) * u;
    const side = i % 4;
    out.push({
      x: side === 0 ? b.x + t * b.w : side === 1 ? b.x + b.w + d : side === 2 ? b.x + t * b.w : b.x - d,
      y: side === 0 ? b.y - d : side === 1 ? b.y + t * b.h : side === 2 ? b.y + b.h + d : b.y + t * b.h,
      phase: r(),
    });
  }
  return out;
}

// ---- Widget frames ----

export type Frames = { frames: string[]; intervalMs: number };

/**
 * The outside for a widget, as a loop of SVG frames the launcher flips through. Everything below
 * the plan: ground, weather, outdoor areas, the dark edge, sky. The plan itself is drawn on top
 * by the widget (its floors cover the inside).
 */
export function widgetFrames(sky: Sky, W: number, H: number, geom: HouseGeom, opts: { u: number; skyH: number; radius: number }): Frames {
  const { u, skyH, radius } = opts;
  const layers = particleLayers(sky, u);
  const rings = ripples(sky, geom, u);
  const flies = fireflies(sky, geom, u);
  const stars1 = starsSvg(sky, W, H, u, 1);
  const storm = sky.weather === 'storm';
  const drifting = sky.weather === 'fog' || (skyH > 0 && sky.weather !== 'clear') || (sky.weather !== 'clear' && sky.day > 0.1);
  let count = 1;
  let intervalMs = 1000;
  if (sky.wet) [count, intervalMs] = storm ? [24, 50] : [16, 50];
  else if (sky.weather === 'snow') [count, intervalMs] = [20, 150];
  else if (layers.length || flies.length || stars1 || drifting) [count, intervalMs] = [16, 250];
  const loop = count * intervalMs;

  const base = groundSvg(sky, W, H, geom, skyH, u);
  const house = houseSvg(sky, W, geom, skyH, u);
  const vignette = vignetteSvg(sky, W, H, geom, u);
  const skyBand = skySvg(sky, W, skyH, u);
  const stars0 = starsSvg(sky, W, H, u, 0);
  const clip = `<defs><clipPath id="wc"><rect x="0" y="0" width="${n(W)}" height="${n(H)}" rx="${n(radius)}" ry="${n(radius)}"/></clipPath></defs>`;

  const frames: string[] = [];
  for (let f = 0; f < count; f++) {
    const t = (f * intervalMs) / loop;
    const sway = Math.sin(2 * Math.PI * t);
    const parts: string[] = [base];
    parts.push(`<g transform="translate(${n(12 * u * sway)} 0)">${cloudShadowsSvg(sky, W, H, u)}${fogSvg(sky, W, H, u, 0)}</g>`);
    parts.push(house);
    layers.forEach((l, i) => {
      // A whole number of layer loops per frame loop, so the last frame meets the first.
      const shift = l.tileH * l.tilesPerLoop * t * Math.max(1, Math.round(loop / l.loopMs));
      parts.push(
        `<defs><pattern id="p${i}" patternUnits="userSpaceOnUse" width="${n(l.tileW)}" height="${n(l.tileH)}" patternTransform="rotate(${l.angle}) translate(0 ${n(shift)})">${tileSvg(l)}</pattern></defs>` +
          `<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="url(#p${i})"/>`,
      );
    });
    for (const s of rings) {
      const ph = (t * (loop / s.ms) + s.phase) % 1;
      const sc = 0.2 + 1.5 * ph;
      parts.push(`<ellipse cx="${n(s.x)}" cy="${n(s.y)}" rx="${n(7 * u * sc)}" ry="${n(3.5 * u * sc)}" fill="none" stroke="rgba(206,218,240,${(0.8 * (1 - ph)).toFixed(2)})" stroke-width="${n(u)}"/>`);
    }
    parts.push(vignette, skyBand);
    parts.push(`<g transform="translate(${n(-14 * u * sway)} 0)">${skyCloudsSvg(sky, W, skyH, u)}${fogSvg(sky, W, H, u, 1)}</g>`);
    parts.push(stars0, `<g opacity="${(0.65 + 0.35 * Math.cos(2 * Math.PI * t)).toFixed(2)}">${stars1}</g>`);
    for (const ff of flies) {
      const a = 2 * Math.PI * (t + ff.phase);
      const x = ff.x + 10 * u * Math.sin(a);
      const y = ff.y + 8 * u * Math.sin(2 * a);
      const o = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(2 * a + 1));
      parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(5 * u)}" fill="rgba(226,240,140,${(0.25 * o).toFixed(2)})"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(1.5 * u)}" fill="rgba(240,248,170,${(0.95 * o).toFixed(2)})"/>`);
    }
    if (storm && (f === count - 4 || f === count - 2)) parts.push(`<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="rgba(214,222,255,${f === count - 4 ? 0.4 : 0.28})"/>`);
    frames.push(svg(W, H, `${clip}<g clip-path="url(#wc)">${parts.join('')}</g>`));
  }
  return { frames, intervalMs };
}
