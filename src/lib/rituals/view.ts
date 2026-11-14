import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from '../hue/bridge';
import { loadMoods, type Mood } from '../moods';
import { checkRhythms, loadRhythms, type RhythmRitual } from './rhythm';
import { loadBridgeRituals, type BridgeRitual, type SleepRun } from './rituals';
import { loadRitualSettings, type RitualSettings } from './store';

/**
 * Everything the Rituals tab shows, kept between visits so the tab opens with its whole list at
 * once. The bridge's part (wake-ups, sleep fades, a fade under way) is also kept on the phone, per
 * bridge, so even the first visit after a start shows the last known list while the bridge is
 * read back (a few hundred ms at home, a second or more through Hue's cloud).
 */
export type RitualsView = {
  /** null: the bridge was never read for this bridge. */
  bridge: BridgeRitual[] | null;
  sleepRun: SleepRun | null;
  rhythms: RhythmRitual[];
  settings: RitualSettings;
  moods: Mood[];
};

let memo: RitualsView | null = null;

const key = async () => `rituals-view:${(await getBridge())?.id ?? 'none'}`;

/** A fade that has ended by now isn't shown. */
const live = (run: SleepRun | null) => (run && run.endsAt > Date.now() ? run : null);

/** The last view, at once (null before the first read since the app started). */
export function cachedRituals(): RitualsView | null {
  return memo ? { ...memo, sleepRun: live(memo.sleepRun) } : null;
}

/** Keeps what the screen shows now (after an optimistic change), for the next visit. */
export function rememberRituals(view: RitualsView) {
  memo = view;
}

/** Settings changed elsewhere (Settings → Home location): the next visit starts from them. */
export function rememberSettings(settings: RitualSettings) {
  if (memo) memo = { ...memo, settings };
}

/** Everything that's on the phone, plus the bridge's part as last read. Fast: no bridge request. */
export async function localRituals(): Promise<RitualsView> {
  const [settings, moods, rhythms, raw] = await Promise.all([
    loadRitualSettings(),
    loadMoods(),
    loadRhythms(),
    key().then((k) => AsyncStorage.getItem(k)).catch(() => null),
  ]);
  let saved: { bridge: BridgeRitual[]; sleepRun: SleepRun | null } | null = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {}
  memo = { bridge: saved?.bridge ?? memo?.bridge ?? null, sleepRun: live(saved?.sleepRun ?? null), rhythms, settings, moods };
  return memo;
}

/** Reads the bridge back and keeps the result. Throws when the bridge can't be reached. */
export async function fetchRituals(): Promise<RitualsView> {
  const [local, b, rhythms] = await Promise.all([localRituals(), loadBridgeRituals(), checkRhythms()]);
  memo = { ...local, bridge: b.rituals, sleepRun: b.sleepRun, rhythms };
  key()
    .then((k) => AsyncStorage.setItem(k, JSON.stringify({ bridge: b.rituals, sleepRun: b.sleepRun })))
    .catch(() => null);
  return memo;
}

/** At app start: the phone's part, so the tab's first visit has something to show at once. */
export function primeRituals() {
  if (!memo) localRituals().catch(() => null);
}
