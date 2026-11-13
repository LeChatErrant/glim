import { centroid, closestOnSegment, distance, pointInPolygon, roomWalls } from './geometry';
import type { FloorPoint, HomeMap, MapLight, MapRoom } from './map';

/**
 * Routes through the home for paths (night path): rooms are linked where they share a wall (a
 * doorway, somewhere along it) or where one sits inside another (a nightstand corner in a
 * bedroom). A route goes from room to room through the middle of each shared wall. Pure: map
 * coordinates in meters, no Hue data.
 */

const SAMPLE = 0.1; // m between samples along a wall
const SHARED = 0.45; // m: two walls this close are the same wall (wall thickness, approximate scans)
const MIN_SHARED = 0.6; // m of shared wall to count as a way through
const OUTDOOR_DETOUR = 5; // m added for walking through an outdoor room on the way

export function roomArea(points: FloorPoint[]) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += (points[j].x + points[i].x) * (points[j].z - points[i].z);
  return Math.abs(a / 2);
}

/** A point inside a room: its centroid, or the inside point nearest to it (L-shaped rooms). */
export function insidePoint(points: FloorPoint[]): FloorPoint {
  const c = centroid(points);
  if (points.length < 3 || pointInPolygon(c, points)) return c;
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  let best: FloorPoint | null = null;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.2) {
      const p = { x, z };
      if (pointInPolygon(p, points) && (!best || distance(p, c) < distance(best, c))) best = p;
    }
  return best ?? c;
}

/**
 * True when a point of a wall faces one of the other room's walls: a wall running the same way
 * (within ~17°), right across (not past its ends), less than SHARED away. Rooms touching only
 * at a corner share nothing.
 */
function facesWall(s: FloorPoint, dir: FloorPoint, walls: [FloorPoint, FloorPoint][]) {
  return walls.some(([a, b]) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6 || Math.abs(dir.x * dz - dir.z * dx) / len > 0.3) return false;
    const t = ((s.x - a.x) * dx + (s.z - a.z) * dz) / (len * len);
    return t > 0 && t < 1 && Math.abs((s.x - a.x) * dz - (s.z - a.z) * dx) / len < SHARED;
  });
}

/** Where two rooms meet: the middle of the longest stretch of wall they share, or null. */
export function doorway(a: MapRoom, b: MapRoom): FloorPoint | null {
  const wallsB = roomWalls(b.points);
  if (!wallsB.length) return null;
  let best: FloorPoint[] = [];
  let run: FloorPoint[] = [];
  for (const [p, q] of roomWalls(a.points)) {
    const len = distance(p, q);
    if (len < 1e-6) continue;
    const dir = { x: (q.x - p.x) / len, z: (q.z - p.z) / len };
    const n = Math.max(1, Math.ceil(len / SAMPLE));
    for (let i = 0; i <= n; i++) {
      const s = { x: p.x + ((q.x - p.x) * i) / n, z: p.z + ((q.z - p.z) * i) / n };
      if (facesWall(s, dir, wallsB)) run.push(s);
      else {
        if (run.length > best.length) best = run;
        run = [];
      }
    }
  }
  if (run.length > best.length) best = run;
  if ((best.length - 1) * SAMPLE < MIN_SHARED) return null;
  return best[Math.floor(best.length / 2)];
}

/** True when room `inner` sits inside room `outer` (a nightstand corner in a bedroom). */
export function isInside(inner: MapRoom, outer: MapRoom) {
  return inner.id !== outer.id && pointInPolygon(insidePoint(inner.points), outer.points) && roomArea(inner.points) < roomArea(outer.points);
}

export type Route = {
  /** Map room ids walked through, from the first to the last. */
  rooms: string[];
  /** The line walked: from the middle of the first room, through each doorway, to the middle of the last. */
  points: FloorPoint[];
};

