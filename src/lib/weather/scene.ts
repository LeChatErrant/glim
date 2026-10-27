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

/** An outdoor area laid out for drawing: its outline, box, the edges sheltered by the eave, its lights. */
export type OutdoorArea = { pts: Pt[]; box: Box; eaves: { a: Pt; b: Pt; nx: number; ny: number }[]; lights: HouseGeom['outdoorLights'] };

const boxOf = (pts: Pt[]): Box => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Outdoor areas with the edges that run along the house (under the eave), normals pointing in. */
export function outdoorAreas(geom: HouseGeom, u: number): OutdoorArea[] {
  return geom.outdoor.map((pts) => {
    const eaves: OutdoorArea['eaves'] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 8 * u) return;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!geom.indoor.some((r) => r.some((q, j) => segDist(m, q, r[(j + 1) % r.length]) < 3 * u))) return;
      let nx = -(b.y - a.y) / len;
      let ny = (b.x - a.x) / len;
      if (!inside({ x: m.x + nx * 4 * u, y: m.y + ny * 4 * u }, pts)) [nx, ny] = [-nx, -ny];
      eaves.push({ a, b, nx, ny });
    });
    return { pts, box: boxOf(pts), eaves, lights: geom.outdoorLights.filter((l) => inside(l, pts)) };
  });
}

/** Far enough from the eave to be out in the weather. */
const exposed = (p: Pt, area: OutdoorArea, u: number) => area.eaves.every((e) => segDist(p, e.a, e.b) > 12 * u);

function pointsIn(area: OutdoorArea, count: number, seed: number, u: number, open = true) {
  const r = rng(seed);
  const out: Pt[] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const p = { x: area.box.x + r() * area.box.w, y: area.box.y + r() * area.box.h };
    if (inside(p, area.pts) && (!open || exposed(p, area, u))) out.push(p);
  }
  return out;
}

/** The paving's color: lighter than the grass, darker when wet. */
const pavingColor = (sky: Sky): RGB => {
  const c = mix([30, 28, 30], [132, 122, 110], sky.day * (1 - sky.cloud * 0.45));
  return sky.wet ? [c[0] * 0.62, c[1] * 0.62, c[2] * 0.62] : c;
};

/**
 * Outdoor areas are a place of their own, not more garden: a smooth paved floor, sheltered along
 * the wall by the eave, where the weather lands (wet paving, snow cover, railing light).
 */
