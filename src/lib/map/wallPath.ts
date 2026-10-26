type UV = { u: number; v: number };

/**
 * Lightstrips and string lights placed this close to a wall (and not turned by hand) run along
 * the room's walls, around its corners.
 */
export const WALL_RUN_M = 1.2;
/** A strip on the wall is drawn this far inside it, so it stays in its room. */
const INSET_M = 0.05;

/**
 * A strip or string along the walls of a room outline: it starts at `from` meters around the
 * outline (from corner 0, in point order) and runs `len` meters, wrapping past corner 0.
 */
export type WallRun = { pts: UV[]; cum: number[]; total: number; from: number; len: number };

/** Distance around the outline at each corner, and the whole perimeter. */
function measure(pts: UV[]) {
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    cum.push(cum[i] + Math.hypot(b.u - a.u, b.v - a.v));
  }
  return { cum, total: cum[pts.length] };
}

/** Where a point is along the outline (`s`, meters from corner 0) and how far from the nearest wall. */
export function locate(pts: UV[], p: UV) {
  const { cum, total } = measure(pts);
  let best = { s: 0, dist: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = cum[i + 1] - cum[i];
    if (!len) continue;
    const t = Math.max(0, Math.min(1, ((p.u - a.u) * (b.u - a.u) + (p.v - a.v) * (b.v - a.v)) / (len * len)));
    const dist = Math.hypot(p.u - (a.u + (b.u - a.u) * t), p.v - (a.v + (b.v - a.v) * t));
    if (dist < best.dist) best = { s: cum[i] + t * len, dist };
  }
  return { ...best, total };
}

/** The run centered on the point nearest to `p`, or null when `p` is too far from every wall. */
export function wallRun(pts: UV[], p: UV, length: number): WallRun | null {
  if (pts.length < 3) return null;
  const at = locate(pts, p);
  if (at.dist > WALL_RUN_M || !at.total) return null;
  const len = Math.min(length, at.total);
  return { pts, ...measure(pts), from: at.s - len / 2, len };
}

/** Unit normal of wall `i`, pointing into the room (whatever the outline's winding). */
function inward(pts: UV[], i: number): UV {
  const n = pts.length;
  let area = 0;
  for (let k = 0; k < n; k++) area += pts[k].u * pts[(k + 1) % n].v - pts[(k + 1) % n].u * pts[k].v;
  const a = pts[((i % n) + n) % n];
  const b = pts[(((i + 1) % n) + n) % n];
  const len = Math.hypot(b.u - a.u, b.v - a.v) || 1;
  const left = { u: -(b.v - a.v) / len, v: (b.u - a.u) / len };
  return area > 0 ? left : { u: -left.u, v: -left.v };
}

/** The point `s` meters around the outline, `inset` meters inside the room. */
export function pointAt(r: Pick<WallRun, 'pts' | 'cum' | 'total'>, s: number, inset = INSET_M): UV {
  const n = r.pts.length;
  const w = ((s % r.total) + r.total) % r.total;
  let i = 0;
  while (i < n - 1 && r.cum[i + 1] <= w) i++;
  const a = r.pts[i];
  const b = r.pts[(i + 1) % n];
  const len = r.cum[i + 1] - r.cum[i] || 1;
  const t = (w - r.cum[i]) / len;
  const nrm = inward(r.pts, i);
  return { u: a.u + (b.u - a.u) * t + nrm.u * inset, v: a.v + (b.v - a.v) * t + nrm.v * inset };
}

/** Positions (meters around the outline) of the corners the run turns at, in order. */
function cornersOn(r: WallRun) {
  const out: { s: number; i: number }[] = [];
  const end = r.from + r.len;
  for (let k = Math.floor(r.from / r.total); k * r.total < end; k++) {
    for (let i = 0; i < r.pts.length; i++) {
      const s = k * r.total + r.cum[i];
      if (s > r.from + 1e-6 && s < end - 1e-6) out.push({ s, i });
    }
  }
  return out;
}

/** The run as a polyline: its start, every corner it turns at, its end. */
export function runPath(r: WallRun, inset = INSET_M): UV[] {
  const corner = (i: number) => {
    const p = r.pts[i];
    const a = inward(r.pts, i - 1);
    const b = inward(r.pts, i);
    const len = Math.hypot(a.u + b.u, a.v + b.v) || 1;
    return { u: p.u + ((a.u + b.u) / len) * inset, v: p.v + ((a.v + b.v) / len) * inset };
  };
  return [pointAt(r, r.from, inset), ...cornersOn(r).map((c) => corner(c.i)), pointAt(r, r.from + r.len, inset)];
}

/**
 * `count` points evenly along the run (string light beads). `sag(t)` pushes each one into the
 * room, t going 0 → 1 between two attachment points (the run's ends and the corners it turns at).
 */
export function runSamples(r: WallRun, count: number, sag: (t: number) => number = () => 0): UV[] {
  const stops = [r.from, ...cornersOn(r).map((c) => c.s), r.from + r.len];
  return Array.from({ length: count }, (_, k) => {
    const s = r.from + (r.len * k) / Math.max(count - 1, 1);
    let j = 0;
    while (j < stops.length - 2 && stops[j + 1] <= s) j++;
    const t = (s - stops[j]) / (stops[j + 1] - stops[j] || 1);
    return pointAt(r, s, INSET_M + sag(t));
  });
}

/** Shortest signed step from position a to position b around an outline of length `total`. */
export function wrapStep(a: number, b: number, total: number) {
  const d = (((b - a) % total) + total) % total;
  return d > total / 2 ? d - total : d;
}
