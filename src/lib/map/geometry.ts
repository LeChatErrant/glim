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

/**
 * Editor snapping: aligns x and z independently with nearby corners (so walls line up),
 * otherwise rounds to a 5 cm grid.
 */
export function snapPoint(p: FloorPoint, others: FloorPoint[], radius = 0.15): FloorPoint {
  let x = Math.round(p.x / 0.05) * 0.05;
  let z = Math.round(p.z / 0.05) * 0.05;
  let bestX = radius;
  let bestZ = radius;
  for (const o of others) {
    if (Math.abs(o.x - p.x) < bestX) {
      bestX = Math.abs(o.x - p.x);
      x = o.x;
    }
    if (Math.abs(o.z - p.z) < bestZ) {
      bestZ = Math.abs(o.z - p.z);
      z = o.z;
    }
  }
  return { x, z };
}
