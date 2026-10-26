import type { Light, Snapshot } from '../hue/client';
import { DEFAULT_LENGTH, lightShape, type LightShape } from '../lights';
import { centroid, pointInPolygon } from './geometry';
import type { FloorPoint, HomeMap, Plan } from './map';
import { runPath, runSamples, wallRun } from './wallPath';

type UV = { u: number; v: number };
type PlanRoom = Plan['rooms'][number];

const toFloor = (p: UV): FloorPoint => ({ x: p.u, z: p.v });

export function polygonArea(pts: UV[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].u + pts[i].u) * (pts[j].v - pts[i].v);
  return Math.abs(a / 2);
}

/** Closest point on a room's walls, with the wall's direction and the normal pointing into the room. */
export function nearestWall(p: UV, pts: UV[]) {
  let best = { u: p.u, v: p.v, dist: Infinity, angle: 0, nu: 0, nv: 1 };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len2 = du * du + dv * dv;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / len2));
    const q = { u: a.u + du * t, v: a.v + dv * t };
    const dist = Math.hypot(p.u - q.u, p.v - q.v);
    if (dist < best.dist) {
      const len = Math.sqrt(len2);
      let nu = -dv / len;
      let nv = du / len;
      // Point the normal toward the inside of the room.
      const c = centroid(pts.map(toFloor));
      if ((c.x - q.u) * nu + (c.z - q.v) * nv < 0) {
        nu = -nu;
        nv = -nv;
      }
      best = { ...q, dist, angle: Math.atan2(dv, du), nu, nv };
    }
  }
  return best;
}

/**
 * Outlines that have real walls: an outline drawn inside a bigger one (a bedside inside the
 * bedroom) is a zone, not walls, so light passes through it.
 */
export function walledRooms(plan: Plan): PlanRoom[] {
  const rooms = plan.rooms.filter((r) => r.pts.length >= 3);
  return rooms.filter((r) => {
    const c = centroid(r.pts.map(toFloor));
    const a = polygonArea(r.pts);
    return !rooms.some((o) => o !== r && polygonArea(o.pts) > a && pointInPolygon(c, o.pts.map(toFloor)));
  });
}

/**
 * The walled room that holds a light: the smallest outline containing it, preferring the outline
 * of the light's own Hue room.
 */
