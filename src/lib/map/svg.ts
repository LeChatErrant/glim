import type { Light } from '../hue/client';
import { inkOn, LIGHT_ICON_PATHS } from '../lightIcons';
import { lightType } from '../lights';
import { color, hairline } from '../../ui/theme';
import { placeLights, walledRooms, type PlacedLight } from './glow';
import { fitPlan, type Plan } from './map';

// Nocturne plan colors (hairline walls, near-black floors).
export const PLAN_COLORS = {
  wall: 'rgba(242,232,216,0.32)',
  roomFill: '#0B0B0D',
  outdoorFill: '#070708',
  label: 'rgba(242,232,216,0.72)',
  off: '#050506',
  offStroke: 'rgba(242,232,216,0.55)',
  unreachable: '#1E1B18',
};

/** Muted look of the last known state when the bridge can't be reached. */
const STALE = { core: '#5A554E', ring: 'rgba(185,176,162,0.35)', hollow: hairline(0.3) };

type Opts = {
  /** Padding around the plan, in px. */
  padding?: number;
  /** Ground color behind the markers (the dark gap of a jewel). */
  ground?: string;
  /** Bridge unreachable: draw the last known state, muted and without glows. */
  stale?: boolean;
};

/**
 * The floor plan as an SVG string, for the map widget (widgets can only show images). Same look
 * as the app's FloorPlan: light pools shaped by light type and clipped to their room's walls,
 * hairline walls, jewel markers on top. Room names are drawn by the widget itself (real fonts).
 */
