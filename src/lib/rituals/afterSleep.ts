import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from '../hue/bridge';
import { createBehavior, createScene, deleteBehavior, deleteScene, SCRIPT, updateBehavior, type Ref, type SceneAction } from '../hue/behaviors';
import type { Snapshot } from '../hue/client';
import { AFTER_SLEEP_READY } from './flags';
import { DAYS, type Clock, type Day } from './time';

/**
 * After a sleep fade. Hue's go-to-sleep leaves each light off at its lowest level, so the next
 * time it's turned on (a switch, the Hue app, Glim) it comes back at ~1% (tested). So each sleep
 * fade gets a second behavior on the bridge, a minute after the fade ends, that puts the lights'
 * level back while they stay off: a scene with only a brightness per light (no on/off, so it
 * doesn't turn anything on or off).
 */
type Refs = { behavior: string; scenes: string[] };

const key = async () => `after-sleep:${(await getBridge())?.id ?? 'none'}`;

async function load(): Promise<Record<string, Refs>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(await key())) ?? '{}');
  } catch {
    return {};
  }
}

async function save(all: Record<string, Refs>) {
  await AsyncStorage.setItem(await key(), JSON.stringify(all));
}

/** The level each light comes back at: its own (when known), else full. */
export type Levels = (lightId: string) => number;

function group(s: Snapshot, id: string): { ref: Ref; lightIds: string[] } | null {
  const room = s.rooms.find((r) => r.id === id);
  if (room) return { ref: { rid: id, rtype: 'room' }, lightIds: room.lightIds };
  const zone = s.zones?.find((z) => z.id === id);
  return zone ? { ref: { rid: id, rtype: 'zone' }, lightIds: zone.lightIds } : null;
}

/** Days moved one later when the fade ends after midnight. */
const shift = (days: Day[], by: number) => (by ? DAYS.filter((_, i) => days.includes(DAYS[(i + 6) % 7])) : days);

/**
 * Creates (or replaces) the "after sleep" behavior for a sleep fade: `ritualId` is the sleep
 * fade's behavior ID, or 'now'. `end` is when the fade ends (minutes after midnight, may pass
 * 1440); no days = once.
 */
export async function putAfterSleep(s: Snapshot, ritualId: string, targets: string[], end: Clock, days: Day[], enabled: boolean, levels: Levels = () => 100) {
  await removeAfterSleep(ritualId);
  if (!AFTER_SLEEP_READY) return;
  const at = end + 1;
  const scenes: string[] = [];
  const what: { group: Ref; recall: Ref }[] = [];
  try {
    for (const t of targets) {
      const g = group(s, t);
      if (!g) continue;
      // The bridge wants every light of the room in the scene; plugs have no level and are left out of it by an empty action.
      const actions: SceneAction[] = s.lights
        .filter((l) => g.lightIds.includes(l.id))
        .map((l) => ({ target: { rid: l.id, rtype: 'light' }, action: l.brightness !== null ? { dimming: { brightness: Math.max(1, Math.min(100, levels(l.id))) } } : {} }) as SceneAction);
      const scene = await createScene('Glim after sleep', g.ref, actions);
      scenes.push(scene);
      what.push({ group: g.ref, recall: { rid: scene, rtype: 'scene' } });
    }
    if (!what.length) return;
    const time = { hour: Math.floor((at % 1440) / 60), minute: at % 60 };
    const behavior = await createBehavior({
      script_id: SCRIPT.schedule,
      enabled,
      metadata: { name: 'Glim after sleep' },
      configuration: {
        when: { time_point: { type: 'time', time }, ...(days.length ? { recurrence_days: shift(days, at >= 1440 ? 1 : 0) } : {}) },
        what,
      },
    });
    const all = await load();
    all[ritualId] = { behavior, scenes };
    await save(all);
  } catch (e) {
    for (const sc of scenes) await deleteScene(sc).catch(() => null);
    throw e;
  }
}

export async function setAfterSleepEnabled(ritualId: string, enabled: boolean) {
  const refs = (await load())[ritualId];
  if (refs) await updateBehavior(refs.behavior, { enabled }).catch(() => null);
}

export async function removeAfterSleep(ritualId: string) {
  const all = await load();
  const refs = all[ritualId];
  if (!refs) return;
  await deleteBehavior(refs.behavior).catch(() => null);
  for (const sc of refs.scenes) await deleteScene(sc).catch(() => null);
  delete all[ritualId];
  await save(all);
}

const pausedKey = async () => `after-sleep-paused:${(await getBridge())?.id ?? 'none'}`;

/** A fade stopped by hand keeps its lights: tonight's "after sleep" must not change them. */
export async function pauseAfterSleep(ritualId: string, until: number) {
  await setAfterSleepEnabled(ritualId, false);
  const raw = await AsyncStorage.getItem(await pausedKey());
  const paused: Record<string, number> = raw ? JSON.parse(raw) : {};
  paused[ritualId] = until;
  await AsyncStorage.setItem(await pausedKey(), JSON.stringify(paused));
}

/** Switches back on the ones paused for a night that is over (scheduled fades only). */
export async function resumeAfterSleep(isOn: (ritualId: string) => boolean) {
  const raw = await AsyncStorage.getItem(await pausedKey());
  const paused: Record<string, number> = raw ? JSON.parse(raw) : {};
  let changed = false;
  for (const [id, until] of Object.entries(paused)) {
    if (Date.now() < until) continue;
    if (id !== 'now' && isOn(id)) await setAfterSleepEnabled(id, true);
    delete paused[id];
    changed = true;
  }
  if (changed) await AsyncStorage.setItem(await pausedKey(), JSON.stringify(paused));
}
