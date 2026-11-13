import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from '../hue/bridge';
import {
  createBehavior,
  deleteBehavior,
  listBehaviors,
  SCRIPT,
  updateBehavior,
  type BehaviorInstance,
  type Ref,
  type When,
} from '../hue/behaviors';
import { fetchSnapshot, setLight, type Snapshot } from '../hue/client';
import { pauseAfterSleep, putAfterSleep, removeAfterSleep, resumeAfterSleep, setAfterSleepEnabled } from './afterSleep';
import { DAYS, type Clock, type Day } from './time';

/**
 * Rituals that run on the bridge, so they happen with the phone off. Wake-ups and sleep fades are
 * Hue's own behaviors (read back from the bridge every time, so ones made in the Hue app show up
 * too, and nothing gets out of step); day rhythms are bridge smart scenes (see rhythm.ts).
 */

/** Lights fade up and reach `brightness` at `at` (the wake-up time). */
export type WakeRitual = {
  kind: 'wake';
  id: string;
  name: string;
  enabled: boolean;
  /** Rooms and groups (Hue room or zone IDs). */
  targets: string[];
  at: Clock;
  /** No days: once, the next time `at` comes. */
  days: Day[];
  fadeMin: number;
  brightness: number;
  style: 'sunrise' | 'basic';
};

/** Lights dim from where they are to off over `fadeMin`, starting at `at`. */
export type SleepRitual = {
  kind: 'sleep';
  id: string;
  name: string;
  enabled: boolean;
  targets: string[];
  at: Clock;
  days: Day[];
  fadeMin: number;
};

export type BridgeRitual = WakeRitual | SleepRitual;

/** A sleep fade running now: when it ends. */
export type SleepRun = { endsAt: number; targets: string[]; fadeMin: number };

const GTS_SCRIPTS: string[] = [SCRIPT.goToSleep, 'a5624529-bd7e-4bc8-9d2f-9200476f106e'];
/** The behavior used for "Sleep fade now": one per bridge, reused, hidden from the list. */
const NOW_NAME = 'Glim sleep now';
const STOPPED_KEY = 'sleep-stopped';

const timeOf = (w?: When): Clock => (w?.time_point?.time ? w.time_point.time.hour * 60 + w.time_point.time.minute : 7 * 60);
const daysOf = (w?: When): Day[] => DAYS.filter((d) => w?.recurrence_days?.includes(d));
const targetsOf = (b: BehaviorInstance) => (b.configuration.where ?? []).map((x) => x.group?.rid).filter(Boolean) as string[];

function fromBehavior(b: BehaviorInstance): BridgeRitual | null {
  const c = b.configuration;
  if (b.script_id === SCRIPT.wakeUp) {
    return {
      kind: 'wake',
      id: b.id,
      name: b.metadata?.name || 'Wake up',
      enabled: b.enabled,
      targets: targetsOf(b),
      at: timeOf(c.when),
      days: daysOf(c.when),
      fadeMin: Math.round((c.fade_in_duration?.seconds ?? 1800) / 60),
      brightness: Math.round(c.end_brightness ?? 100),
      style: c.style === 'basic' ? 'basic' : 'sunrise',
    };
  }
  if (GTS_SCRIPTS.includes(b.script_id) && b.metadata?.name !== NOW_NAME) {
    return {
      kind: 'sleep',
      id: b.id,
      name: b.metadata?.name || 'Sleep fade',
      enabled: b.enabled,
      targets: targetsOf(b),
      at: timeOf(c.when),
      days: daysOf(c.when),
      fadeMin: Math.round((c.fade_out_duration?.seconds ?? 1800) / 60),
    };
  }
  return null;
}

