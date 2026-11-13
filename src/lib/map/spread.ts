import { pointInPolygon } from './geometry';
import type { FloorPoint, HomeMap, MapLight, MapRoom } from './map';
import { isInside, roomArea, roomOfPoint } from './route';

/**
 * Where lights sit for the map-aware moods that aren't paths: a gradient sweep (how far along an
 * arrow), a spotlight (how close to a point) and a room glow (which colored room). Pure: map
 * coordinates in meters, no Hue data. `usable` filters lights out (smart plugs, unreachable).
 */

type Usable = (l: MapLight) => boolean;
const all: Usable = () => true;

const walled = (map: HomeMap) => map.rooms.filter((r) => r.points.length >= 3);

/** The rooms a pick covers: the rooms picked and the rooms inside them (a nightstand corner). */
export function roomsWithin(map: HomeMap, ids: string[]): Set<string> {
  const picked = new Set(ids);
  const outer = walled(map).filter((r) => picked.has(r.id));
  for (const r of walled(map)) if (!picked.has(r.id) && outer.some((o) => isInside(r, o))) picked.add(r.id);
  return picked;
}

/** Placed lights in some rooms (null = every placed light of the home). */
export function lightsIn(map: HomeMap, ids: string[] | null, usable: Usable = all): MapLight[] {
  const lights = map.lights.filter(usable);
  if (!ids) return lights;
  const within = roomsWithin(map, ids);
  return lights.filter((l) => {
    const r = roomOfPoint(map, l);
    return !!r && within.has(r.id);
  });
}

/** A direction in map coordinates (degrees, 0 = +x, 90 = +z). */
export const direction = (angle: number): FloorPoint => ({ x: Math.cos((angle * Math.PI) / 180), z: Math.sin((angle * Math.PI) / 180) });

const dot = (p: FloorPoint, d: FloorPoint) => p.x * d.x + p.z * d.z;

/**
 * How far along a sweep each light sits: 0 at the tail of the arrow, 1 at its head, spread
 * between the first and the last light along it (so the end colors always show). Lights level
 * with each other (less than 20 cm apart along the arrow) all sit in the middle.
 */
export function sweepPositions(map: HomeMap, angle: number, ids: string[] | null, usable: Usable = all): Map<string, number> {
  const d = direction(angle);
  const lights = lightsIn(map, ids, usable);
  const along = lights.map((l) => dot(l, d));
  const lo = Math.min(...along);
  const span = Math.max(...along) - lo;
  return new Map(lights.map((l, i) => [l.lightId, span < 0.2 ? 0.5 : (along[i] - lo) / span]));
}

/** The arrow of a sweep, drawn across the rooms it covers (through their middle, 80% of their extent). */
export function sweepArrow(map: HomeMap, angle: number, ids: string[] | null): { from: FloorPoint; to: FloorPoint } {
  const d = direction(angle);
  const n = { x: -d.z, z: d.x };
  const within = ids ? roomsWithin(map, ids) : null;
  const rooms = walled(map).filter((r) => !within || within.has(r.id));
  const pts = rooms.length ? rooms.flatMap((r) => r.points) : map.lights.length ? map.lights : [{ x: 0, z: 0 }];
  const a = pts.map((p) => dot(p, d));
  const b = pts.map((p) => dot(p, n));
  const ca = (Math.min(...a) + Math.max(...a)) / 2;
  const cb = (Math.min(...b) + Math.max(...b)) / 2;
  const half = Math.max(0.5, ((Math.max(...a) - Math.min(...a)) / 2) * 0.8);
  const c = { x: d.x * ca + n.x * cb, z: d.z * ca + n.z * cb };
  return { from: { x: c.x - d.x * half, z: c.z - d.z * half }, to: { x: c.x + d.x * half, z: c.z + d.z * half } };
}

/** The angle (degrees) from a point to another, for turning the arrow towards a finger. */
export const angleTo = (from: FloorPoint, to: FloorPoint) => (Math.atan2(to.z - from.z, to.x - from.x) * 180) / Math.PI;

/**
 * A spotlight: each light within `radius` of the point, weighted 1 right under it down to 0 at
 * the edge, on a soft curve (half way out is still a little over half as bright).
 */
export function spotWeights(map: HomeMap, at: FloorPoint, radius: number, usable: Usable = all): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of map.lights.filter(usable)) {
    const k = Math.hypot(l.x - at.x, l.z - at.z) / Math.max(0.1, radius);
    if (k < 1) out.set(l.lightId, (1 - k * k) ** 2);
  }
  return out;
}

/** Where a new spotlight goes: the middle of the biggest room (or of the lights). */
export function defaultSpot(map: HomeMap): FloorPoint {
  const big = walled(map).sort((a, b) => roomArea(b.points) - roomArea(a.points))[0];
  const pts = big?.points ?? map.lights;
  if (!pts.length) return { x: 0, z: 0 };
  return { x: (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2, z: (Math.min(...pts.map((p) => p.z)) + Math.max(...pts.map((p) => p.z))) / 2 };
}

/**
 * A room glow: the colored room each light takes its color from, the smallest colored room
 * around it (a nightstand corner with its own color wins over the bedroom; without one, its
 * lights take the bedroom's). Lights in no colored room are left out.
 */
export function glowRooms(map: HomeMap, colored: Set<string>, usable: Usable = all): Map<string, string> {
  const rooms = walled(map)
    .filter((r) => colored.has(r.id))
    .sort((a, b) => roomArea(a.points) - roomArea(b.points));
  const out = new Map<string, string>();
  for (const l of map.lights.filter(usable)) {
    const r = rooms.find((x) => pointInPolygon(l, x.points));
    if (r) out.set(l.lightId, r.id);
  }
  return out;
}

/** The room under a point on the map (the smallest one), for picking rooms by tapping them. */
export const roomAt = (map: HomeMap, p: FloorPoint): MapRoom | null => roomOfPoint(map, p);