export function roomForPoint(plan: Plan, p: UV, hueRoomId: string | null, walled = walledRooms(plan)): PlanRoom | null {
  const containing = walled.filter((r) => pointInPolygon(toFloor(p), r.pts.map(toFloor)));
  const own = containing.filter((r) => r.hueRoomId && r.hueRoomId === hueRoomId);
  const pool = own.length ? own : containing;
  if (pool.length) return pool.reduce((a, b) => (polygonArea(a.pts) <= polygonArea(b.pts) ? a : b));
  // Placed just outside every outline (scans are approximate): the nearest wall wins.
  let best: PlanRoom | null = null;
  let bestDist = 0.6;
  for (const r of walled) {
    const d = nearestWall(p, r.pts).dist;
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

/** One soft pool of light, in plan meters. */
export type Pool = { u: number; v: number; rx: number; ry: number; angle: number; alpha: number };

export type PlacedLight = {
  light: Light;
  shape: LightShape;
  u: number;
  v: number;
  room: PlanRoom | null;
  /** Direction of the nearest wall, for light bars (radians, plan axes). */
  wallAngle: number;
  pools: Pool[];
  /** String lights: bead positions. */
  beads: UV[];
  /** Lightstrips: the strip as a polyline (it turns at corners when it runs along the walls). */
  line: UV[] | null;
};

/**
 * Where each placed light is and how it lights the floor. Sizes are in meters, tuned on the
 * Nocturne map (about 34 px per meter): size and strength follow brightness.
 */
export function placeLights(plan: Plan, lights: Light[]): PlacedLight[] {
  const byId = new Map(lights.map((l) => [l.id, l]));
  const walled = walledRooms(plan);
  const out: PlacedLight[] = [];
  for (const pl of plan.lights) {
    const light = byId.get(pl.lightId);
    if (!light) continue;
    const shape = lightShape(light.archetype);
    const room = roomForPoint(plan, pl, light.roomId, walled);
    const wall = room ? nearestWall(pl, room.pts) : null;
    // Set by the user in the editor: it wins over the nearest wall.
    const set = pl.angle === undefined ? null : (pl.angle * Math.PI) / 180;
    const b = (light.brightness ?? 100) / 100;
    const pools: Pool[] = [];
    let beads: UV[] = [];
    let line: UV[] | null = null;
    const at = { u: pl.u, v: pl.v, angle: 0 };
    switch (shape) {
      case 'pendant': {
        const r = 1.95 + 2.05 * b;
        pools.push({ ...at, rx: r, ry: r, alpha: 0.69 * (0.55 + 0.45 * b) });
        break;
      }
      case 'bulb': {
        const r = 1.35 + 1.6 * b;
        pools.push({ ...at, rx: r, ry: r, alpha: 0.75 * (0.55 + 0.45 * b) });
        break;
      }
      case 'portable': {
        const r = 0.9 + 1.0 * b;
        pools.push({ ...at, rx: r, ry: r, alpha: 0.82 });
        break;
      }
      case 'bar': {
        // A wash along the wall behind it, or along the direction the user set.
        const w = set === null && wall && wall.dist < 1.2 ? wall : null;
        pools.push({ u: w?.u ?? pl.u, v: w?.v ?? pl.v, angle: set ?? w?.angle ?? 0, rx: 2.05 + 1.2 * b, ry: 1.25 + 0.65 * b, alpha: 0.88 });
        break;
      }
      case 'lantern': {
        // A half pool away from the wall: centered on the wall, the room clip cuts the other half.
        const w = set === null && wall && wall.dist < 1.2 ? wall : null;
        pools.push({ u: w?.u ?? pl.u, v: w?.v ?? pl.v, angle: set ?? w?.angle ?? 0, rx: 2.9 + 1.2 * b, ry: 1.9 + 0.7 * b, alpha: 0.78 });
        break;
      }
      case 'strip': {
        // Its real length: along the walls (around corners) when it sits by one, else a straight
        // line through the light, along the direction set or the nearest wall. Washes along its length.
        const len = pl.length ?? DEFAULT_LENGTH.strip!;
        const run = set === null && room ? wallRun(room.pts, pl, len) : null;
        if (run) {
          line = runPath(run);
        } else {
          const angle = set ?? wall?.angle ?? 0;
          const du = (Math.cos(angle) * len) / 2;
          const dv = (Math.sin(angle) * len) / 2;
          line = [
            { u: pl.u - du, v: pl.v - dv },
            { u: pl.u + du, v: pl.v + dv },
          ];
        }
        for (let k = 0; k < line.length - 1; k++) {
          const a = line[k];
          const c = line[k + 1];
          const half = Math.hypot(c.u - a.u, c.v - a.v) / 2;
          pools.push({ u: (a.u + c.u) / 2, v: (a.v + c.v) / 2, angle: Math.atan2(c.v - a.v, c.u - a.u), rx: half + 0.8 + 0.6 * b, ry: 0.85 + 0.55 * b, alpha: 0.85 });
        }
        break;
      }
      case 'string': {
        // A row of beads sagging a little: hanging along the walls (around corners) when it sits
        // by one, else along the direction set (centered on the light) or the nearest wall.
        const len = pl.length ?? DEFAULT_LENGTH.string!;
        const count = (n: number) => Math.max(4, Math.min(n, Math.round(len * 3)));
        const run = set === null && room ? wallRun(room.pts, pl, len) : null;
        if (run) {
          beads = runSamples(run, count(36), (t) => 0.13 + 0.26 * Math.sin(Math.PI * t));
        } else {
          const angle = set ?? wall?.angle ?? 0;
          const du = Math.cos(angle);
          const dv = Math.sin(angle);
          let nu = -dv;
          let nv = du;
          if (set === null && wall) {
            nu = wall.nu;
            nv = wall.nv;
          }
          const half = len / 2;
          const n = count(15);
          const base = set === null ? { u: pl.u - nu * 0.3, v: pl.v - nv * 0.3 } : { u: pl.u, v: pl.v };
          beads = Array.from({ length: n }, (_, i) => {
            const t = i / (n - 1);
            const along = -half + 2 * half * t;
            const sag = (set === null ? 0.18 : 0) + 0.26 * Math.sin(Math.PI * t);
            return { u: base.u + du * along + nu * sag, v: base.v + dv * along + nv * sag };
          });
        }
        for (const p of beads) pools.push({ ...p, angle: 0, rx: 0.75, ry: 0.75, alpha: 0.59 });
        break;
      }
    }
    out.push({ light, shape, u: pl.u, v: pl.v, room, wallAngle: set ?? wall?.angle ?? Math.PI / 2, pools, beads, line });
  }
  return out;
}

/**
 * Hue rooms that sit inside another room (a bedside inside the bedroom): child Hue room ID → parent
 * Hue room ID. Read from the map: an outline inside a bigger outline, or a room without an outline
 * whose placed lights all fall inside another room.
 */
export function nestedRooms(map: HomeMap | null, s: Snapshot): Map<string, string> {
  const out = new Map<string, string>();
  if (!map) return out;
  const outlines = map.rooms.filter((r) => r.points.length >= 3 && r.hueRoomId);
  const area = (pts: FloorPoint[]) => polygonArea(pts.map((p) => ({ u: p.x, v: p.z })));
  const parentOf = (p: FloorPoint, self: string, minArea = 0) => {
    const hits = outlines.filter((o) => o.hueRoomId !== self && area(o.points) > minArea && pointInPolygon(p, o.points));
    return hits.length ? hits.reduce((a, b) => (area(a.points) <= area(b.points) ? a : b)).hueRoomId! : null;
  };
  for (const room of s.rooms) {
    const outline = outlines.find((o) => o.hueRoomId === room.id);
    let parent: string | null = null;
    if (outline) {
      parent = parentOf(centroid(outline.points), room.id, area(outline.points));
    } else {
      const placed = map.lights.filter((l) => room.lightIds.includes(l.lightId));
      const parents = new Set(placed.map((p) => parentOf(p, room.id)));
      if (placed.length && parents.size === 1) parent = [...parents][0];
    }
    if (parent && parent !== room.id) out.set(room.id, parent);
  }
  return out;
}
