/**
 * Tap areas of a Map widget. A home-screen widget only knows rectangles, and the widget library
 * stacks them in an order of its own (it sorts them by id as text), so overlapping areas can't be
 * trusted. Instead the plan is cut into rectangles that never overlap:
 *
 * - each light owns the floor within `radius` of it (a finger-sized target, much bigger than its
 *   marker), split with its neighbours by distance, and kept inside its own room;
 * - the rest of each room belongs to the room, following its real outline (not its bounding box,
 *   which spilled over the next room).
 *
 * Pure, in widget coordinates (dp). Self-contained so it can be checked outside the app.
 */

export type XY = { x: number; y: number };
export type HitTarget = { kind: 'light' | 'room'; id: string };
export type HitRect = { x: number; y: number; w: number; h: number; target: HitTarget };
/** A room that can be toggled: its id and its outline. */
export type HitRoom = { id: string; pts: XY[] };
/** A light on the plan, and the room it belongs to (null: none, or not on this map). */
export type HitLight = { id: string; x: number; y: number; roomId: string | null };
export type Box = { left: number; top: number; width: number; height: number };

function inside(p: XY, poly: XY[]) {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inn = !inn;
  }
  return inn;
}

function area(poly: XY[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}

export function hitAreas(box: Box, rooms: HitRoom[], lights: HitLight[], { cell = 8, radius = 26 } = {}): HitRect[] {
  // Smallest room first: a room drawn inside another (a reading nook) wins over its parent.
  const sorted = rooms.filter((r) => r.pts.length > 2).sort((a, b) => area(a.pts) - area(b.pts));
  const roomAt = (p: XY) => sorted.find((r) => inside(p, r.pts))?.id ?? null;
  const known = new Set(sorted.map((r) => r.id));
  // A light at a wall can sit just outside its room's outline: trust its Hue room when it's on the map.
  const placed = lights.map((l) => ({ ...l, room: l.roomId && known.has(l.roomId) ? l.roomId : roomAt(l) }));

  const cols = Math.ceil(box.width / cell);
  const rows = Math.ceil(box.height / cell);
  const key = (t: HitTarget | null) => (t ? `${t.kind}:${t.id}` : '');
  const done: HitRect[] = [];
  // Rectangles still growing downwards, by "first column, last column, target".
  let open = new Map<string, HitRect>();

  for (let r = 0; r < rows; r++) {
    const y = box.top + r * cell;
    const h = Math.min(cell, box.top + box.height - y);
    const row: { c0: number; c1: number; t: HitTarget }[] = [];
    for (let c = 0; c < cols; c++) {
      const x = box.left + c * cell;
      const p = { x: x + Math.min(cell, box.left + box.width - x) / 2, y: y + h / 2 };
      const room = roomAt(p);
      let best: (typeof placed)[number] | null = null;
      let bestD = radius;
      for (const l of placed) {
        // A light reaches the floor of its own room and the outside, never the next room.
        if (room && l.room && room !== l.room) continue;
        const d = Math.hypot(p.x - l.x, p.y - l.y);
        if (d <= bestD) {
          best = l;
          bestD = d;
        }
      }
      const t: HitTarget | null = best ? { kind: 'light', id: best.id } : room ? { kind: 'room', id: room } : null;
      const last = row[row.length - 1];
      if (t && last && last.c1 === c - 1 && key(last.t) === key(t)) last.c1 = c;
      else if (t) row.push({ c0: c, c1: c, t });
    }
    const next = new Map<string, HitRect>();
    for (const run of row) {
      const k = `${run.c0}|${run.c1}|${key(run.t)}`;
      const grown = open.get(k);
      if (grown) {
        grown.h += h;
        open.delete(k);
        next.set(k, grown);
      } else {
        const x = box.left + run.c0 * cell;
        const w = Math.min(box.left + box.width, box.left + (run.c1 + 1) * cell) - x;
        next.set(k, { x, y, w, h, target: run.t });
      }
    }
    done.push(...open.values());
    open = next;
  }
  done.push(...open.values());
  return done;
}
