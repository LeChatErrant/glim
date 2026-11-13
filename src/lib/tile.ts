import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { HueHttp, type TileConfig } from '../../modules/hue-http';
import { moodButtons, type MoodItem, type SleepItem } from '../widgets/moodButtons';
import { getBridge } from './hue/bridge';
import { cachedSnapshot, type Snapshot } from './hue/client';
import { hueMoodPlace } from './hueMoods';
import { loadMap, type HomeMap } from './map/map';
import { loadMoods, moodRequests, type Mood } from './moods';
import { ensureSleepPool } from './rituals/sleepNow';
import { onSavedDataChange } from './savedData';

/**
 * The Android Quick Settings tile: what it controls (picked in Settings → Quick Settings tile),
 * and that target turned into ready-made bridge requests for native taps (GlimTile.kt in
 * modules/hue-http), written whenever the target, the moods, the map or the lights change.
 */
export type TileTarget =
  | { kind: 'home' }
  | { kind: 'room' | 'group'; id: string }
  | { kind: 'mood'; item: Extract<MoodItem, { kind: 'mood' | 'preset' | 'scene' }> }
  /** Starts a sleep fade on these rooms and groups (stops it while it runs). */
  | { kind: 'sleep'; item: SleepItem };

const key = async () => `tile:${(await getBridge())?.id ?? 'none'}`;

export async function loadTileTarget(): Promise<TileTarget> {
  try {
    return JSON.parse((await AsyncStorage.getItem(await key())) ?? 'null') ?? { kind: 'home' };
  } catch {
    return { kind: 'home' };
  }
}

export async function saveTileTarget(t: TileTarget) {
  await AsyncStorage.setItem(await key(), JSON.stringify(t));
  await syncTile();
}

// Turning on: no fade, like a switch. Turning off: no duration (one dims the light to ~0% on the way out).
const ON = { on: { on: true }, dynamics: { duration: 0 } };
const OFF = { on: { on: false } };

function lightsTile(kind: TileConfig['kind'], label: string, ids: string[], groupedLightId: string | null | undefined): TileConfig {
  const batch = (body: object) => JSON.stringify(groupedLightId ? [[`grouped_light/${groupedLightId}`, JSON.stringify(body)]] : ids.map((id) => [`light/${id}`, JSON.stringify(body)]));
  return { kind, icon: kind === 'home' ? 'home' : 'room', label, sub: '', lights: ids, on: batch(ON), off: batch(OFF) };
}

/** What the tile does for a target. A room, group or mood that's gone falls back to the whole home. */
export function tileConfig(t: TileTarget, s: Snapshot, moods: Mood[], map: HomeMap | null): TileConfig {
  if (t.kind === 'sleep') {
    const names = t.item.targets.map((id) => s.rooms.find((r) => r.id === id)?.name ?? s.zones?.find((z) => z.id === id)?.name).filter(Boolean);
    if (names.length) {
      const lights = [...new Set([...s.rooms, ...(s.zones ?? [])].filter((g) => t.item.targets.includes(g.id)).flatMap((g) => g.lightIds))];
      return {
        kind: 'sleep',
        icon: 'sleep',
        label: t.item.name,
        sub: `${t.item.fadeMin} min · ${names.join(', ')}`,
        lights,
        on: '[]',
        off: '[]',
        extra: JSON.stringify({ sleep: { targets: t.item.targets, fadeSec: t.item.fadeMin * 60 } }),
      };
    }
  }
  if (t.kind === 'mood') {
    const b = moodButtons([t.item], moods, s, map)[0];
    if (b?.lights?.length) {
      const known = new Set(s.lights.map((l) => l.id));
      const lit = b.lights.filter((l) => l.on && known.has(l.lightId));
      return {
        kind: 'mood',
        icon: 'mood',
        label: b.name,
        // A mood from the Hue app says where it is ("Salon"): its name alone is often in every room.
        sub: b.path ? 'Path' : b.scene ? sceneSub(s, b.scene) : 'Mood',
        lights: b.lights.map((l) => l.lightId),
        // A mood from the Hue app is one scene recall (GlimTile asks the bridge whether it's showing).
        on: JSON.stringify(b.request ? [b.request] : moodRequests(s, b.lights, b.opts)),
        // Tapped while it shows: the lights it turned on go off.
        off: JSON.stringify(lit.map((l) => [`light/${l.lightId}`, JSON.stringify(OFF)])),
        // A path that turns itself off: the tile sets its alarm when it lights it.
        extra: JSON.stringify(b.off ? { pathOff: b.off } : {}),
      };
    }
  }
  if (t.kind === 'room' || t.kind === 'group') {
    const g = (t.kind === 'room' ? s.rooms : (s.zones ?? [])).find((r) => r.id === t.id);
    if (g) return lightsTile(t.kind, g.name, g.lightIds, g.groupedLightId);
  }
  return lightsTile('home', 'All lights', s.lights.map((l) => l.id), s.homeGroupId);
}

const sceneSub = (s: Snapshot, id: string) => {
  const sc = s.scenes?.find((x) => x.id === id);
  return sc ? hueMoodPlace(s, sc) : 'Mood';
};

let last = '';

/** Writes what the tile does for native taps, if it changed. Safe anywhere (app, widget task). */
export async function syncTile(snapshot?: Snapshot | null) {
  if (Platform.OS !== 'android' || !HueHttp.setTileConfig) return;
  try {
    const s = snapshot ?? (await cachedSnapshot());
    if (!s) return;
    const [t, moods, map] = await Promise.all([loadTileTarget(), loadMoods(), loadMap()]);
    // A sleep fade: the bridge must have what the tap changes (made once).
    if (t.kind === 'sleep') await ensureSleepPool(s, t.item.targets).catch((e) => console.warn('Tile sleep fade', e));
    const c = tileConfig(t, s, moods, map);
    const json = JSON.stringify(c);
    if (json === last) return;
    await HueHttp.setTileConfig(c);
    last = json;
  } catch (e) {
    console.warn('Quick Settings tile', e);
  }
}

// A mood edited or the map changed (a path's lights follow it): the tile follows.
onSavedDataChange(() => {
  syncTile();
});