/** Wake-ups and sleep fades on the bridge, plus the sleep fade running now (if any). */
export async function loadBridgeRituals(): Promise<{ rituals: BridgeRitual[]; sleepRun: SleepRun | null }> {
  const all = await listBehaviors();
  const rituals = all.map(fromBehavior).filter(Boolean) as BridgeRitual[];
  await resumeAfterSleep((id) => !!rituals.find((r) => r.id === id)?.enabled).catch(() => null);
  // A sleep fade is running, ours ("now") or a scheduled one.
  const fadeOf = (b: BehaviorInstance) => Math.round((b.configuration.fade_out_duration?.seconds ?? 1800) / 60);
  // Switching a behavior off stops its fade, but the bridge keeps saying "started": skip the ones stopped here.
  const stopped = new Set<string>(JSON.parse((await AsyncStorage.getItem(STOPPED_KEY)) ?? '[]'));
  const running = all.find(
    (b) => GTS_SCRIPTS.includes(b.script_id) && b.state?.gts_state === 'started' && b.state?.fade_end_time && !stopped.has(b.state.fade_end_time) && Date.parse(b.state.fade_end_time) > Date.now(),
  );
  // "Now" waits for the coming minute: until then the bridge says "stopped".
  const pending = all.find((b) => b.metadata?.name === NOW_NAME && b.enabled && b.state?.gts_state !== 'started');
  let sleepRun: SleepRun | null = null;
  if (running) sleepRun = { endsAt: Date.parse(running.state!.fade_end_time), targets: targetsOf(running), fadeMin: fadeOf(running) };
  else if (pending) {
    const at = timeOf(pending.configuration.when);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(at / 60), at % 60).getTime();
    // Set for a time already past: the bridge never ran it (it was off at that minute).
    if (start > Date.now() - 60_000) sleepRun = { endsAt: start + fadeOf(pending) * 60_000, targets: targetsOf(pending), fadeMin: fadeOf(pending) };
  }
  return { rituals, sleepRun };
}

/** Hue room or zone reference for a target ID, from the snapshot. */
function groupRef(s: Snapshot, id: string): Ref | null {
  if (s.rooms.some((r) => r.id === id)) return { rid: id, rtype: 'room' };
  if (s.zones?.some((z) => z.id === id)) return { rid: id, rtype: 'zone' };
  return null;
}

const where = (s: Snapshot, targets: string[]) => targets.map((t) => groupRef(s, t)).filter(Boolean).map((group) => ({ group: group! }));

function when(at: Clock, days: Day[]): When {
  const w: When = { time_point: { type: 'time', time: { hour: Math.floor(at / 60), minute: at % 60 } } };
  if (days.length) w.recurrence_days = DAYS.filter((d) => days.includes(d));
  return w;
}

function config(s: Snapshot, r: BridgeRitual): Record<string, unknown> {
  if (r.kind === 'wake') {
    return { end_brightness: r.brightness, fade_in_duration: { seconds: r.fadeMin * 60 }, style: r.style, when: when(r.at, r.days), where: where(s, r.targets) };
  }
  return { end_state: 'turn_off', fade_out_duration: { seconds: r.fadeMin * 60 }, style: 'basic', when: when(r.at, r.days), where: where(s, r.targets) };
}

/** Creates the ritual on the bridge (id ignored) and returns its new ID. */
export async function createBridgeRitual(s: Snapshot, r: BridgeRitual) {
  const id = await createBehavior({
    script_id: r.kind === 'wake' ? SCRIPT.wakeUp : SCRIPT.goToSleep,
    enabled: r.enabled,
    metadata: { name: r.name.slice(0, 32) },
    configuration: config(s, r),
  });
  // The level reset is an extra: the fade is saved even if it can't be made.
  if (r.kind === 'sleep') await putAfterSleep(s, id, r.targets, r.at + r.fadeMin, r.days, r.enabled).catch(() => null);
  return id;
}

/** Saves changes. Settings this app doesn't know (made in the Hue app) are kept. */
export async function saveBridgeRitual(s: Snapshot, r: BridgeRitual) {
  const current = (await listBehaviors()).find((b) => b.id === r.id);
  const configuration = { ...(current?.configuration ?? {}), ...config(s, r) };
  // Back to "every week": a one-off must not keep old recurrence days.
  if (!r.days.length) delete (configuration.when as When).recurrence_days;
  await updateBehavior(r.id, { enabled: r.enabled, metadata: { name: r.name.slice(0, 32) }, configuration });
  if (r.kind === 'sleep') await putAfterSleep(s, r.id, r.targets, r.at + r.fadeMin, r.days, r.enabled).catch(() => null);
}

