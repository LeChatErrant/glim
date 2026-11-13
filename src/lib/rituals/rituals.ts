import { createBehavior, deleteBehavior, listBehaviors, SCRIPT, updateBehavior, type BehaviorInstance, type Ref, type When } from '../hue/behaviors';
import type { Snapshot } from '../hue/client';
import { putAfterSleep, removeAfterSleep, resumeAfterSleep, setAfterSleepEnabled } from './afterSleep';
import { findSleepRun, GTS_SCRIPTS, NOW_NAME, type SleepRun } from './sleepNow';
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

export { extendSleep, startSleepNow, stopSleepNow, type SleepRun } from './sleepNow';

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
  const sleepRun = await findSleepRun(all);
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