/** The shortest walk from one room to another, or a straight line when they aren't linked. */
export function findRoute(map: HomeMap, fromId: string, toId: string): Route | null {
  const rooms = map.rooms.filter((r) => r.points.length >= 3);
  const from = rooms.find((r) => r.id === fromId);
  const to = rooms.find((r) => r.id === toId);
  if (!from || !to) return null;
  const mid = new Map(rooms.map((r) => [r.id, insidePoint(r.points)]));
  if (from.id === to.id) return { rooms: [from.id], points: [mid.get(from.id)!] };

  // Links between rooms, each through one point (a doorway, or the inner room's middle).
  const links = new Map<string, { to: string; via: FloorPoint }[]>(rooms.map((r) => [r.id, []]));
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const via = isInside(b, a) ? mid.get(b.id)! : isInside(a, b) ? mid.get(a.id)! : doorway(a, b);
      if (!via) continue;
      links.get(a.id)!.push({ to: b.id, via });
      links.get(b.id)!.push({ to: a.id, via });
    }

  // Dijkstra over rooms; a step costs the walk from one room's middle to the next through the link.
  const cost = new Map<string, number>([[from.id, 0]]);
  const prev = new Map<string, { room: string; via: FloorPoint }>();
  const done = new Set<string>();
  const outdoor = new Set(rooms.filter((r) => r.outdoor).map((r) => r.id));
  for (;;) {
    let here: string | null = null;
    for (const [id, c] of cost) if (!done.has(id) && (here === null || c < cost.get(here)!)) here = id;
    if (here === null || here === to.id) break;
    done.add(here);
    for (const { to: next, via } of links.get(here)!) {
      const detour = next !== to.id && outdoor.has(next) ? OUTDOOR_DETOUR : 0;
      const c = cost.get(here)! + distance(mid.get(here)!, via) + distance(via, mid.get(next)!) + detour;
      if (c < (cost.get(next) ?? Infinity)) {
        cost.set(next, c);
        prev.set(next, { room: here, via });
      }
    }
  }

  if (!prev.has(to.id)) return { rooms: [from.id, to.id], points: [mid.get(from.id)!, mid.get(to.id)!] };
  const ids = [to.id];
  const points = [mid.get(to.id)!];
  for (let at = to.id; at !== from.id; ) {
    const step = prev.get(at)!;
    points.unshift(step.via);
    // Passing through a room on the way: walk by its middle, unless it's where we start.
    if (step.room !== from.id) points.unshift(mid.get(step.room)!);
    ids.unshift(step.room);
    at = step.room;
  }
  points.unshift(mid.get(from.id)!);
  return { rooms: ids, points: dedupe(points) };
}

const dedupe = (pts: FloorPoint[]) => pts.filter((p, i) => i === 0 || distance(p, pts[i - 1]) > 0.05);

/** Distance from a point to a walked line. */
export function distanceToRoute(p: FloorPoint, points: FloorPoint[]) {
  if (points.length === 1) return distance(p, points[0]);
  let d = Infinity;
  for (let i = 1; i < points.length; i++) d = Math.min(d, distance(p, closestOnSegment(p, points[i - 1], points[i])));
  return d;
}

/** The map room a light stands in: the smallest one around it (a nightstand corner before the bedroom). */
export function roomOfPoint(map: HomeMap, p: FloorPoint): MapRoom | null {
  const around = map.rooms.filter((r) => r.points.length >= 3 && pointInPolygon(p, r.points));
  return around.sort((a, b) => roomArea(a.points) - roomArea(b.points))[0] ?? null;
}

const NEAR_ROUTE = 1.6; // m: lights this close to the walked line light the way

/**
 * The lights that light a route: the ones close to the walked line in the rooms it goes through
 * (and in rooms inside them), and at least the nearest one in each room walked through, so no
 * room on the way stays dark. `usable` filters lights out (smart plugs can't be dimmed).
 */
export function lightsAlongRoute(map: HomeMap, route: Route, usable: (l: MapLight) => boolean = () => true): string[] {
  const walked = new Set(route.rooms);
  const around = map.rooms.filter((r) => walked.has(r.id));
  for (const r of map.rooms) if (!walked.has(r.id) && around.some((o) => isInside(r, o))) walked.add(r.id);

  const candidates = map.lights
    .filter(usable)
    .map((l) => ({ l, room: roomOfPoint(map, l)?.id ?? null, d: distanceToRoute(l, route.points) }))
    .filter((c) => c.room !== null && walked.has(c.room));
  const lit = new Set(candidates.filter((c) => c.d <= NEAR_ROUTE).map((c) => c.l.lightId));
  for (const id of route.rooms) {
    const inRoom = candidates.filter((c) => c.room === id);
    if (inRoom.length && !inRoom.some((c) => lit.has(c.l.lightId))) lit.add(inRoom.sort((a, b) => a.d - b.d)[0].l.lightId);
  }
  return [...lit];
}