export function planToSvg(plan: Plan, lights: Light[], width: number, height: number, opts: Opts = {}) {
  const { padding = 14, ground = color.ground, stale = false } = opts;
  const f = fitPlan(plan, width, height, padding);
  const walled = walledRooms(plan);
  const zones = plan.rooms.filter((r) => r.pts.length >= 3 && !walled.includes(r));
  const placed = placeLights(plan, lights);
  const lit = stale ? [] : placed.filter((p) => p.light.on && p.light.reachable);
  const px = (m: number) => m * f.scale;
  const n = (v: number) => v.toFixed(1);
  const pathOf = (pts: { u: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${n(f.x(p.u))},${n(f.y(p.v))}`).join(' ') + ' Z';
  // Marker size follows the plan scale: 20 px on a roomy map, 13 px when the home is squeezed.
  const size = Math.max(13, Math.min(20, Math.round(f.scale * 0.55)));

  const defs: string[] = [];
  const body: string[] = [];

  walled.forEach((r, i) => defs.push(`<clipPath id="c${i}"><path d="${pathOf(r.pts)}"/></clipPath>`));
  lit.forEach((p, i) => {
    const c = p.light.color;
    defs.push(
      `<radialGradient id="g${i}" cx="50%" cy="50%" r="50%">` +
        `<stop offset="0" stop-color="${c}" stop-opacity="1"/><stop offset="0.22" stop-color="${c}" stop-opacity="0.42"/>` +
        `<stop offset="0.55" stop-color="${c}" stop-opacity="0.14"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`,
      `<radialGradient id="j${i}" cx="50%" cy="50%" r="50%">` +
        `<stop offset="0" stop-color="${c}" stop-opacity="0.85"/><stop offset="0.4" stop-color="${c}" stop-opacity="0.35"/>` +
        `<stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`,
    );
  });

  for (const r of walled) body.push(`<path d="${pathOf(r.pts)}" fill="${r.outdoor ? color.floorOutdoor : color.floor}"/>`);

  lit.forEach((p, i) => {
    const clip = p.room ? ` clip-path="url(#c${walled.indexOf(p.room)})"` : '';
    const pools = p.pools.map((pool) => {
      const cx = n(f.x(pool.u));
      const cy = n(f.y(pool.v));
      const rot = pool.angle ? ` transform="rotate(${n((pool.angle * 180) / Math.PI)} ${cx} ${cy})"` : '';
      return `<ellipse cx="${cx}" cy="${cy}" rx="${n(Math.max(px(pool.rx), 10))}" ry="${n(Math.max(px(pool.ry), 10))}"${rot} fill="url(#g${i})"/>`;
    });
    body.push(`<g${clip} opacity="${(p.pools[0]?.alpha ?? 1).toFixed(2)}">${pools.join('')}</g>`);
  });

  for (const r of walled) {
    const dash = r.outdoor ? ' stroke-dasharray="3 4"' : '';
    body.push(`<path d="${pathOf(r.pts)}" fill="none" stroke="${hairline(r.outdoor ? 0.2 : 0.24)}" stroke-width="1"${dash}/>`);
  }
  for (const r of zones) body.push(`<path d="${pathOf(r.pts)}" fill="none" stroke="${hairline(0.2)}" stroke-width="1" stroke-dasharray="2 3"/>`);

  for (const p of placed) {
    if (!p.line) continue;
    const on = p.light.on && p.light.reachable && !stale;
    const xy = `points="${p.line.map((q) => `${n(f.x(q.u))},${n(f.y(q.v))}`).join(' ')}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (on) body.push(`<polyline ${xy} stroke="${p.light.color}" stroke-opacity="0.45" stroke-width="6"/>`);
    body.push(`<polyline ${xy} stroke="${on ? '#FFE2B0' : stale ? STALE.core : '#4A4640'}" stroke-width="2"/>`);
  }

  for (const p of placed) {
    if (p.shape !== 'string') continue;
    const on = p.light.on && p.light.reachable && !stale;
    const gi = lit.indexOf(p);
    for (const b of p.beads) {
      const cx = n(f.x(b.u));
      const cy = n(f.y(b.v));
      if (on) body.push(`<circle cx="${cx}" cy="${cy}" r="4.5" fill="url(#j${gi})"/>`);
      body.push(`<circle cx="${cx}" cy="${cy}" r="1.6" fill="${on ? '#FFE2B0' : stale ? STALE.core : '#4A4640'}"/>`);
    }
  }

  placed.forEach((p) => body.push(jewel(p, f.x(p.u), f.y(p.v), size, ground, stale, lit.indexOf(p))));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${defs.join('')}</defs>${body.join('')}</svg>`
  );
}

/**
 * A light marker as SVG, like the app's LightMarker: a jewel holding the icon of what the light
 * is. On = filled with its color, gap, ivory ring, glow; off = hollow; unreachable = dashed amber
 * ring, faded icon, strike-through.
 */
function jewel(p: PlacedLight, x: number, y: number, size: number, ground: string, stale: boolean, glowId: number) {
  const { light } = p;
  const on = light.on && light.reachable;
  const at = (d: number) => d.toFixed(1);
  const r = size / 2;
  const out: string[] = [];
  const circle = (rr: number, attrs: string) => `<circle cx="${at(x)}" cy="${at(y)}" r="${at(rr)}" ${attrs}/>`;
  let ink: string;
  if (!light.reachable) {
    out.push(circle(r, `fill="${ground}" stroke="${color.warning}" stroke-width="1" stroke-dasharray="2 2"`));
    ink = hairline(0.32);
  } else if (on && stale) {
    out.push(circle(r + 2.5, `fill="${STALE.ring}"`), circle(r + 1.5, `fill="${ground}"`), circle(r, `fill="${STALE.core}"`));
    ink = 'rgba(24,14,6,0.7)';
  } else if (on) {
    out.push(circle(r + 9, `fill="url(#j${glowId})"`));
    out.push(circle(r + 2.5, `fill="${color.jewelRing}"`), circle(r + 1.5, `fill="${ground}"`), circle(r, `fill="${light.color}"`));
    ink = inkOn(light.color);
  } else {
    out.push(circle(r, `fill="${ground}" stroke="${stale ? STALE.hollow : hairline(0.55)}" stroke-width="1"`));
    ink = stale ? hairline(0.45) : hairline(0.78);
  }
  const icon = size * 0.6;
  const k = icon / 24;
  out.push(
    `<path d="${LIGHT_ICON_PATHS[lightType(light.archetype)]}" fill="none" stroke="${ink}" stroke-width="${at(1.3 / k)}" ` +
      `stroke-linecap="round" stroke-linejoin="round" transform="translate(${at(x - icon / 2)} ${at(y - icon / 2)}) scale(${k.toFixed(3)})"/>`,
  );
  if (!light.reachable) {
    const d = r * 0.8;
    out.push(`<path d="M${at(x - d)} ${at(y + d)}L${at(x + d)} ${at(y - d)}" stroke="${color.warning}" stroke-width="1.4" stroke-linecap="round"/>`);
  }
  return out.join('');
}

/** A small jewel on its own (room tiles), centered in a `box` px square. */
export function jewelSvg(opts: { color: string; on: boolean; plug: boolean; unreachable?: boolean; stale?: boolean; box?: number; ground?: string }) {
  const { box = 24, ground = color.ground } = opts;
  const c = box / 2;
  const size = 9;
  const parts: string[] = [];
  const shape = (grow: number, attrs: string) => {
    if (opts.plug) {
      const s = (size - 2) / 2 + grow;
      return `<rect x="${c - s}" y="${c - s}" width="${2 * s}" height="${2 * s}" transform="rotate(45 ${c} ${c})" ${attrs}/>`;
    }
    return `<circle cx="${c}" cy="${c}" r="${size / 2 + grow}" ${attrs}/>`;
  };
  if (opts.unreachable) {
    parts.push(`<circle cx="${c}" cy="${c}" r="${size / 2 + 2.5}" fill="none" stroke="${color.warning}" stroke-width="1.2" stroke-dasharray="2 2"/>`);
    parts.push(`<path d="M${c} ${c - 3}V${c + 0.8}" stroke="${color.warning}" stroke-width="1.4" stroke-linecap="round"/>`);
    parts.push(`<circle cx="${c}" cy="${c + 3}" r="0.8" fill="${color.warning}"/>`);
  } else if (opts.on && opts.stale) {
    parts.push(shape(3, `fill="${STALE.ring}"`), shape(2, `fill="${ground}"`), shape(0, `fill="${STALE.core}"`));
  } else if (opts.on) {
    parts.push(
      `<defs><radialGradient id="j" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${opts.color}" stop-opacity="0.85"/>` +
        `<stop offset="0.4" stop-color="${opts.color}" stop-opacity="0.35"/><stop offset="1" stop-color="${opts.color}" stop-opacity="0"/></radialGradient></defs>`,
      `<circle cx="${c}" cy="${c}" r="${c}" fill="url(#j)"/>`,
      shape(3, `fill="${color.jewelRing}"`),
      shape(2, `fill="${ground}"`),
      shape(0, `fill="${opts.color}"`),
    );
  } else {
    parts.push(shape(0, `fill="none" stroke="${opts.stale ? STALE.hollow : hairline(0.55)}" stroke-width="1"`));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">${parts.join('')}</svg>`;
}

/** Small line icons for widgets (24 px grid, stroked). */
export function iconSvg(name: 'plan' | 'cloudOff' | 'rotate' | 'prev' | 'next', stroke: string, px = 16) {
  const paths = {
    rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15"/>',
    prev: '<path d="m15 5-7 7 7 7"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    plan: '<path d="M3 4h11v9H3zM14 4h7v6h-7zM14 10h7v10h-7zM3 13h11v7H3z"/>',
    cloudOff: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18Z"/><path d="M4 4l16 16"/>',
  }[name];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
  );
}
