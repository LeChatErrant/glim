import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { planToggleRoom } from '../actions';
import { fetchSnapshot, setRoom, type Snapshot } from '../hue/client';
import { loadMap } from '../map/map';
import { loadMoods, planMood } from '../moods';
import { ARRIVE_READY } from './flags';
import { loadRitualSettings, saveRitualSettings, type Arrive, type HomeArea } from './store';
import { sunTimes } from './sun';

/**
 * Arriving and leaving home: a geofence on the phone. Android wakes the app's JS in the background
 * when the phone crosses the circle around home (even with the app closed), and the app applies a
 * mood (or turns lights on) when arriving, or turns everything off when leaving. Requests go through
 * the usual route: straight to the bridge, or Hue's cloud while still on mobile data.
 *
 * Hue's own `geofence_client` was looked at: it only holds "is at home" for a phone, and the bridge
 * then runs a behavior. The phone still has to notice it's home, and the bridge would need a bridge
 * scene for each mood, so the phone applies the mood itself.
 */
export const GEOFENCE_TASK = 'glim-geofence';
const REGION_ID = 'home';

type GeofenceEvent = { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

/** Is now within the arriving ritual's conditions (after sunset, active hours)? */
export function arriveAllowed(a: Arrive, area: HomeArea, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (a.afterSunset) {
    const sun = sunTimes(area.lat, area.lon, now);
    // Dark before sunrise too: arriving at 1 a.m. counts as "after sunset".
    if (sun && minutes >= sun.rise && minutes < sun.set) return false;
  }
  if (a.hours) {
    const [from, to] = a.hours;
    const inside = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (!inside) return false;
  }
  return true;
}

/** What arriving does: the chosen mood, or the chosen room or group (or every light) on. */
async function arriveNow(a: Arrive, s: Snapshot) {
  if (a.moodId) {
    const mood = (await loadMoods()).find((m) => m.id === a.moodId);
    const plan = mood && planMood(s, mood, await loadMap());
    if (plan) return plan.send();
  }
  if (a.targetId) {
    const plan = planToggleRoom(s, a.targetId, true);
    if (plan) return plan.send();
  }
  if (s.homeGroupId) return setRoom(s.homeGroupId, { on: true });
}

async function leaveNow(s: Snapshot) {
  if (s.homeGroupId) await setRoom(s.homeGroupId, { on: false });
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
  const s = await fetchSnapshot();
  if (entering && settings.arrive.enabled && arriveAllowed(settings.arrive, area)) await arriveNow(settings.arrive, s);
  if (!entering && settings.leave.enabled) await leaveNow(s);
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

/** Where the phone is now, precisely (to set the home circle). */
export async function hereNow() {
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
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
