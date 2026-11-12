import type { Light } from '../hue/client';
import { placeLights, walledRooms } from '../map/glow';
import type { Plan } from '../map/map';
import { clamp, mix, rgba, rng, smooth, type RGB, type Sky } from './sky';

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
  /** Every lit lamp (string lights aside), with its pool's radius: it spills into the garden. */
  lamps: { x: number; y: number; color: string; r: number }[];
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
    lamps: lit
      .filter((p) => !p.beads.length && p.pools[0])
      .map((p) => ({ x: f.x(p.u), y: f.y(p.v), color: p.light.color, r: Math.max(p.pools[0].rx, p.pools[0].ry) * f.scale })),
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

/** Where the sun is, above the map: it only sets which way the house's shadow falls. */
function sunAt(sky: Sky, W: number, u: number) {
  return { x: W * (0.12 + 0.76 * sky.arc), y: -70 * u - 50 * u * Math.sin(Math.PI * sky.arc) };
}

const dim = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** The light of the hour around the house: near the walls, and further out. */
function ambience(sky: Sky) {
  const k = 0.72 * (1 - 0.3 * sky.cloud);
  return { near: dim(mix(sky.mid, sky.low, 0.25), k), far: dim(mix(sky.mid, sky.top, 0.45), k * 0.9) };
}

/** An outdoor room's floor on the plan (theme `floorOutdoor`). */
const OUTDOOR_FLOOR: RGB = [7, 7, 8];

/**
 * The ground around the house takes the light of the hour, not a real view: the sky's color all
 * around (blue at noon, orange at golden hour, navy at night), warmer near the walls, duller
 * under clouds. The darkness beyond is drawn on top (darknessSvg).
 */
export function groundSvg(sky: Sky, W: number, H: number, geom: HouseGeom, u: number) {
  const b = geom.box ?? { x: 0, y: 0, w: W, h: H };
  const { near, far } = ambience(sky);
  const R = Math.max(b.w, b.h) * 0.6 + 45 * u;
  const all = `x="${n(-W)}" y="${n(-H)}" width="${n(W * 3)}" height="${n(H * 3)}"`;
  return `<defs>${radial('gn', b.x + b.w / 2, b.y + b.h / 2, R, [[0, rgba(near)], [0.55, rgba(mix(near, far, 0.5))], [1, rgba(far)]])}</defs><rect ${all} fill="url(#gn)"/>`;
}

