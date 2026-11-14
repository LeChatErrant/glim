import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Linking } from 'react-native';

import { findGroup, planToggleRoom, type Planned } from '../actions';
import { cachedSnapshot, fetchSnapshot, setLight, setRoom, stateBody, type Snapshot } from '../hue/client';
import { loadMap, type HomeMap } from '../map/map';
import { captureLights, loadMoods, moodLights, moodRequests, pathOffFor, planMood, type Mood } from '../moods';
import { ARRIVE_READY } from './flags';
import { lightsWord, listNames, reportHome } from './homeNotice';
import { rhythmSceneFor } from './rhythm';
import { loadRitualSettings, saveRitualSettings, type Arrive, type HomeArea } from './store';
import { sunTimes } from './sun';
import { fmtClock } from './time';

/**
 * Arriving and leaving home: a geofence on the phone. Android wakes the app's JS in the background
 * when the phone crosses the circle around home (even with the app closed), and the app applies a
 * mood (or turns lights on) when arriving, or turns everything off when leaving. Requests go through
 * the usual route: straight to the bridge, or Hue's cloud while still on mobile data.
 *
 * Each run says what it did: a notification (homeNotice.ts) with a button to undo it, or to try
 * again when the lights couldn't be reached, and the last run on the ritual's card.
 *
 * Hue's own `geofence_client` was looked at: it only holds "is at home" for a phone, and the bridge
 * then runs a behavior. The phone still has to notice it's home, and the bridge would need a bridge
 * scene for each mood, so the phone applies the mood itself.
 */
export const GEOFENCE_TASK = 'glim-geofence';
const REGION_ID = 'home';

type GeofenceEvent = { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

const NO_ANSWER = 'neither your bridge nor Hue’s cloud answered';
const OFF = JSON.stringify(stateBody({ on: false }));

/** Why arriving won't act now ("it’s before sunset (17:42)"), or null when it may. */
export function arriveBlock(a: Arrive, area: HomeArea, now = new Date()): string | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (a.afterSunset) {
    const sun = sunTimes(area.lat, area.lon, now);
    // Dark before sunrise too: arriving at 1 a.m. counts as "after sunset".
    if (sun && minutes >= sun.rise && minutes < sun.set) return `it’s before sunset (${fmtClock(sun.set)})`;
  }
  if (a.hours) {
    const [from, to] = a.hours;
    const inside = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (!inside) return `it’s outside ${fmtClock(from)}–${fmtClock(to)}`;
  }
  return null;
}

/** Is now within the arriving ritual's conditions (after sunset, active hours)? */
export const arriveAllowed = (a: Arrive, area: HomeArea, now = new Date()) => !arriveBlock(a, area, now);

/**
 * What arriving does: the chosen mood, or the chosen room or group (or every light) on. `plan`
 * sends it from JS; `requests` are the same as bridge requests for the notification's button
 * (sent from native code), with a path's auto-off.
 */
type ArriveWhat = { name: string; lightIds: string[]; plan: Planned; requests: [string, string][]; pathOff: object | null };

function arriveWhat(s: Snapshot, a: Arrive, moods: Mood[], map: HomeMap | null): ArriveWhat | null {
  const mood = a.moodId ? moods.find((m) => m.id === a.moodId) : undefined;
  if (mood) {
    const lights = moodLights(s, mood, map);
    const plan = planMood(s, mood, map);
    if (plan) return { name: mood.name, lightIds: lights.map((m) => m.lightId), plan, requests: moodRequests(s, lights, mood), pathOff: pathOffFor(s, mood, map) };
  }
  const g = a.targetId ? findGroup(s, a.targetId) : undefined;
  const plan = g && planToggleRoom(s, g.id, true);
  if (g?.groupedLightId && plan) {
    // A room with a day rhythm comes on in the light of the hour (as planToggleRoom does).
    const smart = rhythmSceneFor(g.id);
    const request: [string, string] = smart
      ? [`smart_scene/${smart}`, JSON.stringify({ recall: { action: 'activate' } })]
      : [`grouped_light/${g.groupedLightId}`, JSON.stringify(stateBody({ on: true }))];
    return { name: g.name, lightIds: g.lightIds, plan, requests: [request], pathOff: null };
  }
  const home = s.homeGroupId;
  if (!home) return null;
  return {
    name: 'Every light',
    lightIds: s.lights.map((l) => l.id),
    plan: { next: s, send: () => setRoom(home, { on: true }) },
    requests: [[`grouped_light/${home}`, JSON.stringify(stateBody({ on: true }))]],
    pathOff: null,
  };
}