function outdoorSvg(sky: Sky, geom: HouseGeom, u: number, sparkle: boolean) {
  const out: string[] = [];
  outdoorAreas(geom, u).forEach((area, i) => {
    const { pts, box } = area;
    const d = poly(pts);
    const clip = `url(#oc${i})`;
    const paving = pavingColor(sky);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    out.push(`<defs><clipPath id="oc${i}"><path d="${d}"/></clipPath>${radial(`ol${i}`, cx, cy, Math.max(box.w, box.h) * 0.6, [[0, rgba(mix(paving, [255, 250, 240], 0.08), 0.6)], [1, rgba(paving, 0)]])}</defs>`);
    out.push(`<path d="${d}" fill="${rgba(paving, 0.96)}"/><path d="${d}" fill="url(#ol${i})"/>`);
    out.push(`<g clip-path="${clip}"><path d="${d}" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="${n(14 * u)}"/></g>`);
    const eaveStrip = (k: number, c: RGB, a: number) =>
      area.eaves
        .map((e, j) => {
          const depth = 18 * u;
          const m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
          const id = `oe${i}-${j}-${k}`;
          const g = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(m.x)}" y1="${n(m.y)}" x2="${n(m.x + e.nx * depth)}" y2="${n(m.y + e.ny * depth)}">${stops([[0, rgba(c, a)], [0.55, rgba(c, a * 0.4)], [1, rgba(c, 0)]])}</linearGradient>`;
          const q = [e.a, e.b, { x: e.b.x + e.nx * depth, y: e.b.y + e.ny * depth }, { x: e.a.x + e.nx * depth, y: e.a.y + e.ny * depth }];
          return `<defs>${g}</defs><path d="${poly(q)}" fill="url(#${id})" clip-path="${clip}"/>`;
        })
        .join('');
    out.push(eaveStrip(0, [0, 0, 0], 0.45));
    if (sky.wet) out.push(`<path d="${d}" fill="rgba(150,175,220,0.08)"/>`);
    if (sky.weather === 'snow') {
      const cover = mix([150, 165, 205], [236, 241, 252], sky.day);
      out.push(
        `<defs><linearGradient id="os${i}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(box.y)}" x2="0" y2="${n(box.y + box.h)}">${stops([[0, rgba(cover, 0.8)], [0.3, rgba(cover, 0.62)], [0.7, rgba(cover, 0.56)], [1, rgba(cover, 0.74)]])}</linearGradient></defs>` +
          `<path d="${d}" fill="url(#os${i})"/>`,
      );
      // Less snow under the eave.
      out.push(eaveStrip(1, mix(paving, [0, 0, 0], 0.2), 0.7));
      // Drifts piled along the edges and in the corners.
      pts.forEach((a, j) => {
        const b = pts[(j + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const along = Math.max(1, Math.round(len / (60 * u)));
        for (let k = 0; k <= along; k++) {
          const t = k / along;
          const corner = k === 0;
          const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
          out.push(ellipseBlob(`od${i}-${j}-${k}`, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, (corner ? 20 : horizontal ? 34 : 12) * u, (corner ? 16 : horizontal ? 9 : 30) * u, cover, 0.7));
        }
      });
      // Footprints from the house out to a light.
      const e = area.eaves[0];
      const to = area.lights[0] ?? { x: cx, y: cy };
      if (e) {
        const from = { x: (e.a.x + e.b.x) / 2 + e.nx * 14 * u, y: (e.a.y + e.b.y) / 2 + e.ny * 14 * u };
        const ang = Math.atan2(to.y - from.y, to.x - from.x);
        for (let k = 0; k < 9; k++) {
          const t = k / 9;
          const side = (k % 2 ? 3 : -3) * u;
          const x = from.x + (to.x - from.x) * t * 0.85 - Math.sin(ang) * side;
          const y = from.y + (to.y - from.y) * t * 0.85 + Math.cos(ang) * side;
          out.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(2.6 * u)}" ry="${n(1.5 * u)}" transform="rotate(${n((ang * 180) / Math.PI)} ${n(x)} ${n(y)})" fill="rgba(96,110,156,0.5)"/>`);
        }
      }
      if (sparkle) out.push(sparklesSvg(pts, u, 0));
    }
    // Golden hour: low sun through the railing, light and shade across the floor.
    if (sky.weather === 'clear' && sky.warm * sky.day > 0.3) {
      const lines: string[] = [];
      const step = 17 * u;
      for (let x = box.x - box.h; x < box.x + box.w + box.h; x += step) {
        lines.push(`<path d="M${n(x)},${n(box.y + box.h)}L${n(x + box.h * 0.47)},${n(box.y)}" stroke="${rgba([255, 186, 120], 0.18 * sky.warm)}" stroke-width="${n(7 * u)}"/>`);
      }
      out.push(`<g clip-path="${clip}">${lines.join('')}</g>`);
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

/** An SVG showing only `box` of a drawing laid out in screen coordinates. */
export function svgBox(box: Box, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(box.w)}" height="${n(box.h)}" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}">${body}</svg>`;
}

/** Shallow puddles on wet paving, holding the area's lights (they tremble in the app). */
export function puddlesSvg(sky: Sky, area: OutdoorArea, u: number, i: number) {
  if (!sky.wet) return '';
  const lit = area.lights[0];
  const c: RGB = lit ? hexRgb(lit.color) : [170, 196, 240];
  const count = clamp(Math.round((area.box.w * area.box.h) / (4000 * u * u)), 2, 6);
  const r = rng(53 + i);
  return pointsIn(area, count, 51 + i, u)
    .map((p, k) => ellipseBlob(`pd${i}-${k}`, p.x, p.y, (15 + 9 * r()) * u, (3.5 + 1.5 * r()) * u, c, lit ? 0.4 : 0.3))
    .join('');
}

/** Fog lying low on an outdoor area, warm around its lights. */
export function mistSvg(sky: Sky, area: OutdoorArea, u: number, i: number) {
  if (sky.weather !== 'fog') return '';
  const { box } = area;
  return (
    ellipseBlob(`ms${i}`, box.x + box.w / 2, box.y + box.h * 0.6, box.w * 0.62, box.h * 0.42, sky.fog, 0.42) +
    area.lights.map((l, k) => ellipseBlob(`ml${i}-${k}`, l.x, l.y, 40 * u, 24 * u, hexRgb(l.color), 0.5)).join('')
  );
}

/** A gloss band for wet paving, centered at `x`. */
export function glossSvg(area: OutdoorArea, x: number, u: number, i: number) {
  const { box } = area;
  const w = box.w * 0.5;
  return (
    `<defs><linearGradient id="gl${i}" gradientUnits="userSpaceOnUse" x1="${n(x - w / 2)}" y1="0" x2="${n(x + w / 2)}" y2="${n(w * 0.18)}">${stops([[0, 'rgba(170,196,240,0)'], [0.5, 'rgba(170,196,240,0.16)'], [1, 'rgba(170,196,240,0)']])}</linearGradient></defs>` +
    `<path d="${poly(area.pts)}" fill="url(#gl${i})"/>`
  );
}

type Loop = { ms: number; phase: number };

/** What moves on outdoor areas, apart from the garden's weather. */
export type TerraceFx = {
  /** Drops landing: a bright point, then a crown opening. */
  splashes: (Pt & Loop)[];
  /** Drops gathering at the eave, falling, each landing with a ring. */
  drips: (Pt & Loop & { nx: number; ny: number })[];
  /** Flakes slowing down, settling and melting into the snow. */
  settle: (Pt & Loop)[];
  /** Autumn leaves skittering across. */
  leaves: (Pt & Loop & { span: number; color: string })[];
  /** Moths circling a lit lamp. */
  moths: (Pt & Loop & { r: number; dir: 1 | -1 })[];
};

export function terraceFx(sky: Sky, areas: OutdoorArea[], u: number): TerraceFx {
  const fx: TerraceFx = { splashes: [], drips: [], settle: [], leaves: [], moths: [] };
  const storm = sky.weather === 'storm';
  areas.forEach((area, i) => {
    const r = rng(61 + i);
    const size = (area.box.w * area.box.h) / (u * u);
    if (sky.wet) {
      for (const p of pointsIn(area, clamp(Math.round((size / 1500) * (storm ? 1.6 : 1)), 6, 30), 43 + i, u)) {
        fx.splashes.push({ ...p, ms: (storm ? 700 : 1000) + 500 * r(), phase: r() });
      }
      for (const e of area.eaves) {
        const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
        const count = Math.max(1, Math.round(len / (36 * u)));
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count + (r() - 0.5) * (0.3 / count);
          fx.drips.push({ x: e.a.x + (e.b.x - e.a.x) * t + e.nx * u, y: e.a.y + (e.b.y - e.a.y) * t + e.ny * u, nx: e.nx, ny: e.ny, ms: (storm ? 1100 : 1800) + 800 * r(), phase: r() });
        }
      }
    }
    if (sky.weather === 'snow') {
      for (const p of pointsIn(area, clamp(Math.round(size / 2500), 6, 20), 67 + i, u)) fx.settle.push({ ...p, ms: 4000 + 2500 * r(), phase: r() });
    }
    if (sky.weather === 'cloudy') {
      ['#B8643A', '#C98A3E', '#8E5A34', '#A8703A'].forEach((color, k) => {
        fx.leaves.push({ x: area.box.x, y: area.box.y + area.box.h * (0.2 + 0.2 * k), span: area.box.w, color, ms: 9000 + 5000 * r(), phase: r() });
      });
    }
    if (sky.weather === 'clear' && sky.night > 0.6) {
      for (const l of area.lights) {
        if (l.beads.length) continue;
        [12, 18, 24].forEach((rad, k) => fx.moths.push({ x: l.x, y: l.y, r: rad * u, ms: [1600, 2300, 3100][k], dir: k % 2 ? -1 : 1, phase: r() }));
      }
    }
  });
  return fx;
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
/** Under the sky band the dark lifts and takes the horizon's color, so the sky meets lit ground. */
/** `rings`: more steps give a smoother edge (the app can afford it; widget frames use fewer). */
export function vignetteSvg(sky: Sky, W: number, H: number, geom: HouseGeom, skyH: number, u: number, extend = 0, rings = 18) {
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
  if (!skyH) return out.join('');
  // One smooth mask over all the rings: fading each faint ring instead rounds into visible steps.
  const lit = Math.max(sky.day, 0.8 * sky.warm * (1 - sky.night));
  const keep = 1 - (0.92 * lit + 0.4 * (1 - lit));
  const fade = `<linearGradient id="vf" gradientUnits="userSpaceOnUse" x1="0" y1="${n(skyH * 0.5)}" x2="0" y2="${n(skyH * 1.4 + 120 * u)}">${stops([
    [0, `rgba(255,255,255,${keep.toFixed(3)})`],
    [0.45, `rgba(255,255,255,${(keep + (1 - keep) * 0.25).toFixed(3)})`],
    [1, 'rgba(255,255,255,1)'],
  ])}</linearGradient>`;
  const area = `x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}"`;
  return `<defs>${fade}<mask id="vm" maskUnits="userSpaceOnUse" ${area}><rect ${area} fill="url(#vf)"/></mask></defs><g mask="url(#vm)">${out.join('')}</g>`;
}

/** The sky band at the top of the screen, the sun and the moon in it. */
export function skySvg(sky: Sky, W: number, skyH: number, u: number) {
  if (!skyH) return '';
  const { sun, moon } = lights(sky, W, skyH, u);
  const out: string[] = [
    `<defs><linearGradient id="sb" x1="0" y1="0" x2="0" y2="1">${stops([[0, rgba(sky.top, 0.92)], [0.34, rgba(sky.mid, 0.82)], [0.62, rgba(sky.low, 0.62)], [0.8, rgba(sky.low, 0.28)], [0.9, rgba(sky.low, 0.09)], [1, rgba(sky.low, 0)]])}</linearGradient></defs>`,
    // The horizon fades out a little below the band, so the band has no bottom edge.
    `<rect x="0" y="0" width="${n(W)}" height="${n(skyH * 1.25)}" fill="url(#sb)"/>`,
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

/** Rain rings on the ground around the house. */
export function ripples(sky: Sky, geom: HouseGeom, u: number) {
  if (!sky.wet || !geom.box) return [];
  const r = rng(5);
  const spots: (Pt & { phase: number; ms: number })[] = [];
  // Slow, wide rings: outdoor areas get quick splashes instead (terraceFx).
  const add = (p: Pt) => spots.push({ ...p, phase: r(), ms: 2400 + r() * 1000 });
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

/** One frame of what moves on outdoor areas, `t` in [0, 1) of a `loop` ms loop. */
function terraceFrame(sky: Sky, areas: OutdoorArea[], fx: TerraceFx, still: { puddles: string; mist: string }, t: number, loop: number, u: number) {
  // Each item repeats a whole number of times per loop, so the last frame meets the first.
  const at = (l: Loop) => (t * Math.max(1, Math.round(loop / l.ms)) + l.phase) % 1;
  const out: string[] = [];
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * t);
  if (still.puddles) out.push(`<g opacity="${(0.7 + 0.3 * wave).toFixed(2)}">${still.puddles}</g>`);
  if (sky.wet) areas.forEach((a, i) => out.push(glossSvg(a, a.box.x + a.box.w * (0.5 + 0.35 * Math.sin(2 * Math.PI * t)), u, i)));
  if (still.mist) out.push(`<g opacity="${(0.6 + 0.4 * wave).toFixed(2)}">${still.mist}</g>`);
  const ring = (x: number, y: number, p: number, a: number) =>
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(6 * u * (0.15 + 1.45 * p))}" ry="${n(3 * u * (0.15 + 1.45 * p))}" fill="none" stroke="rgba(214,228,248,${(a * (1 - p)).toFixed(2)})" stroke-width="${n(u)}"/>`;
  for (const s of fx.splashes) {
    const p = at(s);
    out.push(ring(s.x, s.y, p, 0.85));
    if (p < 0.2) out.push(`<circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n(1.2 * u * (1 - p * 3))}" fill="rgba(236,244,255,0.95)"/>`);
  }
  for (const d of fx.drips) {
    const p = at(d);
    if (p < 0.64) {
      const fall = p < 0.55 ? 0 : ((p - 0.55) / 0.09) * 9 * u;
      out.push(`<circle cx="${n(d.x + d.nx * fall)}" cy="${n(d.y + d.ny * fall)}" r="${n(1.4 * u * (p < 0.55 ? 0.4 + p : 1))}" fill="rgba(214,230,250,0.95)"/>`);
    } else out.push(ring(d.x + d.nx * 9 * u, d.y + d.ny * 9 * u, (p - 0.64) / 0.36, 0.8));
  }
  for (const f of fx.settle) {
    const p = at(f);
    const down = Math.min(1, p / 0.62);
    const a = p < 0.15 ? p / 0.15 : p > 0.62 ? (1 - p) / 0.38 : 1;
    out.push(`<circle cx="${n(f.x + 5 * u * (1 - down))}" cy="${n(f.y - 30 * u * (1 - down))}" r="${n(1.3 * u)}" fill="rgba(250,250,255,${(0.95 * a).toFixed(2)})"/>`);
  }
  for (const l of fx.leaves) {
    const p = at(l);
    const a = p < 0.08 ? p / 0.08 : p > 0.92 ? (1 - p) / 0.08 : 1;
    const x = l.x + l.span * p;
    const y = l.y - 6 * u * Math.sin(Math.PI * 2 * p);
    out.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(3.5 * u)}" ry="${n(2 * u)}" transform="rotate(${Math.round(420 * p)} ${n(x)} ${n(y)})" fill="${l.color}" opacity="${(0.95 * a).toFixed(2)}"/>`);
  }
  for (const m of fx.moths) {
    const ang = m.dir * 2 * Math.PI * at(m);
    out.push(`<circle cx="${n(m.x + m.r * Math.cos(ang))}" cy="${n(m.y + m.r * Math.sin(ang))}" r="${n(1.2 * u)}" fill="rgba(250,240,220,0.9)"/>`);
  }
  return out.join('');
}

/** Rain speed on widgets, against the app's. */
const WIDGET_RAIN = 0.45;

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
  const areas = outdoorAreas(geom, u);
  const fx = terraceFx(sky, areas, u);
  const puddles = areas.map((a, i) => puddlesSvg(sky, a, u, i)).join('');
  const mist = areas.map((a, i) => mistSvg(sky, a, u, i)).join('');
  const stars1 = starsSvg(sky, W, H, u, 1);
  const storm = sky.weather === 'storm';
  const drifting = sky.weather === 'fog' || (skyH > 0 && sky.weather !== 'clear') || (sky.weather !== 'clear' && sky.day > 0.1) || fx.moths.length > 0;
  // The launcher flips right on time, so smoothness comes from small steps between frames:
  // 25 fps rain whose streaks are longer than a frame's step, 10 fps snow, 5 fps for slow drifts.
  let count = 1;
  let intervalMs = 1000;
  if (sky.wet) [count, intervalMs] = [32, 40];
  else if (sky.weather === 'snow') [count, intervalMs] = [30, 100];
  else if (layers.length || flies.length || stars1 || drifting) [count, intervalMs] = [24, 200];
  const loop = count * intervalMs;

  const base = groundSvg(sky, W, H, geom, skyH, u);
  const house = houseSvg(sky, W, geom, skyH, u);
  const vignette = vignetteSvg(sky, W, H, geom, skyH, u);
  const skyBand = skySvg(sky, W, skyH, u);
  const stars0 = starsSvg(sky, W, H, u, 0);
  const clip = `<defs><clipPath id="wc"><rect x="0" y="0" width="${n(W)}" height="${n(H)}" rx="${n(radius)}" ry="${n(radius)}"/></clipPath></defs>`;

  const frames: string[] = [];
  for (let f = 0; f < count; f++) {
    const t = (f * intervalMs) / loop;
    const sway = Math.sin(2 * Math.PI * t);
    const parts: string[] = [base];
    parts.push(`<g transform="translate(${n(12 * u * sway)} 0)">${cloudShadowsSvg(sky, W, H, u)}${fogSvg(sky, W, H, u, 0)}</g>`);
    layers.forEach((l, i) => {
      // A whole number of tiles per frame loop, so the last frame meets the first; rain falls
      // slower than in the app so each step stays shorter than a streak. A layer that moves less
      // than a tile per loop (golden dust) bobs in place instead.
      const tiles = (Math.abs(l.tilesPerLoop) * loop) / l.loopMs;
      const shift =
        tiles < 1
          ? 6 * u * Math.sin(2 * Math.PI * t) * Math.sign(l.tilesPerLoop)
          : l.tileH * Math.sign(l.tilesPerLoop) * Math.max(1, Math.round(tiles * (sky.wet ? WIDGET_RAIN : 1))) * t;
      const sideways = tiles < 1 ? 4 * u * Math.cos(2 * Math.PI * t) : 0;
      parts.push(
        `<defs><pattern id="p${i}" patternUnits="userSpaceOnUse" width="${n(l.tileW)}" height="${n(l.tileH)}" patternTransform="rotate(${l.angle}) translate(${n(sideways)} ${n(shift)})">${tileSvg(l)}</pattern></defs>` +
          `<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="url(#p${i})"/>`,
      );
    });
    // Above the falling weather: the paving is where it lands, not a window onto it.
    parts.push(house);
    parts.push(terraceFrame(sky, areas, fx, { puddles, mist }, t, loop, u));
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
    // A double flash, each lasting two frames.
    const flash = storm ? { [count - 6]: 0.4, [count - 5]: 0.3, [count - 3]: 0.28, [count - 2]: 0.16 }[f] : undefined;
    if (flash) parts.push(`<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="rgba(214,222,255,${flash})"/>`);
    frames.push(svg(W, H, `${clip}<g clip-path="url(#wc)">${parts.join('')}</g>`));
  }
  return { frames, intervalMs };
}