/** Around the house: its soft shadow by day, the warm light it leaks at night, a snowy rim. */
/** `origin`: where `geom`'s (0, 0) sits on the screen the sky is laid out on (W wide). */
export function houseSvg(sky: Sky, W: number, geom: HouseGeom, u: number, sparkle = true, origin: Pt = { x: 0, y: 0 }) {
  const out: string[] = [];
  const box = geom.box;
  if (!box) return '';
  const seen = sunAt(sky, W, u);
  const sun = { x: seen.x - origin.x, y: seen.y - origin.y };
  const shA = sky.day * (1 - sky.cloud * 0.85) * 0.75;
  if (shA > 0.03 && sky.alt > 1) {
    const len = clamp(14 / Math.tan((sky.alt * Math.PI) / 180), 8, 60) * u;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const d = Math.hypot(cx - sun.x, cy - sun.y) || 1;
    const sc = rgba(mix([26, 22, 58], sky.top, 0.15));
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

/**
 * Outdoor areas stay rooms of the plan (the dark outdoor floor, no paving or planks), touched by
 * the light of the hour, and the weather lands on them: wet sheen, snow cover, reflections.
 */
function outdoorSvg(sky: Sky, geom: HouseGeom, u: number, sparkle: boolean) {
  const out: string[] = [];
  const { near } = ambience(sky);
  outdoorAreas(geom, u).forEach((area, i) => {
    const { pts, box } = area;
    const d = poly(pts);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const floor = mix(OUTDOOR_FLOOR, near, 0.14);
    out.push(`<defs>${radial(`ol${i}`, cx, cy, Math.max(box.w, box.h) * 0.7, [[0, rgba(near, 0.16)], [1, rgba(near, 0.03)]])}</defs>`);
    out.push(`<path d="${d}" fill="${rgba(floor, 0.94)}"/><path d="${d}" fill="url(#ol${i})"/>`);
    if (sky.wet) out.push(`<path d="${d}" fill="rgba(150,175,220,0.08)"/>`);
    if (sky.weather === 'snow') {
      const cover = mix([150, 165, 205], [236, 241, 252], sky.day);
      out.push(
        `<defs><linearGradient id="os${i}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(box.y)}" x2="0" y2="${n(box.y + box.h)}">${stops([[0, rgba(cover, 0.8)], [0.3, rgba(cover, 0.62)], [0.7, rgba(cover, 0.56)], [1, rgba(cover, 0.74)]])}</linearGradient></defs>` +
          `<path d="${d}" fill="url(#os${i})"/>`,
      );
      // Drifts piled along the edges and in the corners, kept on the area (centered on its
      // outline, unclipped they spilled into the garden as pale blobs), with the lamps' glow.
      const drifts: string[] = [];
      pts.forEach((a, j) => {
        const b = pts[(j + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const along = Math.max(1, Math.round(len / (60 * u)));
        for (let k = 0; k <= along; k++) {
          const t = k / along;
          const corner = k === 0;
          const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
          drifts.push(ellipseBlob(`od${i}-${j}-${k}`, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, (corner ? 20 : horizontal ? 34 : 12) * u, (corner ? 16 : horizontal ? 9 : 30) * u, cover, 0.7));
        }
      });
      area.lights.forEach((l, k) => drifts.push(ellipseBlob(`sl${i}-${k}`, l.x, l.y, l.r * 1.6, l.r * 1.15, hexRgb(l.color), 0.36)));
      out.push(`<defs><clipPath id="oc${i}"><path d="${d}"/></clipPath></defs><g clip-path="url(#oc${i})">${drifts.join('')}</g>`);
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
  return out.join('');
}

/** An SVG showing only `box` of a drawing laid out in screen coordinates. */
export function svgBox(box: Box, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(box.w)}" height="${n(box.h)}" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}">${body}</svg>`;
}

/** Shallow puddles on a wet outdoor floor, holding the area's lights (they tremble in the app). */
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

/** A gloss band for a wet outdoor floor, centered at `x`. */
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
  /** Drops gathering at the eave, falling (along `nx`, `ny`: down the screen), each landing with a ring. */
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
          // Drops fall down the screen like the rain, whichever side of the area the eave is on:
          // they start far enough in to land on the floor.
          const inset = (e.ny < -0.5 ? 14 : 4) * u;
          fx.drips.push({ x: e.a.x + (e.b.x - e.a.x) * t + e.nx * inset, y: e.a.y + (e.b.y - e.a.y) * t + e.ny * inset, nx: 0, ny: 1, ms: (storm ? 1100 : 1800) + 800 * r(), phase: r() });
        }
      }
    }
    if (sky.weather === 'snow') {
      for (const p of pointsIn(area, clamp(Math.round(size / 2500), 6, 20), 67 + i, u)) fx.settle.push({ ...p, ms: 8000 + 4000 * r(), phase: r() });
    }
    if (sky.weather === 'cloudy') {
      ['#B8643A', '#C98A3E', '#8E5A34', '#A8703A'].forEach((color, k) => {
        fx.leaves.push({ x: area.box.x, y: area.box.y + area.box.h * (0.2 + 0.2 * k), span: area.box.w, color, ms: 18000 + 8000 * r(), phase: r() });
      });
    }
    if (sky.weather === 'clear' && sky.night > 0.6) {
      for (const l of area.lights) {
        if (l.beads.length) continue;
        [12, 18, 24].forEach((rad, k) => fx.moths.push({ x: l.x, y: l.y, r: rad * u, ms: [5000, 6500, 8000][k], dir: k % 2 ? -1 : 1, phase: r() }));
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

/**
 * How far we see past the walls, in dp, from the home's size: a clear zone (`clear`), then the
 * dark comes in over `fade`. The house is the light we see by; the garden is only around it.
 */
export function darkReach(geom: HouseGeom) {
  const side = geom.box ? Math.min(geom.box.w, geom.box.h) : 200;
  return { clear: clamp(0.22 * side, 16, 80), fade: clamp(0.5 * side, 40, 150) };
}

/**
 * The dark all around: whatever the hour, we see a clear zone around the house, then the
 * outside dies away in a long soft fade (gentle at first, a long tail), rounding off corners and
 * filling small notches on the way. Drawn as a mask of the rooms' outlines stroked wider and
 * wider, each stroke's opacity worked out so the dark grows smoothly with the distance; many
 * steps, so daylight shows no bands. `ink` is the screen's own black.
 */
export function darknessSvg(geom: HouseGeom, steps: number, area: Box, ink: string) {
  const shapes = [...geom.indoor, ...geom.outdoor];
  if (!shapes.length) return '';
  const d = shapes.map(poly).join('');
  const { clear, fade } = darkReach(geom);
  const reach = clear + fade;
  const dark = (x: number) => {
    const t = Math.max(0, x - clear) / fade;
    return Math.max(1e-4, 1 - Math.exp(-2.4 * Math.pow(t, 1.3)) * (1 - smooth(0.7, 1, t)));
  };
  const out: string[] = [];
  let beyond = 1;
  for (let i = steps; i >= 1; i--) {
    const want = dark(((i - 0.5) / steps) * reach);
    if (want / beyond < 0.9995) out.push(`<g opacity="${(1 - want / beyond).toFixed(3)}"><path d="${d}" fill="#000" stroke="#000" stroke-width="${n((2 * reach * i) / steps)}" stroke-linejoin="round"/></g>`);
    beyond = want;
  }
  const at = `x="${n(area.x)}" y="${n(area.y)}" width="${n(area.w)}" height="${n(area.h)}"`;
  return `<defs><mask id="dk" maskUnits="userSpaceOnUse" ${at}><rect ${at} fill="#fff"/>${out.join('')}<path d="${d}" fill="#000"/></mask></defs><rect ${at} fill="${ink}" mask="url(#dk)"/>`;
}

/**
 * Each lit lamp spills its own color past the walls, over the dark: the garden is lit from the
 * house. Stronger at night. The rooms' floors cover it indoors.
 */
export function spillSvg(sky: Sky, geom: HouseGeom, u: number) {
  const a = 0.32 * (0.35 + 0.65 * sky.night);
  return geom.lamps
    .map((l, i) => {
      const c = hexRgb(l.color);
      const r = clamp(l.r * 2.6, 30 * u, 220 * u);
      return `<defs>${radial(`sp${i}`, l.x, l.y, r, [[0, rgba(c, a)], [0.45, rgba(c, a * 0.35)], [1, rgba(c, 0)]])}</defs><circle cx="${n(l.x)}" cy="${n(l.y)}" r="${n(r)}" fill="url(#sp${i})"/>`;
    })
    .join('');
}

/** Cloud shadows crossing the ground on a grey day. */
export function cloudShadowsSvg(sky: Sky, W: number, H: number, u: number) {
  if (sky.day < 0.1 || (sky.weather !== 'cloudy' && sky.weather !== 'snow')) return '';
  const r = rng(12);
  const out: string[] = [];
  for (let i = 0; i < 3; i++) out.push(ellipseBlob(`cs${i}`, r() * W, H * (0.25 + 0.6 * r()), 150 * u, 90 * u, [22, 20, 46], 0.38 * sky.day));
  return out.join('');
}

/** Fog banks drifting both ways, `layer` 0 and 1. */
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
      return { tileW: w, tileH: h, angle: storm ? 22 : 14, particles, tilesPerLoop: s.tiles, loopMs: storm ? 800 : 1100 };
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
      return { tileW: t, tileH: t, angle: 0, particles, tilesPerLoop: 1, loopMs: 7000 };
    });
  }
  if (sky.weather === 'clear' && sky.warm * sky.day > 0.3) {
    const t = 260 * u;
    const r = rng(29);
    const c = rgba(mix(sky.wash, [255, 255, 255], 0.4), 0.9);
    const particles: Particle[] = [];
    for (let j = 0; j < 7; j++) particles.push({ x: 8 * u + r() * (t - 16 * u), y: 8 * u + r() * (t - 16 * u), w: 2.2 * u, h: 2.2 * u, color: c, glow: rgba(sky.wash, 0.25) });
    return [{ tileW: t, tileH: t, angle: 0, particles, tilesPerLoop: -1, loopMs: 20000 }];
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

/** Spots just outside the walls, `d` px out, spread along the outline (in the band we see). */
function alongWalls(geom: HouseGeom, count: number, seed: number, d: (r: () => number) => number): Pt[] {
  const shapes = [...geom.indoor, ...geom.outdoor];
  const edges = shapes.flatMap((pts) => pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length] })));
  const total = edges.reduce((sum, e) => sum + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), 0);
  if (!total) return [];
  const r = rng(seed);
  const out: Pt[] = [];
  for (let tries = 0; out.length < count && tries < count * 6; tries++) {
    let at = r() * total;
    const e = edges.find((e) => (at -= Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)) <= 0) ?? edges[0];
    const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1;
    const t = r();
    const off = d(r);
    // Either side of the wall: keep the one that is outside every room.
    for (const side of [1, -1]) {
      const p = { x: e.a.x + (e.b.x - e.a.x) * t + ((side * (e.b.y - e.a.y)) / len) * off, y: e.a.y + (e.b.y - e.a.y) * t - ((side * (e.b.x - e.a.x)) / len) * off };
      if (!shapes.some((s) => inside(p, s))) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

/** Rain rings on the ground around the house. */
export function ripples(sky: Sky, geom: HouseGeom, u: number) {
  if (!sky.wet) return [];
  const r = rng(5);
  // Slow, wide rings: outdoor areas get quick splashes instead (terraceFx).
  return alongWalls(geom, 10, 6, () => 16 * u).map((p) => ({ ...p, phase: r(), ms: 2400 + r() * 1000 }));
}

/** Fireflies drifting in the band around the house on a clear night. */
export function fireflies(sky: Sky, geom: HouseGeom, u: number) {
  if (sky.weather !== 'clear' || sky.night < 0.6) return [];
  const r = rng(19);
  return alongWalls(geom, 10, 20, (q) => (8 + q() * 20) * u).map((p) => ({ ...p, phase: r() }));
}

// ---- Widget frames ----

/**
 * A widget's weather loop, plus lightning on its own slow strip (a storm's loop is too short to
 * hold rare strikes): `flash` is drawn once, shown at `steps[i]` opacity for `stepMs` each.
 */
export type Frames = { frames: string[]; intervalMs: number; flash?: { svg: string; steps: number[]; stepMs: number } };

/** Two strikes per 24 s, unevenly spaced: a near double flash, then a faint far one. */
function lightningSteps() {
  const steps: number[] = new Array(120).fill(0);
  steps.splice(18, 4, 0.42, 0.1, 0.3, 0.06);
  steps.splice(76, 2, 0.16, 0.05);
  return steps;
}

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
 * the plan: ground, weather, outdoor areas, the dark all around (`reach` px from the walls). The
 * plan itself is drawn on top by the widget (its floors cover the inside).
 */
export function widgetFrames(sky: Sky, W: number, H: number, geom: HouseGeom, opts: { u: number; radius: number; ink: string }): Frames {
  const { u, radius, ink } = opts;
  const layers = particleLayers(sky, u);
  const rings = ripples(sky, geom, u);
  const flies = fireflies(sky, geom, u);
  const areas = outdoorAreas(geom, u);
  const fx = terraceFx(sky, areas, u);
  const puddles = areas.map((a, i) => puddlesSvg(sky, a, u, i)).join('');
  const mist = areas.map((a, i) => mistSvg(sky, a, u, i)).join('');
  const storm = sky.weather === 'storm';
  const drifting = sky.weather === 'fog' || (sky.weather !== 'clear' && sky.day > 0.1) || fx.moths.length > 0;
  // The launcher flips right on time, so smoothness comes from small steps between frames:
  // 25 fps rain whose streaks are longer than a frame's step; everything else is slow and calm,
  // so 10 fps over a long 6 s loop keeps each step under a pixel or two.
  let count = 1;
  let intervalMs = 1000;
  if (sky.wet) [count, intervalMs] = [32, 40];
  else if (sky.weather === 'snow' || layers.length || flies.length || drifting) [count, intervalMs] = [60, 100];
  const loop = count * intervalMs;

  const base = groundSvg(sky, W, H, geom, u);
  const house = houseSvg(sky, W, geom, u);
  const dark = darknessSvg(geom, 40, { x: -8, y: -8, w: W + 16, h: H + 16 }, ink) + spillSvg(sky, geom, u);
  const clip = `<defs><clipPath id="wc"><rect x="0" y="0" width="${n(W)}" height="${n(H)}" rx="${n(radius)}" ry="${n(radius)}"/></clipPath></defs>`;

  const frames: string[] = [];
  for (let f = 0; f < count; f++) {
    const t = (f * intervalMs) / loop;
    const sway = Math.sin(2 * Math.PI * t);
    const parts: string[] = [base];
    parts.push(`<g transform="translate(${n(6 * u * sway)} 0)">${cloudShadowsSvg(sky, W, H, u)}${fogSvg(sky, W, H, u, 0)}</g>`);
    layers.forEach((l, i) => {
      // A whole number of tiles per frame loop, so the last frame meets the first; rain falls
      // slower than in the app so each step stays shorter than a streak. A layer that moves less
      // than half a tile per loop (golden dust) bobs in place instead.
      const tiles = (Math.abs(l.tilesPerLoop) * loop) / l.loopMs;
      const bob = tiles < 0.5;
      const shift =
        bob
          ? 3 * u * Math.sin(2 * Math.PI * t) * Math.sign(l.tilesPerLoop)
          : l.tileH * Math.sign(l.tilesPerLoop) * Math.max(1, Math.round(tiles * (sky.wet ? WIDGET_RAIN : 1))) * t;
      const sideways = bob ? 2 * u * Math.cos(2 * Math.PI * t) : 0;
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
    parts.push(`<g transform="translate(${n(-7 * u * sway)} 0)">${fogSvg(sky, W, H, u, 1)}</g>`);
    parts.push(dark);
    for (const ff of flies) {
      const a = 2 * Math.PI * (t + ff.phase);
      const x = ff.x + 6 * u * Math.sin(a);
      const y = ff.y + 5 * u * Math.sin(2 * a);
      const o = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(2 * a + 1));
      parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(5 * u)}" fill="rgba(226,240,140,${(0.25 * o).toFixed(2)})"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(1.5 * u)}" fill="rgba(240,248,170,${(0.95 * o).toFixed(2)})"/>`);
    }
    frames.push(svg(W, H, `${clip}<g clip-path="url(#wc)">${parts.join('')}</g>`));
  }
  const flash = storm ? { svg: svg(W, H, `${clip}<rect x="0" y="0" width="${n(W)}" height="${n(H)}" clip-path="url(#wc)" fill="rgb(214,222,255)"/>`), steps: lightningSteps(), stepMs: 200 } : undefined;
  return { frames, intervalMs, flash };
}
