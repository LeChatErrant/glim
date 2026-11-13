import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from '../hue/bridge';
import {
  activateSmartScene,
  createScene,
  createSmartScene,
  deleteScene,
  deleteSmartScene,
  listSmartScenes,
  type SceneAction,
} from '../hue/behaviors';
import { kelvinToMirek } from '../hue/color';
import type { Snapshot } from '../hue/client';
import { DAYS, type Clock } from './time';

const findGroup = (s: Snapshot, id: string) => s.rooms.find((r) => r.id === id) ?? s.zones?.find((z) => z.id === id);

/**
 * Day rhythm: white light that follows the day, cool and bright by day, warm and low at night.
 * On the bridge, each room or group gets a smart scene that switches between one scene per point
 * of the curve, fading from one to the next. It follows the day while its lights are left alone;
 * changing them by hand pauses it, and turning the room on from Glim brings it back.
 */
export type RhythmPoint = { at: Clock; kelvin: number; brightness: number };
export type RhythmPreset = 'natural' | 'owl' | 'bird' | 'custom';

export type RhythmRitual = {
  kind: 'rhythm';
  id: string;
  name: string;
  enabled: boolean;
  targets: string[];
  preset: RhythmPreset;
  points: RhythmPoint[];
  /** What it made on the bridge, per room or group: the smart scene and its scenes. */
  bridge: Record<string, { smart: string; scenes: string[] }>;
};

const p = (h: number, m: number, kelvin: number, brightness: number): RhythmPoint => ({ at: h * 60 + m, kelvin, brightness });

/**
 * Five points a day: the bridge takes at most 6 slots a day, and the evening's last point needs
 * one more to carry on from midnight.
 */
export const RHYTHM_PRESETS: { id: Exclude<RhythmPreset, 'custom'>; name: string; points: RhythmPoint[] }[] = [
  { id: 'natural', name: 'Natural', points: [p(7, 0, 3000, 60), p(10, 0, 5000, 100), p(17, 0, 4000, 90), p(20, 0, 2700, 60), p(22, 0, 2200, 30)] },
  { id: 'owl', name: 'Night owl', points: [p(9, 0, 3000, 60), p(12, 0, 5000, 100), p(19, 0, 4000, 90), p(22, 0, 2700, 60), p(0, 30, 2200, 30)] },
  { id: 'bird', name: 'Early bird', points: [p(5, 30, 3000, 60), p(8, 0, 5000, 100), p(15, 0, 4000, 90), p(18, 30, 2700, 60), p(20, 30, 2200, 30)] },
];

export const sortPoints = (pts: RhythmPoint[]) => [...pts].sort((a, b) => a.at - b.at);

/** The point in force at a time of day (the last one before it, wrapping past midnight). */
export function pointAt(points: RhythmPoint[], at: Clock): RhythmPoint {
  const pts = sortPoints(points);
  return [...pts].reverse().find((x) => x.at <= at) ?? pts[pts.length - 1];
}

/** Kelvin and brightness at a time: each point holds until the next, reached over TRANSITION_MIN. */
export function valueAt(points: RhythmPoint[], at: Clock): { kelvin: number; brightness: number } {
  const pts = sortPoints(points);
  if (!pts.length) return { kelvin: 2700, brightness: 60 };
  const i = pts.map((x) => x.at <= at).lastIndexOf(true);
  // Before the first point of the day, the last one (from yesterday evening) is in force.
  const cur = i >= 0 ? pts[i] : pts[pts.length - 1];
  const prev = pts[(i >= 0 ? i : pts.length - 1) - 1] ?? pts[pts.length - 1];
  const since = (at - cur.at + 1440) % 1440;
  const t = Math.min(1, since / TRANSITION_MIN);
  return { kelvin: Math.round(prev.kelvin + (cur.kelvin - prev.kelvin) * t), brightness: Math.round(prev.brightness + (cur.brightness - prev.brightness) * t) };
}

/** How long the bridge takes to fade from one point to the next. */
export const TRANSITION_MIN = 30;

const key = async () => `rhythms:${(await getBridge())?.id ?? 'none'}`;
let cache: RhythmRitual[] = [];

/** Rhythms in memory, for Glim's own "turn on" (sync). Filled by loadRhythms. */
export const rhythmsNow = () => cache;

export async function loadRhythms(): Promise<RhythmRitual[]> {
  try {
    cache = JSON.parse((await AsyncStorage.getItem(await key())) ?? '[]');
  } catch {
    cache = [];
  }
  return cache;
}

async function save(list: RhythmRitual[]) {
  cache = list;
  await AsyncStorage.setItem(await key(), JSON.stringify(list));
  return list;
}

