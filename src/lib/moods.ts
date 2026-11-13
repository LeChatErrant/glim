import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasTemperature, mirekFor, type Planned } from './actions';
import { getBridge } from './hue/bridge';
import { hexToXy, mirekToHex, mirekToKelvin } from './hue/color';
import { EFFECTS, effectLabel, hasEffect } from './effects';
import { setLight, stateBody, type Light, type LightState, type Snapshot } from './hue/client';
import { findRoute, lightsAlongRoute } from './map/route';
import type { HomeMap } from './map/map';
import { colorName, kelvinName } from './palette';

/** How one light looks in a mood. Off lights stay off; color lights keep a color or a white. */
export type MoodLight = { lightId: string; on: boolean; brightness?: number; hex?: string; kelvin?: number; effect?: string };

/** The light of a path: warm white, amber (dimmer to the eye) or red (keeps night vision). */
export type PathTone = 'warm' | 'amber' | 'red';
export const PATH_TONES: { id: PathTone; label: string; hex: string; kelvin: number }[] = [
  { id: 'warm', label: 'Warm white', hex: mirekToHex(1_000_000 / 2200), kelvin: 2200 },
  { id: 'amber', label: 'Amber', hex: '#FF8A1E', kelvin: 2200 },
  { id: 'red', label: 'Red', hex: '#FF2A0A', kelvin: 2200 },
];

/**
 * A path (map-aware mood): a dim trail from one room to another, worked out from the map each
 * time it's applied, so it follows changes to the map and to the lights. Rooms are map room ids.
 */
export type PathRecipe = { from: string; to: string; brightness: number; tone: PathTone; others: 'leave' | 'off' };

/**
 * A mood: a look for some lights, light by light (one red, one blue...). Our own data, not a
 * bridge scene. Saved from a room or a group, and shown there; `targetId` is that room or group.
 * A path mood has a `path` instead of fixed lights (`lights` stays empty).
 */
export type Mood = { id: string; name: string; targetId: string | null; lights: MoodLight[]; createdAt: number; path?: PathRecipe };

const key = async () => `moods:${(await getBridge())?.id ?? 'none'}`;

export async function loadMoods(): Promise<Mood[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(await key())) ?? '[]');
  } catch {
    return [];
  }
}

async function save(list: Mood[]) {
  await AsyncStorage.setItem(await key(), JSON.stringify(list));
  return list;
}

export async function addMood(m: Omit<Mood, 'id' | 'createdAt'>) {
  return save([...(await loadMoods()), { ...m, id: `mood-${Date.now()}`, createdAt: Date.now() }]);
}

export async function updateMood(id: string, change: Partial<Omit<Mood, 'id'>>) {
  return save((await loadMoods()).map((m) => (m.id === id ? { ...m, ...change } : m)));
}

export async function deleteMood(id: string) {
  return save((await loadMoods()).filter((m) => m.id !== id));
}

/** What the lights look like now, as mood lights. Unreachable lights are left out (their state is stale). */
export function captureLights(lights: Light[]): MoodLight[] {
  return lights
    .filter((l) => l.reachable)
    .map((l) => {
      if (!l.on) return { lightId: l.id, on: false };
      const brightness = l.brightness ?? undefined;
      const effect = hasEffect(l.effect) ? l.effect : undefined;
      if (effect) return { lightId: l.id, on: true, brightness, effect };
      if (l.mirek) return { lightId: l.id, on: true, brightness, kelvin: Math.round(mirekToKelvin(l.mirek) / 50) * 50 };
      if (l.kind === 'color') return { lightId: l.id, on: true, brightness, hex: l.color };
      return { lightId: l.id, on: true, brightness };
    });
}

/** The color a mood light shows (for swatches), or null when it's off or plain. */
export const moodLightColor = (m: MoodLight) =>
  !m.on ? null : (m.hex ?? (m.kelvin ? mirekToHex(1_000_000 / m.kelvin) : m.effect ? (EFFECTS.find((e) => e.id === m.effect)?.swatch[0] ?? null) : null));

