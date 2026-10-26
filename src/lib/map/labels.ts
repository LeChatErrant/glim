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