/** Reads the bridge back: a rhythm whose smart scenes are all gone (deleted in the Hue app) is off. */
export async function checkRhythms(): Promise<RhythmRitual[]> {
  const list = await loadRhythms();
  const smart = new Set((await listSmartScenes()).map((x) => x.id));
  let changed = false;
  const next = list.map((r) => {
    if (!r.enabled) return r;
    const bridge = Object.fromEntries(Object.entries(r.bridge).filter(([, b]) => smart.has(b.smart)));
    if (Object.keys(bridge).length === Object.keys(r.bridge).length) return r;
    changed = true;
    return { ...r, bridge, enabled: Object.keys(bridge).length > 0 };
  });
  return changed ? save(next) : list;
}

/**
 * One scene's lights: each white-capable light at the point's temperature, dim-only lights at its
 * level. The bridge wants every light of the room in the scene: plugs are just on.
 */
function actions(s: Snapshot, targetId: string, pt: RhythmPoint): SceneAction[] {
  const group = findGroup(s, targetId);
  if (!group) return [];
  return s.lights
    .filter((l) => group.lightIds.includes(l.id))
    .map((l) => {
      const action: SceneAction['action'] = { on: { on: true } };
      if (l.brightness !== null || l.kind !== 'onoff') action.dimming = { brightness: pt.brightness };
      if (l.mirekRange) action.color_temperature = { mirek: Math.max(l.mirekRange[0], Math.min(l.mirekRange[1], kelvinToMirek(pt.kelvin))) };
      return { target: { rid: l.id, rtype: 'light' }, action };
    });
}

/** A room or group the rhythm can change: at least one light that dims. */
const dims = (s: Snapshot, targetId: string) => !!findGroup(s, targetId)?.lightIds.some((id) => s.lights.find((l) => l.id === id && l.kind !== 'onoff'));

async function removeFromBridge(r: RhythmRitual) {
  for (const b of Object.values(r.bridge)) {
    await deleteSmartScene(b.smart).catch(() => null);
    for (const sc of b.scenes) await deleteScene(sc).catch(() => null);
  }
}

/** Builds the rhythm on the bridge for each target, and starts it where the lights are on now. */
async function putOnBridge(s: Snapshot, r: RhythmRitual): Promise<RhythmRitual['bridge']> {
  const out: RhythmRitual['bridge'] = {};
  const pts = sortPoints(r.points);
  for (const t of r.targets) {
    const group = findGroup(s, t);
    if (!group || !dims(s, t)) continue;
    const rtype = s.rooms.some((x) => x.id === t) ? 'room' : 'zone';
    const scenes: string[] = [];
    try {
      for (const pt of pts) scenes.push(await createScene(`Glim rhythm ${fmt(pt.at)}`, { rid: t, rtype }, actions(s, t, pt)));
      // The bridge needs a slot from midnight: the evening's last point runs on past midnight.
      const slots = pts.map((pt, i) => ({ at: pt.at, scene: scenes[i] }));
      if (slots[0].at !== 0) slots.unshift({ at: 0, scene: scenes[scenes.length - 1] });
      const smart = await createSmartScene({
        metadata: { name: r.name.slice(0, 32) },
        group: { rid: t, rtype },
        week_timeslots: [
          {
            recurrence: [...DAYS],
            timeslots: slots.map((x) => ({ start_time: { kind: 'time', time: { hour: Math.floor(x.at / 60), minute: x.at % 60, second: 0 } }, target: { rid: x.scene, rtype: 'scene' } })),
          },
        ],
        transition_duration: TRANSITION_MIN * 60_000,
      });
      out[t] = { smart, scenes };
      // Lights that are on now take the rhythm at once; rooms that are off stay off.
      if (group.lightIds.some((id) => s.lights.find((l) => l.id === id)?.on)) await activateSmartScene(smart).catch(() => null);
    } catch (e) {
      for (const sc of scenes) await deleteScene(sc).catch(() => null);
      throw e;
    }
  }
  return out;
}

const fmt = (c: Clock) => `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;

/** Saves a rhythm (new or changed). While on, the bridge copy is rebuilt to match. */
export async function saveRhythm(s: Snapshot, r: RhythmRitual) {
  const list = await loadRhythms();
  const old = list.find((x) => x.id === r.id);
  if (old) await removeFromBridge(old);
  const next: RhythmRitual = { ...r, bridge: r.enabled ? await putOnBridge(s, r) : {} };
  return save(old ? list.map((x) => (x.id === r.id ? next : x)) : [...list, next]);
}

export async function setRhythmEnabled(s: Snapshot, id: string, enabled: boolean) {
  const r = (await loadRhythms()).find((x) => x.id === id);
  return r ? saveRhythm(s, { ...r, enabled }) : cache;
}

export async function deleteRhythm(id: string) {
  const list = await loadRhythms();
  const r = list.find((x) => x.id === id);
  if (r) await removeFromBridge(r);
  return save(list.filter((x) => x.id !== id));
}

/** The smart scene that runs a room or group's day rhythm, if one is on (Glim's "turn on" recalls it). */
export function rhythmSceneFor(groupId: string): string | null {
  for (const r of cache) if (r.enabled && r.bridge[groupId]) return r.bridge[groupId].smart;
  return null;
}
