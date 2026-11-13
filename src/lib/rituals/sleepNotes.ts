import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { HueHttp } from '../../../modules/hue-http';
import { getBridge } from '../hue/bridge';

/**
 * Notes about sleep fades stopped by hand, shared with native code on Android (a widget or the
 * Quick Settings tile can stop a fade without JS, GlimSleep.kt), kept in the app elsewhere:
 * - `sleepStopped`: fade end times of fades stopped by hand (the bridge still says "started").
 * - `sleepPaused`: ritual ID (or 'now') → until when its level reset must not run (ms).
 */
type Note = 'sleepStopped' | 'sleepPaused';

const native = () => Platform.OS === 'android' && !!HueHttp.getSleepNotes && !!HueHttp.setSleepNotes;
const key = async (n: Note) => `${n}:${(await getBridge())?.id ?? 'none'}`;

async function read<T>(n: Note, fallback: T): Promise<T> {
  try {
    const raw = native() ? HueHttp.getSleepNotes!(n) : await AsyncStorage.getItem(await key(n));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function write(n: Note, value: unknown) {
  const raw = JSON.stringify(value);
  if (native()) HueHttp.setSleepNotes!(n, raw);
  else await AsyncStorage.setItem(await key(n), raw);
}

export const stoppedEnds = () => read<string[]>('sleepStopped', []);

export async function addStoppedEnds(ends: string[]) {
  const list = [...new Set([...(await stoppedEnds()), ...ends])];
  await write('sleepStopped', list.slice(-20));
}

export const pausedResets = () => read<Record<string, number>>('sleepPaused', {});
export const savePausedResets = (p: Record<string, number>) => write('sleepPaused', p);