const turnOnButton = (w: ArriveWhat | null) => w && { title: 'Turn on', batch: w.requests, done: `${w.name} is on`, pathOff: w.pathOff };

/** The phone came home: applies the ritual (or says why not), then says what it did. */
async function runArrive(a: Arrive, area: HomeArea) {
  const [moods, map] = await Promise.all([loadMoods(), loadMap()]);
  let s: Snapshot | null = null;
  let what: ArriveWhat | null = null;
  const block = arriveBlock(a, area);
  if (block) {
    // Nothing to send: the last known lights are enough for the button.
    s = await fetchSnapshot().catch(() => cachedSnapshot());
    what = s && arriveWhat(s, a, moods, map);
    return reportHome('arrive', {
      kind: 'skipped',
      title: 'Welcome home',
      text: `Lights left as they are: ${block}.`,
      short: `Skipped: ${block}`,
      button: turnOnButton(what),
    });
  }
  try {
    s = await fetchSnapshot();
    what = arriveWhat(s, a, moods, map);
    if (!what) {
      return reportHome('arrive', { kind: 'failed', title: 'Welcome home', text: 'Nothing to turn on: the room or mood picked is gone.', short: 'Nothing to turn on' });
    }
    const ids = new Set(what.lightIds);
    const before = captureLights(s.lights.filter((l) => ids.has(l.id)));
    await what.plan.send();
    const wasDark = before.every((m) => !m.on);
    await reportHome('arrive', {
      kind: 'done',
      title: 'Welcome home',
      text: `${what.name} is on.`,
      short: `${what.name} came on`,
      // Undo: every light it touched, as it was (off, most of the time).
      button: { title: wasDark ? 'Turn off' : 'Put back', batch: moodRequests(s, before), done: wasDark ? 'Lights off' : 'Lights put back' },
    });
  } catch {
    if (!what) {
      const c = s ?? (await cachedSnapshot().catch(() => null));
      what = c && arriveWhat(c, a, moods, map);
    }
    await reportHome('arrive', {
      kind: 'failed',
      title: 'Couldn’t turn your lights on',
      text: `You’re home, but ${NO_ANSWER}.`,
      short: 'Couldn’t reach your lights',
      button: turnOnButton(what),
    });
  }
}

/** Every light off: through the whole home's group, or light by light when the bridge has none. */
function offRequests(s: Snapshot): [string, string][] {
  return s.homeGroupId ? [[`grouped_light/${s.homeGroupId}`, OFF]] : s.lights.map((l): [string, string] => [`light/${l.id}`, OFF]);
}

async function leaveNow(s: Snapshot) {
  if (s.homeGroupId) await setRoom(s.homeGroupId, { on: false });
  else await Promise.all(s.lights.filter((l) => l.on).map((l) => setLight(l.id, { on: false })));
}

/** The phone left home: every light off, then says which went off (with a way to turn them back on). */
async function runLeave() {
  let s: Snapshot | null = null;
  try {
    s = await fetchSnapshot();
    const on = s.lights.filter((l) => l.on && l.reachable);
    if (!on.length) {
      return reportHome('leave', { kind: 'nothing', title: 'You left home', text: 'Every light was already off.', short: 'Everything was already off' });
    }
    await leaveNow(s);
    await reportHome('leave', {
      kind: 'done',
      title: `You left home · ${lightsWord(on.length)} off`,
      text: `${listNames(on.map((l) => l.name))} turned off.`,
      short: `${lightsWord(on.length)} turned off`,
      // Someone still home: they come back on as they were.
      button: { title: 'Turn back on', batch: moodRequests(s, captureLights(on)), done: 'Lights back on as you left them' },
    });
  } catch {
    const on = s ? s.lights.filter((l) => l.on && l.reachable) : [];
    const c = s ?? (await cachedSnapshot().catch(() => null));
    await reportHome('leave', {
      kind: 'failed',
      title: 'Couldn’t turn your lights off',
      text: on.length ? `You left home with ${listNames(on.map((l) => l.name))} on: ${NO_ANSWER}.` : `You left home, but ${NO_ANSWER}. Lights may still be on.`,
      short: 'Couldn’t reach your lights',
      button: c ? { title: 'Try again', batch: offRequests(c), done: 'Every light is off' } : null,
    });
  }
}

