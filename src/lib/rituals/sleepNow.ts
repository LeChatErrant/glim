import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { HueHttp } from '../../../modules/hue-http';
import { createBehavior, createScene, listBehaviors, SCRIPT, updateBehavior, updateScene, type BehaviorInstance, type Ref, type SceneAction } from '../hue/behaviors';
import { getBridge } from '../hue/bridge';
import { call, fetchSnapshot, setLight, type Snapshot } from '../hue/client';
import { afterSleepRefs, pauseAfterSleep, removeAfterSleep, setNowAfterSleep, type Levels } from './afterSleep';
import { addStoppedEnds, stoppedEnds } from './sleepNotes';

/**
 * "Sleep fade now": the Rituals tab's Start, a Moods widget button and the Quick Settings tile.
 * The bridge keeps one set of things for it, made once and changed at each start, so a widget or
 * the tile can start a fade from native code without JS (GlimSleep.kt sends the same requests):
 * - the go-to-sleep behavior "Glim sleep now", set for the coming minute, with no days (the
 *   bridge runs it once and switches it off);
 * - the level reset after it ("Glim after sleep": a schedule behavior recalling one scene per
 *   room or group, each light's level from the start; lights come back on at ~1% otherwise).
 */
export const NOW_NAME = 'Glim sleep now';
export const GTS_SCRIPTS: string[] = [SCRIPT.goToSleep, 'a5624529-bd7e-4bc8-9d2f-9200476f106e'];

/** A sleep fade running now: when it ends. `fadeMin` is its whole length. */
export type SleepRun = { endsAt: number; targets: string[]; fadeMin: number };

/** The bridge's "sleep now" things: the fade, the level reset, and its scene per room or group. */
type Pool = { now: string; after: string; scenes: Record<string, string> };

const poolKey = async () => `sleep-pool:${(await getBridge())?.id ?? 'none'}`;

async function loadPool(): Promise<Pool> {
  try {
    return { now: '', after: '', scenes: {}, ...JSON.parse((await AsyncStorage.getItem(await poolKey())) ?? '{}') };
  } catch {
    return { now: '', after: '', scenes: {} };
  }
}

function group(s: Snapshot, id: string): { ref: Ref; lightIds: string[] } | null {
  const room = s.rooms.find((r) => r.id === id);
  if (room) return { ref: { rid: id, rtype: 'room' }, lightIds: room.lightIds };
  const zone = s.zones?.find((z) => z.id === id);
  return zone ? { ref: { rid: id, rtype: 'zone' }, lightIds: zone.lightIds } : null;
}

const timePoint = (d: Date) => ({ type: 'time' as const, time: { hour: d.getHours(), minute: d.getMinutes() } });

/** A level scene's actions: every light of the room (the bridge wants them all), plugs a no-op. */
function levelActions(s: Snapshot, lightIds: string[], levels: Levels): SceneAction[] {
  return s.lights
    .filter((l) => lightIds.includes(l.id))
    .map((l) => ({ target: { rid: l.id, rtype: 'light' }, action: l.brightness !== null ? { dimming: { brightness: Math.max(1, Math.min(100, levels(l.id))) } } : { dynamics: { duration: 0 } } }) as SceneAction);
}

/** Checked against the bridge once per app run (or when something is missing); cheap after that. */
let checked = false;
let lastNative = '';

/**
 * Makes sure the bridge has what "sleep fade now" changes for these rooms and groups, and tells
 * native code (widget and tile taps). Safe to call often.
 */
export function ensureSleepPool(s: Snapshot, targets: string[], known?: BehaviorInstance[]): Promise<Pool> {
  // One at a time: two widgets drawn at once must not each make the same things on the bridge.
  const next = queue.catch(() => null).then(() => ensurePool(s, targets, known));
  queue = next;
  return next;
}

let queue: Promise<unknown> = Promise.resolve();

async function ensurePool(s: Snapshot, targets: string[], known?: BehaviorInstance[]): Promise<Pool> {
  const pool = await loadPool();
  const groups = targets.filter((t) => group(s, t));
  if (!checked || !pool.now || !pool.after || groups.some((g) => !pool.scenes[g])) {
    const all = known ?? (await listBehaviors());
    const scenes = new Set((await call('scene')).map((x) => x.id));
    // Before this pool, each "now" made its own level reset: remove the last one.
    if (!pool.after) await removeAfterSleep('now').catch(() => null);
    if (!all.some((b) => b.id === pool.now)) {
      const named = all.find((b) => GTS_SCRIPTS.includes(b.script_id) && b.metadata?.name === NOW_NAME);
      const first = groups[0] ?? s.rooms.find((r) => r.lightIds.length)?.id;
      pool.now =
        named?.id ??
        (await createBehavior({
          script_id: SCRIPT.goToSleep,
          enabled: false,
          metadata: { name: NOW_NAME },
          configuration: { end_state: 'turn_off', fade_out_duration: { seconds: 1200 }, style: 'basic', when: { time_point: timePoint(new Date()) }, where: first ? [{ group: group(s, first)!.ref }] : [] },
        }));
    }
    for (const [g, sc] of Object.entries(pool.scenes)) if (!scenes.has(sc) || !group(s, g)) delete pool.scenes[g];
    for (const g of groups) {
      if (pool.scenes[g]) continue;
      const { ref, lightIds } = group(s, g)!;
      pool.scenes[g] = await createScene('Glim after sleep', ref, levelActions(s, lightIds, () => 100));
    }
    const first = Object.entries(pool.scenes)[0];
    if (!all.some((b) => b.id === pool.after) && first) {
      const ref = group(s, first[0])!.ref;
      pool.after = await createBehavior({
        script_id: SCRIPT.schedule,
        enabled: false,
        metadata: { name: 'Glim after sleep' },
        configuration: { when_extended: { start_at: { time_point: timePoint(new Date()) } }, what: [{ group: ref, recall: { rid: first[1], rtype: 'scene' } }], where: [{ group: ref }] },
      });
    }
    await AsyncStorage.setItem(await poolKey(), JSON.stringify(pool));
    if (pool.after) await setNowAfterSleep({ behavior: pool.after, scenes: Object.values(pool.scenes) });
    checked = true;
  }
  await syncNative(s, pool);
  return pool;
}

