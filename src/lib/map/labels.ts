import { pointInPolygon } from './geometry';

type XY = { x: number; y: number };

/**
 * Where to write a room's name (screen px): the first spot, reading from the top left, where the
 * label sits inside the room and clear of every light marker. Falls back to the least crowded spot.
 */
export function labelSpot(room: XY[], markers: XY[], labelW: number, labelH: number, inset: number, markerR = 17): XY {
  const xs = room.map((p) => p.x);
  const ys = room.map((p) => p.y);
  const minX = Math.min(...xs) + inset;
  const minY = Math.min(...ys) + inset;
  const maxX = Math.max(...xs) - inset - labelW;
  const maxY = Math.max(...ys) - inset - labelH;
  const poly = room.map((p) => ({ x: p.x, z: p.y }));
  const inside = (x: number, y: number) => pointInPolygon({ x, z: y }, poly);
  let best = { x: minX, y: minY, score: Infinity };
  const steps = 7;
  for (let r = 0; r < steps; r++) {
    for (let c = 0; c < steps; c++) {
      const x = maxX <= minX ? minX : minX + ((maxX - minX) * c) / (steps - 1);
      const y = maxY <= minY ? minY : minY + ((maxY - minY) * r) / (steps - 1);
      const corners = [
        [x, y],
        [x + labelW, y],
        [x, y + labelH],
        [x + labelW, y + labelH],
      ];
      const outside = corners.filter(([cx, cy]) => !inside(cx, cy)).length;
      // Overlap with a marker: distance from its center to the label box.
      const hits = markers.filter((m) => Math.hypot(Math.max(x - m.x, 0, m.x - x - labelW), Math.max(y - m.y, 0, m.y - y - labelH)) < markerR).length;
      // Top left first, as before; a clear spot always beats a crowded one.
      const score = outside * 1000 + hits * 100 + r * 2 + c;
      if (score < best.score) best = { x, y, score };
      if (score < 100 && outside === 0) return { x, y };
    }
  }
  return { x: best.x, y: best.y };
}

/** Approximate width of a label in spaced capitals (Geist 500, letter spacing 0.16em). */
export const capsWidth = (text: string, size: number) => text.length * size * 0.82;

export type LabelIn = { id: string; x: number; y: number; text: string };
/** `anchor`: how the text is aligned on `x` (SVG textAnchor). `y` is the text's baseline. */
export type LabelOut = { id: string; x: number; y: number; anchor: 'start' | 'middle' | 'end' };

/** A screen rectangle a light's name must stay clear of (a room's name...). */
export type Box = { x0: number; y0: number; x1: number; y1: number };

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Where to put each light's name on a plan so names don't cover each other, other lights or
 * `obstacles` (room names): below the marker if there's room, else above, right or left, else
 * the spot that overlaps least. Screen coordinates. The first labels in the list get the best
 * spots (put the selected one first).
 * `marker`: the marker's radius; `charW`: about how wide one character is; `size`: the font size.
 * Markers count as obstacles too, so a name never sits on another light.
 */
export function placeLabels(items: LabelIn[], obstacles: Box[] = [], { marker = 13, charW = 5.6, size = 10 } = {}): Map<string, LabelOut> {
  const markers: Box[] = [...obstacles, ...items.map((l) => ({ x0: l.x - marker, y0: l.y - marker, x1: l.x + marker, y1: l.y + marker }))];
  const placed: Box[] = [];
  const out = new Map<string, LabelOut>();
  const gap = 4;
  for (const l of items) {
    const w = l.text.length * charW;
    const h = size + 2;
    // Each spot: the text's box and how it is drawn (baseline y).
    const spots: { box: Box; label: LabelOut }[] = [
      { box: { x0: l.x - w / 2, y0: l.y + marker + gap, x1: l.x + w / 2, y1: l.y + marker + gap + h }, label: { id: l.id, x: l.x, y: l.y + marker + gap + size, anchor: 'middle' } },
      { box: { x0: l.x - w / 2, y0: l.y - marker - gap - h, x1: l.x + w / 2, y1: l.y - marker - gap }, label: { id: l.id, x: l.x, y: l.y - marker - gap - 2, anchor: 'middle' } },
      { box: { x0: l.x + marker + gap, y0: l.y - h / 2, x1: l.x + marker + gap + w, y1: l.y + h / 2 }, label: { id: l.id, x: l.x + marker + gap, y: l.y + size / 2 - 1, anchor: 'start' } },
      { box: { x0: l.x - marker - gap - w, y0: l.y - h / 2, x1: l.x - marker - gap, y1: l.y + h / 2 }, label: { id: l.id, x: l.x - marker - gap, y: l.y + size / 2 - 1, anchor: 'end' } },
    ];
    const cost = (b: Box) => [...placed, ...markers].reduce((sum, o) => sum + overlap(b, o), 0);
    let best = spots[0];
    let bestCost = Infinity;
    for (const s of spots) {
      const c = cost(s.box);
      if (c < bestCost) {
        best = s;
        bestCost = c;
      }
      if (c === 0) break;
    }
    placed.push(best.box);
    out.set(l.id, best.label);
  }
  return out;
}
