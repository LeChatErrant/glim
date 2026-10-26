import type { FloorPoint } from './map';

/** A rigid 2D transform on the floor: p' = R·p + t (rotation, then translation). */
export type Transform = { cos: number; sin: number; tx: number; tz: number };

export const IDENTITY: Transform = { cos: 1, sin: 0, tx: 0, tz: 0 };

export function apply(t: Transform, p: FloorPoint): FloorPoint {
  return { x: t.cos * p.x - t.sin * p.z + t.tx, z: t.sin * p.x + t.cos * p.z + t.tz };
}

export function invert(t: Transform): Transform {
  // R⁻¹ = Rᵀ, t' = -Rᵀ·t
  return { cos: t.cos, sin: -t.sin, tx: -(t.cos * t.tx + t.sin * t.tz), tz: -(-t.sin * t.tx + t.cos * t.tz) };
}

/**
 * Rotation + translation that maps a1 → A and b1 → B as closely as possible (no scaling).
 * Used to line up a new AR session with a saved map from 2 matched corners.
 */
export function fromTwoPoints(a1: FloorPoint, b1: FloorPoint, A: FloorPoint, B: FloorPoint): Transform {
  const angle = Math.atan2(B.z - A.z, B.x - A.x) - Math.atan2(b1.z - a1.z, b1.x - a1.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Align the midpoints, which spreads the error between both corners.
  const m = { x: (a1.x + b1.x) / 2, z: (a1.z + b1.z) / 2 };
  const M = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
  return { cos, sin, tx: M.x - (cos * m.x - sin * m.z), tz: M.z - (sin * m.x + cos * m.z) };
}

/** Rotates so the first wall is horizontal, and puts its first corner at the origin. */
export function normalizingTransform(points: FloorPoint[]): Transform {
  if (points.length < 2) return IDENTITY;
  const [a, b] = points;
  const angle = -Math.atan2(b.z - a.z, b.x - a.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { cos, sin, tx: -(cos * a.x - sin * a.z), tz: -(sin * a.x + cos * a.z) };
}

export function distance(a: FloorPoint, b: FloorPoint) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function pointInPolygon(p: FloorPoint, poly: FloorPoint[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function centroid(poly: FloorPoint[]): FloorPoint {
  const n = poly.length || 1;
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, z: poly.reduce((s, p) => s + p.z, 0) / n };
}

/** A wall of a room: two consecutive corners. */
export type Segment = [FloorPoint, FloorPoint];

/** The walls of a room outline, closed when it has 3 corners or more. */
export function roomWalls(points: FloorPoint[]): Segment[] {
  if (points.length < 2) return [];
  if (points.length === 2) return [[points[0], points[1]]];
  return points.map((p, i) => [p, points[(i + 1) % points.length]]);
}

export function closestOnSegment(p: FloorPoint, a: FloorPoint, b: FloorPoint): FloorPoint {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return { x: a.x + t * dx, z: a.z + t * dz };
}

/** What a drag snapped to, drawn while dragging: a corner (ring) or a wall / alignment line (dashed). */
export type SnapGuide = { kind: 'point'; at: FloorPoint } | { kind: 'line'; a: FloorPoint; b: FloorPoint };

/** Snap distances in meters (the editor derives them from screen pixels and its zoom). */
export type SnapTolerance = { corner: number; wall: number; axis: number };

/** Corners and walls of the other rooms, which a dragged corner or room snaps to. */
export type SnapTargets = { corners: FloorPoint[]; walls: Segment[] };

export type Snapped = { point: FloorPoint; guides: SnapGuide[] };

const GRID = 0.05;

/** Aligns x and z independently with nearby corners (so walls line up), otherwise rounds to a 5 cm grid. */
function alignToCorners(p: FloorPoint, others: FloorPoint[], radius: number): Snapped {
  let x = Math.round(p.x / GRID) * GRID;
  let z = Math.round(p.z / GRID) * GRID;
  let bestX = radius;
  let bestZ = radius;
  let byX: FloorPoint | null = null;
  let byZ: FloorPoint | null = null;
  for (const o of others) {
    if (Math.abs(o.x - p.x) < bestX) {
      bestX = Math.abs(o.x - p.x);
      x = o.x;
      byX = o;
    }
    if (Math.abs(o.z - p.z) < bestZ) {
      bestZ = Math.abs(o.z - p.z);
      z = o.z;
      byZ = o;
    }
  }
  const point = { x, z };
  const guides: SnapGuide[] = [];
  if (byX) guides.push({ kind: 'line', a: byX, b: point });
  if (byZ) guides.push({ kind: 'line', a: byZ, b: point });
  return { point, guides };
}

/**
 * Editor snapping: aligns x and z independently with nearby corners (so walls line up),
 * otherwise rounds to a 5 cm grid.
 */
export function snapPoint(p: FloorPoint, others: FloorPoint[], radius = 0.15): FloorPoint {
  return alignToCorners(p, others, radius).point;
}

/**
 * Snaps a dragged corner, first match wins: onto another room's corner, else onto another
 * room's wall (closest point), else x/z aligned with nearby corners (`align`), else the grid.
 */
export function snapCorner(p: FloorPoint, targets: SnapTargets & { align: FloorPoint[] }, tol: SnapTolerance): Snapped {
  let corner: FloorPoint | null = null;
  let best = tol.corner;
  for (const q of targets.corners) {
    const d = distance(p, q);
    if (d < best) {
      best = d;
      corner = q;
    }
  }
  if (corner) return { point: { x: corner.x, z: corner.z }, guides: [{ kind: 'point', at: corner }] };

  let onWall: Snapped | null = null;
  best = tol.wall;
  for (const [a, b] of targets.walls) {
    const c = closestOnSegment(p, a, b);
    const d = distance(p, c);
    if (d < best) {
      best = d;
      onWall = { point: c, guides: [{ kind: 'line', a, b }] };
    }
  }
  return onWall ?? alignToCorners(p, targets.align, tol.axis);
}

/**
 * Snaps a moved room (rigid: translation only) so it touches its neighbors. Returns the
 * correction to add to every corner: the smallest that makes one of its corners coincide
 * with another room's corner, else the smallest that puts one of its corners on another
 * room's wall or one of its walls on another room's corner. Parallel walls a small gap
 * apart always have such a pair, so this also closes the gap onto a shared wall line.
 */
export function snapRoom(points: FloorPoint[], targets: SnapTargets, tol: SnapTolerance): { offset: FloorPoint; guides: SnapGuide[] } {
  let found: { offset: FloorPoint; guides: SnapGuide[] } | null = null;
  let best = tol.corner;
  for (const p of points) {
    for (const q of targets.corners) {
      const d = distance(p, q);
      if (d < best) {
        best = d;
        found = { offset: { x: q.x - p.x, z: q.z - p.z }, guides: [{ kind: 'point', at: q }] };
      }
    }
  }
  if (found) return found;

  best = tol.wall;
  for (const p of points) {
    for (const [a, b] of targets.walls) {
      const c = closestOnSegment(p, a, b);
      const d = distance(p, c);
      if (d < best) {
        best = d;
        found = { offset: { x: c.x - p.x, z: c.z - p.z }, guides: [{ kind: 'line', a, b }] };
      }
    }
  }
  for (const [a, b] of roomWalls(points)) {
    for (const q of targets.corners) {
      const c = closestOnSegment(q, a, b);
      const d = distance(q, c);
      if (d < best) {
        best = d;
        const o = { x: q.x - c.x, z: q.z - c.z };
        const line: SnapGuide = { kind: 'line', a: { x: a.x + o.x, z: a.z + o.z }, b: { x: b.x + o.x, z: b.z + o.z } };
        found = { offset: o, guides: [line, { kind: 'point', at: q }] };
      }
    }
  }
  return found ?? { offset: { x: 0, z: 0 }, guides: [] };
}
