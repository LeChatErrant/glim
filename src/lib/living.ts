import { hasTemperature, mirekFor } from './actions';
import { deleteScene } from './hue/behaviors';
import { call, type Light, type Snapshot } from './hue/client';
import { hexToXy, kelvinToMirek } from './hue/color';
import type { HomeMap } from './map/map';
import { moodLights, type Living, type Mood, type MoodLight } from './moods';

/**
 * Living moods: the colors slowly drift across the lights. Hue calls this a dynamic scene: a
 * bridge scene with a palette, recalled with `dynamic_palette`; the bridge then plays it on its
 * own (phone off too) until the lights are changed. A scene belongs to one room or group and must
 * list every light in it, so a living mood gets one hidden scene ("Glim mood …") per room or
 * group it covers: its own room or group, or for the whole home each room with a light it turns
 * on. Lights in no room keep their color.
 */

/** Speeds offered in the editor, as Hue's 0–1. */
export const LIVING_SPEEDS = [
  { id: 'slow', label: 'Slow', speed: 0.15 },
  { id: 'medium', label: 'Medium', speed: 0.45 },
  { id: 'lively', label: 'Lively', speed: 0.8 },
] as const;

export const livingSpeedLabel = (speed: number) => LIVING_SPEEDS.reduce((a, b) => (Math.abs(b.speed - speed) < Math.abs(a.speed - speed) ? b : a)).label;

/** The colors a living mood drifts between (a palette needs at least one color). */
export function livingColors(lights: MoodLight[]): string[] {
  return [...new Set(lights.filter((m) => m.on && m.hex && !m.effect).map((m) => m.hex!.toUpperCase()))].slice(0, 9);
}

/** Whether a mood can be living: it turns on a color light in a color. */
export const canLive = (s: Snapshot, lights: MoodLight[]) => {
  const color = new Set(s.lights.filter((l) => l.kind === 'color').map((l) => l.id));
  return lights.some((m) => m.on && m.hex && !m.effect && color.has(m.lightId));
};

type Group = { id: string; rtype: 'room' | 'zone'; lightIds: string[] };

function groupsFor(s: Snapshot, targetId: string | null, lights: MoodLight[]): Group[] {
  const rooms: Group[] = s.rooms.map((r) => ({ id: r.id, rtype: 'room', lightIds: r.lightIds }));
  const zones: Group[] = (s.zones ?? []).map((z) => ({ id: z.id, rtype: 'zone', lightIds: z.lightIds }));
  if (targetId) return [...rooms, ...zones].filter((g) => g.id === targetId);
  const lit = new Set(lights.filter((m) => m.on).map((m) => m.lightId));
  return rooms.filter((r) => r.lightIds.some((id) => lit.has(id)));
}

/** One light's action in the scene: the mood's look, or nothing for a light the mood leaves alone. */
function action(m: MoodLight | undefined, l: Light | undefined) {
  if (!m || !l) return { dynamics: { duration: 0 } };
  if (!m.on) return { on: { on: false } };
  const out: Record<string, unknown> = { on: { on: true } };
  if (m.brightness !== undefined && l.brightness !== null) out.dimming = { brightness: Math.max(1, m.brightness) };
  if (m.hex && l.kind === 'color') out.color = { xy: hexToXy(m.hex) };
  else if (m.kelvin && hasTemperature(l)) out.color_temperature = { mirek: mirekFor(l, m.kelvin) };
  return out;
}

function palette(lights: MoodLight[]) {
  const on = lights.filter((m) => m.on);
  const level = (ms: MoodLight[]) => Math.max(1, Math.round(ms.reduce((a, m) => a + (m.brightness ?? 100), 0) / Math.max(1, ms.length)));
  const color = livingColors(on).map((hex) => ({ color: { xy: hexToXy(hex) }, dimming: { brightness: level(on.filter((m) => m.hex?.toUpperCase() === hex)) } }));
  const white = on.find((m) => m.kelvin && !m.hex);
  return {
    color,
    dimming: [{ brightness: level(on) }],
    color_temperature: white ? [{ color_temperature: { mirek: kelvinToMirek(white.kelvin!) }, dimming: { brightness: white.brightness ?? level(on) } }] : [],
  };
}

/** Removes a mood's living scenes from the bridge (gone already is fine). */
export async function removeLiving(living: Living | undefined) {
  for (const sc of living?.scenes ?? []) await deleteScene(sc.scene).catch(() => null);
}

/**
 * Makes (or remakes) a mood's living scenes on the bridge from how it looks now. Returns the
 * mood's new `living`, or undefined when it isn't living. Throws if the bridge refuses one; the
 * scenes made before that are removed.
 */
export async function putLiving(s: Snapshot, mood: Mood, map: HomeMap | null): Promise<Living | undefined> {
  await removeLiving(mood.living);
  if (!mood.living) return undefined;
  const lights = moodLights(s, mood, map);
  if (!canLive(s, lights)) return { speed: mood.living.speed };
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  const set = new Map(lights.map((m) => [m.lightId, m]));
  const scenes: { group: string; scene: string }[] = [];
  try {
    for (const g of groupsFor(s, mood.targetId, lights)) {
      const mine = g.lightIds.map((id) => set.get(id)).filter((m): m is MoodLight => !!m);
      if (!canLive(s, mine) && mood.targetId === null) continue;
      const res = (await call('scene', 'POST', {
        type: 'scene',
        metadata: { name: `Glim mood ${mood.name}`.slice(0, 32) },
        group: { rid: g.id, rtype: g.rtype },
        actions: g.lightIds.filter((id) => byId.has(id)).map((id) => ({ target: { rid: id, rtype: 'light' }, action: action(set.get(id), byId.get(id)) })),
        palette: palette(mine.length ? mine : lights),
        speed: mood.living.speed,
        auto_dynamic: true,
      })) as { rid?: string }[];
      const id = res[0]?.rid;
      if (!id) throw new Error("The bridge didn't return the new scene");
      scenes.push({ group: g.id, scene: id });
    }
  } catch (e) {
    await removeLiving({ speed: 0, scenes });
    throw e;
  }
  return { speed: mood.living.speed, scenes };
}
