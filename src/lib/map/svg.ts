import type { Light } from '../hue/client';
import { fitPlan, type Plan } from './map';

export const PLAN_COLORS = {
  wall: '#8a8a93',
  roomFill: '#1c1c22',
  outdoorFill: '#15151a',
  label: '#9a9aa3',
  off: '#3a3a42',
  offStroke: '#7a7a83',
  unreachable: '#5a2a2a',
};

/** Renders the floor plan as an SVG string (used by the map widget, which can only show images). */
export function planToSvg(plan: Plan, lights: Light[], width: number, height: number, opts: { labels?: boolean } = {}) {
  const f = fitPlan(plan, width, height, 14);
  const byId = new Map(lights.map((l) => [l.id, l]));
  const parts: string[] = [];
  for (const room of plan.rooms) {
    if (room.pts.length < 2) continue;
    const d = room.pts.map((p, i) => `${i ? 'L' : 'M'}${f.x(p.u).toFixed(1)},${f.y(p.v).toFixed(1)}`).join(' ') + ' Z';
    parts.push(
      `<path d="${d}" fill="${room.outdoor ? PLAN_COLORS.outdoorFill : PLAN_COLORS.roomFill}" stroke="${PLAN_COLORS.wall}" stroke-width="1.5" ${room.outdoor ? 'stroke-dasharray="4 3"' : ''}/>`,
    );
    if (opts.labels !== false) {
      const cx = room.pts.reduce((s, p) => s + f.x(p.u), 0) / room.pts.length;
      const cy = room.pts.reduce((s, p) => s + f.y(p.v), 0) / room.pts.length;
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" font-size="10" fill="${PLAN_COLORS.label}" text-anchor="middle" font-family="sans-serif">${escapeXml(room.name)}</text>`,
      );
    }
  }
  for (const pl of plan.lights) {
    const l = byId.get(pl.lightId);
    if (!l) continue;
    const cx = f.x(pl.u).toFixed(1);
    const cy = f.y(pl.v).toFixed(1);
    if (!l.reachable) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="${PLAN_COLORS.unreachable}" stroke="#e25555" stroke-width="1.5" stroke-dasharray="2 2"/>`);
    } else if (l.on) {
      const glow = 10 + ((l.brightness ?? 100) / 100) * 10;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${glow.toFixed(1)}" fill="${l.color}" fill-opacity="0.25"/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="${l.color}"/>`);
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="${PLAN_COLORS.off}" stroke="${PLAN_COLORS.offStroke}" stroke-width="1.5"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}
