import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from '../hue/bridge';
import type { Clock } from './time';

/** The circle around home that arriving and leaving watch. Kept on the phone only. */
export type HomeArea = { lat: number; lon: number; radius: number };

/** Arriving home: a mood, or a room or group (or every light, both null) turned on. */
export type Arrive = {
  enabled: boolean;
  moodId: string | null;
  targetId: string | null;
  afterSunset: boolean;
  /** Only between these times (minutes after midnight; may wrap past midnight), or any time. */
  hours: [Clock, Clock] | null;
};

export type RitualSettings = {
  home: HomeArea | null;
  arrive: Arrive;
  leave: { enabled: boolean };
  /** Last side of the circle the phone was seen on (null: not known yet). */
  atHome: boolean | null;
};

const DEFAULTS: RitualSettings = {
  home: null,
  arrive: { enabled: false, moodId: null, targetId: null, afterSunset: true, hours: null },
  leave: { enabled: false },
  atHome: null,
};

const key = async () => `rituals:${(await getBridge())?.id ?? 'none'}`;

export async function loadRitualSettings(): Promise<RitualSettings> {
  try {
    const raw = await AsyncStorage.getItem(await key());
    const saved = raw ? (JSON.parse(raw) as Partial<RitualSettings>) : {};
    return { ...DEFAULTS, ...saved, arrive: { ...DEFAULTS.arrive, ...saved.arrive }, leave: { ...DEFAULTS.leave, ...saved.leave } };
  } catch {
    return DEFAULTS;
  }
}

export async function saveRitualSettings(change: Partial<RitualSettings>) {
  const before = await loadRitualSettings();
  const next = { ...before, ...change };
  // A new home circle: which side the phone is on isn't known yet.
  if (change.home && JSON.stringify(change.home) !== JSON.stringify(before.home)) next.atHome = null;
  await AsyncStorage.setItem(await key(), JSON.stringify(next));
  return next;
}