/** What GlimSleep.kt needs: the pool, every room and group's lights, each ritual's level reset. */
async function syncNative(s: Snapshot, pool: Pool) {
  if (Platform.OS !== 'android' || !HueHttp.setSleepPool) return;
  const groups: Record<string, { rtype: string; scene: string; lights: string[]; dim: string[] }> = {};
  for (const g of [...s.rooms.map((r) => ({ ...r, rtype: 'room' })), ...(s.zones ?? []).map((z) => ({ ...z, rtype: 'zone' }))]) {
    const dim = s.lights.filter((l) => g.lightIds.includes(l.id) && l.brightness !== null).map((l) => l.id);
    groups[g.id] = { rtype: g.rtype, scene: pool.scenes[g.id] ?? '', lights: g.lightIds, dim };
  }
  const refs = await afterSleepRefs();
  const afterByRitual = Object.fromEntries(Object.entries(refs).filter(([id]) => id !== 'now').map(([id, r]) => [id, r.behavior]));
  const json = JSON.stringify({ now: pool.now, after: pool.after, groups, afterByRitual });
  if (json === lastNative) return;
  await HueHttp.setSleepPool(json);
  lastNative = json;
}

/**
 * Sets the fade going from `start` (a whole minute) for `fadeSec`, and its level reset a minute
 * after. `levels`: each light's level for the reset; null keeps the scenes as they are (+5 min).
 */
async function startFade(s: Snapshot, pool: Pool, targets: string[], start: Date, fadeSec: number, levels: Levels | null) {
  const where = targets.map((t) => group(s, t)).filter(Boolean).map((g) => ({ group: g!.ref }));
  await updateBehavior(pool.now, {
    enabled: true,
    configuration: { end_state: 'turn_off', fade_out_duration: { seconds: Math.round(fadeSec) }, style: 'basic', when: { time_point: timePoint(start) }, where },
  });
  if (!pool.after) return;
  const what: { group: Ref; recall: Ref }[] = [];
  for (const t of targets) {
    const g = group(s, t);
    const scene = pool.scenes[t];
    if (!g || !scene) continue;
    if (levels) await updateScene(scene, { actions: levelActions(s, g.lightIds, levels) }).catch(() => null);
    what.push({ group: g.ref, recall: { rid: scene, rtype: 'scene' } });
  }
  if (!what.length) return;
  // A minute after the fade ends (rounded up to the minute).
  const at = new Date(start.getTime() + fadeSec * 1000 + 60_000 + 59_999);
  await updateBehavior(pool.after, {
    enabled: true,
    configuration: { when_extended: { start_at: { time_point: timePoint(at) } }, what, where: what.map((w) => ({ group: w.group })) },
  }).catch(() => null);
}

/** The coming whole minute: fades start on the minute. */
function nextMinute() {
  const d = new Date(Date.now() + 60_000);
  d.setSeconds(0, 0);
  return d;
}

/**
 * Starts a sleep fade now, on the bridge, from the coming minute. A minute after the fade, each
 * light gets back the level it has now (lights that are off: full).
 */
export async function startSleepNow(s: Snapshot, targets: string[], fadeMin: number): Promise<SleepRun> {
  const pool = await ensureSleepPool(s, targets);
  const start = nextMinute();
  const level = new Map(s.lights.map((l) => [l.id, l.on && l.brightness ? l.brightness : 100]));
  await startFade(s, pool, targets, start, fadeMin * 60, (id) => level.get(id) ?? 100);
  return { endsAt: start.getTime() + fadeMin * 60_000, targets, fadeMin };
}

const targetsOf = (b: BehaviorInstance) => (b.configuration.where ?? []).map((x) => x.group?.rid).filter(Boolean) as string[];
const fadeSecOf = (b: BehaviorInstance) => b.configuration.fade_out_duration?.seconds ?? 1800;