/** Runs in the background when the phone enters or leaves the circle around home. */
export async function onGeofence(e: GeofenceEvent) {
  const settings = await loadRitualSettings();
  const area = settings.home;
  if (!area) return;
  const entering = e.eventType === Location.GeofencingEventType.Enter;
  // Android reports the current side when the geofence is registered: only a real crossing acts
  // (setting home while at home must not turn the lights on).
  const before = settings.atHome;
  if (before === entering) return;
  await saveRitualSettings({ atHome: entering });
  if (before === null) return;
  if (entering && settings.arrive.enabled) await runArrive(settings.arrive, area);
  if (!entering && settings.leave.enabled) await runLeave();
}

// Defined at load (index.ts imports this file), so a background start finds the task.
if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask<GeofenceEvent>(GEOFENCE_TASK, async ({ data, error }) => {
    if (error || !data) return;
    try {
      await onGeofence(data);
    } catch {
      // Nothing to show in the background; the next crossing tries again.
    }
  });
}

/** Can geofencing run with the app closed? Foreground and background location both granted. */
export async function locationAccess(): Promise<'all' | 'foreground' | 'none'> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'none';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted ? 'all' : 'foreground';
}

/** Asks for location (precise, then "Allow all the time"). Returns what was granted. */
export async function askLocationAccess(): Promise<'all' | 'foreground' | 'none'> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'none';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted ? 'all' : 'foreground';
}

/** Where the phone is now, precisely (to set the home circle). Asks for location while in use if needed. */
export async function hereNow() {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted && !(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Location is off for Glim.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
}

/**
 * Why arriving and leaving can't run now, though one is on: location not allowed all the time,
 * location off on the phone, or the circle not watched. Null when all is well (or both are off).
 * Watches the circle again first (Android forgets it after a reboot, for one).
 */
export type WatchProblem = 'access' | 'location-off' | 'not-watching';

export async function watchProblem(): Promise<WatchProblem | null> {
  const s = await loadRitualSettings();
  if (!ARRIVE_READY || !s.home || !(s.arrive.enabled || s.leave.enabled)) return null;
  if ((await locationAccess()) !== 'all') return 'access';
  if (!(await Location.hasServicesEnabledAsync().catch(() => true))) return 'location-off';
  return (await syncGeofence().catch(() => false)) ? null : 'not-watching';
}

/** The card's Fix: asks for location all the time, turns location on, or watches again. */
export async function fixWatch(problem: WatchProblem) {
  if (problem === 'access') {
    if ((await askLocationAccess().catch(() => 'none' as const)) !== 'all') await Linking.openSettings();
  } else if (problem === 'location-off') {
    await Location.enableNetworkProviderAsync().catch(() => null);
  }
  return watchProblem();
}

/**
 * Starts or stops watching the home circle, to match the settings: on while arriving or leaving
 * is on and a home area is set. Called after every change and at app start.
 */
export async function syncGeofence() {
  const settings = await loadRitualSettings();
  const want = ARRIVE_READY && !!settings.home && (settings.arrive.enabled || settings.leave.enabled);
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
  if (!want || (await locationAccess()) !== 'all') {
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    return false;
  }
  const { lat, lon, radius } = settings.home!;
  await Location.startGeofencingAsync(GEOFENCE_TASK, [
    { identifier: REGION_ID, latitude: lat, longitude: lon, radius, notifyOnEnter: true, notifyOnExit: true },
  ]);
  return true;
}