export async function setBridgeRitualEnabled(id: string, enabled: boolean) {
  await updateBehavior(id, { enabled });
  await setAfterSleepEnabled(id, enabled);
}

export async function deleteBridgeRitual(id: string) {
  await deleteBehavior(id);
  await removeAfterSleep(id);
}

const nowKey = async () => `sleep-now:${(await getBridge())?.id ?? 'none'}`;

/**
 * Starts a sleep fade now, on the bridge: Hue's go-to-sleep, set for the coming minute (the bridge
 * works in whole minutes) and for once. It turns itself off when done.
 */
export async function startSleepNow(s: Snapshot, targets: string[], fadeMin: number) {
  const start = new Date(Date.now() + 60_000);
  const configuration = {
    end_state: 'turn_off',
    fade_out_duration: { seconds: fadeMin * 60 },
    style: 'basic',
    when: when(start.getHours() * 60 + start.getMinutes(), []),
    where: where(s, targets),
  };
  const all = await listBehaviors();
  const saved = await AsyncStorage.getItem(await nowKey());
  const existing = all.find((b) => b.id === saved) ?? all.find((b) => b.metadata?.name === NOW_NAME);
  if (existing) {
    await updateBehavior(existing.id, { enabled: true, configuration });
  } else {
    const id = await createBehavior({ script_id: SCRIPT.goToSleep, enabled: true, metadata: { name: NOW_NAME }, configuration });
    await AsyncStorage.setItem(await nowKey(), id);
  }
  // A minute after the fade, each light gets back the level it has now (lights that are off: full).
  const level = new Map(s.lights.map((l) => [l.id, l.on && l.brightness ? l.brightness : 100]));
  await putAfterSleep(s, 'now', targets, start.getHours() * 60 + start.getMinutes() + fadeMin, [], true, (id) => level.get(id) ?? 100).catch(() => null);
  // Fades start on the minute: tell the screen when it ends.
  const begins = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()).getTime();
  return { endsAt: begins + fadeMin * 60_000, targets, fadeMin } satisfies SleepRun;
}

/**
 * Stops every sleep fade that is running or about to start, and keeps the lights where they are:
 * switching the behavior off doesn't stop a fade under way (tested), so each light of the fade is
 * set to the level it has reached, which ends the bridge's transition.
 */
export async function stopSleepNow() {
  const all = await listBehaviors();
  const fading = all.filter((b) => GTS_SCRIPTS.includes(b.script_id) && b.state?.gts_state === 'started' && Date.parse(b.state?.fade_end_time ?? '') > Date.now());
  const ends = all.map((b) => b.state?.fade_end_time).filter(Boolean) as string[];
  await AsyncStorage.setItem(STOPPED_KEY, JSON.stringify(ends.slice(-20)));
  const running = all.filter((b) => GTS_SCRIPTS.includes(b.script_id) && (b.metadata?.name === NOW_NAME ? b.enabled : b.state?.gts_state === 'started'));
  for (const b of running) {
    // The lights stay where they are: the level reset after the fade must not run tonight.
    const end = Date.parse(b.state?.fade_end_time ?? '') || Date.now() + 2 * 3600_000;
    await pauseAfterSleep(b.metadata?.name === NOW_NAME ? 'now' : b.id, end + 5 * 60_000);
    if (b.metadata?.name === NOW_NAME) await updateBehavior(b.id, { enabled: false });
    else {
      // A scheduled fade: switching it off and on again stops tonight's run and keeps the schedule.
      await updateBehavior(b.id, { enabled: false });
      await updateBehavior(b.id, { enabled: true });
    }
  }
  if (!fading.length) return;
  const s = await fetchSnapshot();
  const groups = new Set(fading.flatMap(targetsOf));
  const ids = new Set([...s.rooms, ...(s.zones ?? [])].filter((g) => groups.has(g.id)).flatMap((g) => g.lightIds));
  await Promise.all(s.lights.filter((l) => ids.has(l.id) && l.on && l.brightness !== null).map((l) => setLight(l.id, { brightness: Math.max(1, l.brightness!) })));
}