/** The fades under way on the bridge (not stopped by hand). */
function fadesUnderWay(all: BehaviorInstance[], stopped: Set<string>) {
  return all.filter((b) => GTS_SCRIPTS.includes(b.script_id) && b.state?.gts_state === 'started' && b.state?.fade_end_time && !stopped.has(b.state.fade_end_time) && Date.parse(b.state.fade_end_time) > Date.now());
}

/** "Now" set for the coming minute: when it starts, or null. */
function pendingStart(b: BehaviorInstance | undefined, stopped: Set<string>): number | null {
  // Before its minute the bridge says "stopped", or still "started" from a fade stopped by hand.
  if (!b || b.metadata?.name !== NOW_NAME || !b.enabled) return null;
  if (b.state?.gts_state === 'started' && !stopped.has(b.state.fade_end_time) && Date.parse(b.state.fade_end_time ?? '') > Date.now()) return null;
  const t = b.configuration.when?.time_point?.time;
  if (!t) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.hour, t.minute).getTime();
  // Set for a time already past: the bridge never ran it (it was off at that minute).
  return start > Date.now() - 60_000 && start < Date.now() + 120_000 ? start : null;
}

/** The sleep fade running now (ours or a scheduled one), or about to start. */
export async function findSleepRun(all?: BehaviorInstance[]): Promise<SleepRun | null> {
  const list = all ?? (await listBehaviors());
  const stopped = new Set(await stoppedEnds());
  const running = fadesUnderWay(list, stopped)[0];
  if (running) return { endsAt: Date.parse(running.state!.fade_end_time), targets: targetsOf(running), fadeMin: fadeSecOf(running) / 60 };
  const now = list.find((b) => GTS_SCRIPTS.includes(b.script_id) && b.metadata?.name === NOW_NAME);
  const start = pendingStart(now, stopped);
  return start !== null && now ? { endsAt: start + fadeSecOf(now) * 1000, targets: targetsOf(now), fadeMin: fadeSecOf(now) / 60 } : null;
}

/** Sets each light of these rooms and groups that is on to the level it has: ends a bridge fade there. */
async function holdLights(groups: Set<string>) {
  if (!groups.size) return;
  const s = await fetchSnapshot();
  const ids = new Set([...s.rooms, ...(s.zones ?? [])].filter((g) => groups.has(g.id)).flatMap((g) => g.lightIds));
  await Promise.all(s.lights.filter((l) => ids.has(l.id) && l.on && l.brightness !== null).map((l) => setLight(l.id, { brightness: Math.max(1, l.brightness!) })));
}

/**
 * Stops every sleep fade that is running or about to start, and keeps the lights where they are:
 * switching the behavior off doesn't stop a fade under way (tested), so each light of the fade is
 * set to the level it has reached, which ends the bridge's transition.
 */
export async function stopSleepNow() {
  const all = await listBehaviors();
  const fading = fadesUnderWay(all, new Set(await stoppedEnds()));
  await addStoppedEnds(all.map((b) => b.state?.fade_end_time).filter(Boolean) as string[]);
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
  await holdLights(new Set(fading.flatMap(targetsOf)));
}

/**
 * Makes the running sleep fade end `addMin` minutes later. The bridge can't change a fade under
 * way, so the lights are held where they are and a new fade starts from there on the coming
 * minute, ending 5 minutes after the old one. The level reset keeps the levels from the start.
 */
export async function extendSleep(s: Snapshot, run: SleepRun, addMin = 5): Promise<SleepRun> {
  const all = await listBehaviors();
  const pool = await ensureSleepPool(s, run.targets, all);
  const stopped = new Set(await stoppedEnds());
  const endsAt = run.endsAt + addMin * 60_000;
  const fading = fadesUnderWay(all, stopped);
  const pending = pendingStart(all.find((b) => b.id === pool.now), stopped);
  if (!fading.length && pending !== null) {
    // Not started yet: the same start, a longer fade.
    const fadeSec = (endsAt - pending) / 1000;
    await startFade(s, pool, run.targets, new Date(pending), fadeSec, null);
    return { ...run, endsAt, fadeMin: fadeSec / 60 };
  }
  await addStoppedEnds(fading.map((b) => b.state!.fade_end_time));
  let scheduled = false;
  for (const b of fading) {
    if (b.id === pool.now) await updateBehavior(b.id, { enabled: false });
    else {
      // A scheduled fade: tonight's run stops here (and its own level reset with it); ours takes over.
      scheduled = true;
      await pauseAfterSleep(b.id, endsAt + 5 * 60_000);
      await updateBehavior(b.id, { enabled: false });
      await updateBehavior(b.id, { enabled: true });
    }
  }
  await holdLights(new Set(run.targets));
  const start = nextMinute();
  const fadeSec = Math.max(60, (endsAt - start.getTime()) / 1000);
  // A scheduled fade's reset puts every light back at full; ours keeps the levels from its start.
  await startFade(s, pool, run.targets, start, fadeSec, scheduled ? () => 100 : null);
  return { endsAt: start.getTime() + fadeSec * 1000, targets: run.targets, fadeMin: fadeSec / 60 };
}