/** A first name for a new mood from its colors: "Red & blue", "Warm white", "All off". */
export function suggestName(lights: MoodLight[]) {
  const on = lights.filter((l) => l.on);
  if (!on.length) return 'All off';
  const names = [...new Set(on.map((l) => (l.effect ? (effectLabel(l.effect) ?? 'Effect') : l.hex ? colorName(l.hex) : l.kelvin ? kelvinName(l.kelvin) : 'On')))];
  if (names.length === 1) return names[0];
  return `${names[0]} & ${names[1].toLowerCase()}${names.length > 2 ? ' +' : ''}`;
}

/** A path's lights for today's map and lights, or null when the map lacks one of its rooms. */
export function pathLights(s: Snapshot, path: PathRecipe, map: HomeMap | null): MoodLight[] | null {
  if (!map) return null;
  const route = findRoute(map, path.from, path.to);
  if (!route) return null;
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  // Smart plugs can't be dimmed: a path never turns one on.
  const usable = (id: string) => {
    const l = byId.get(id);
    return !!l && l.reachable && l.kind !== 'onoff';
  };
  const lit = new Set(lightsAlongRoute(map, route, (m) => usable(m.lightId)));
  const tone = PATH_TONES.find((t) => t.id === path.tone) ?? PATH_TONES[0];
  const on = [...lit].map((id): MoodLight => {
    const l = byId.get(id)!;
    const colored = path.tone !== 'warm' && l.kind === 'color';
    return { lightId: id, on: true, brightness: path.brightness, hex: colored ? tone.hex : undefined, kelvin: colored ? undefined : tone.kelvin };
  });
  const off = path.others === 'off' ? s.lights.filter((l) => l.reachable && !lit.has(l.id)).map((l): MoodLight => ({ lightId: l.id, on: false })) : [];
  return [...on, ...off];
}

/** The lights a mood sets, light by light: its saved lights, or a path worked out from the map. */
export function moodLights(s: Snapshot, mood: Mood, map: HomeMap | null): MoodLight[] {
  return mood.path ? (pathLights(s, mood.path, map) ?? []) : mood.lights;
}

/** Puts every light of the mood back as it was saved. Lights gone from the bridge are skipped. */
export function planMood(s: Snapshot, mood: Mood, map: HomeMap | null = null): Planned | null {
  return planLights(s, moodLights(s, mood, map));
}

/** What to send a light to make it look like a mood light, given what it can do. */
export function moodLightState(m: MoodLight, l: Light): LightState {
  if (!m.on) return { on: false };
  const brightness = l.brightness !== null ? m.brightness : undefined;
  if (m.effect && l.effects?.includes(m.effect)) return { on: true, brightness, effect: m.effect };
  // A mood without an effect stops one that's running.
  const stop = hasEffect(l.effect) ? { effect: 'no_effect' } : {};
  if (m.hex && l.kind === 'color') return { on: true, brightness, xy: hexToXy(m.hex), ...stop };
  if (m.kelvin && hasTemperature(l)) return { on: true, brightness, mirek: mirekFor(l, m.kelvin), ...stop };
  return { on: true, brightness, ...stop };
}

/** A mood as ready-made bridge requests, [path, body] per light (widget taps, sent from native code). */
export function moodRequests(s: Snapshot, lights: MoodLight[]): [string, string][] {
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  return lights.filter((m) => byId.has(m.lightId)).map((m) => [`light/${m.lightId}`, JSON.stringify(stateBody(moodLightState(m, byId.get(m.lightId)!)))]);
}

/** Sets each light as listed. Lights gone from the bridge are skipped. */
export function planLights(s: Snapshot, lights: MoodLight[]): Planned | null {
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  const steps = lights.filter((m) => byId.has(m.lightId));
  if (!steps.length) return null;
  const state = moodLightState;
  return {
    next: {
      ...s,
      lights: s.lights.map((l) => {
        const m = steps.find((x) => x.lightId === l.id);
        if (!m) return l;
        const st = state(m, l);
        const color = st.xy ? m.hex! : st.mirek ? mirekToHex(st.mirek) : l.color;
        return { ...l, on: !!st.on, brightness: st.brightness ?? l.brightness, color, mirek: st.mirek ?? (st.xy ? null : l.mirek), effect: st.effect };
      }),
    },
    // One request per light: the bridge takes about 10 a second, plenty for a room.
    send: () => Promise.all(steps.map((m) => setLight(m.lightId, state(m, byId.get(m.lightId)!)))),
  };
}
