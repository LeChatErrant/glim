import { Linking, PermissionsAndroid, Platform } from 'react-native';

import { HueHttp } from '../../../modules/hue-http';
import { saveRitualSettings, type HomeRun } from './store';

/**
 * What arriving and leaving home tell you each time they run: a notification (HomeNotice.kt),
 * with a button sent from native code (Put back, Turn back on, Try again...), and the last run
 * kept for the ritual's card.
 */
export type HomeNotice = {
  title: string;
  text: string;
  /** What the card says, short ("Relax came on", "4 lights turned off"). */
  short: string;
  kind: HomeRun['kind'];
  button?: { title: string; batch: [string, string][]; done: string; pathOff?: object | null } | null;
};

export async function reportHome(which: 'arrive' | 'leave', n: HomeNotice) {
  const run: HomeRun = { at: Date.now(), kind: n.kind, text: n.short };
  await saveRitualSettings(which === 'arrive' ? { lastArrive: run } : { lastLeave: run }).catch(() => null);
  if (Platform.OS !== 'android' || !HueHttp.notifyHome) return;
  const b = n.button?.batch.length ? n.button : null;
  await HueHttp.notifyHome({
    title: n.title,
    text: n.text,
    problem: n.kind === 'failed',
    button: b && { title: b.title, batch: JSON.stringify(b.batch), done: b.done, pathOff: b.pathOff ? JSON.stringify(b.pathOff) : null },
  }).catch((e) => console.warn('Home notice', e));
}

/** Android 13+ asks before an app may post notifications; older versions always may. */
const needsAsking = () => Platform.OS === 'android' && Number(Platform.Version) >= 33;

export async function notificationsAllowed() {
  if (!needsAsking()) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => true);
}

/**
 * Asks when arriving or leaving is turned on (never blocks turning it on). `settings`: once
 * Android stops asking ("don't ask again"), opens Glim's settings instead.
 */
export async function askNotifications(settings = false) {
  if (!needsAsking()) return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => null);
  if (r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN && settings) Linking.openSettings();
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

/** "Salon", "Salon and Chambre", "Salon, Chambre and Lampe", "Salon, Chambre and 3 more". */
export function listNames(names: string[], max = 3) {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, max - 1).join(', ')} and ${names.length - max + 1} more`;
}

export const lightsWord = (n: number) => `${n} light${n === 1 ? '' : 's'}`;
