import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasTemperature, mirekFor, type Planned } from './actions';
import { getBridge } from './hue/bridge';
import { hexToXy, mirekToHex, mirekToKelvin } from './hue/color';
import { setLight, type Light, type Snapshot } from './hue/client';
import { colorName, kelvinName } from './palette';

/** How one light looks in a mood. Off lights stay off; color lights keep a color or a white. */
export type MoodLight = { lightId: string; on: boolean; brightness?: number; hex?: string; kelvin?: number };

/**
 * A mood: a look for some lights, light by light (one red, one blue...). Our own data, not a
 * bridge scene. Saved from a room or a group, and shown there; `targetId` is that room or group.
 */
export type Mood = { id: string; name: string; targetId: string | null; lights: MoodLight[]; createdAt: number };

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
      if (l.mirek) return { lightId: l.id, on: true, brightness, kelvin: Math.round(mirekToKelvin(l.mirek) / 50) * 50 };
      if (l.kind === 'color') return { lightId: l.id, on: true, brightness, hex: l.color };
      return { lightId: l.id, on: true, brightness };
    });
}

/** The color a mood light shows (for swatches), or null when it's off or plain. */
export const moodLightColor = (m: MoodLight) => (!m.on ? null : (m.hex ?? (m.kelvin ? mirekToHex(1_000_000 / m.kelvin) : null)));

/** A first name for a new mood from its colors: "Red & blue", "Warm white", "All off". */
export function suggestName(lights: MoodLight[]) {
  const on = lights.filter((l) => l.on);
  if (!on.length) return 'All off';
  const names = [...new Set(on.map((l) => (l.hex ? colorName(l.hex) : l.kelvin ? kelvinName(l.kelvin) : 'On')))];
  if (names.length === 1) return names[0];
  return `${names[0]} & ${names[1].toLowerCase()}${names.length > 2 ? ' +' : ''}`;
}

/** Puts every light of the mood back as it was saved. Lights gone from the bridge are skipped. */
export function planMood(s: Snapshot, mood: Mood): Planned | null {
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  const steps = mood.lights.filter((m) => byId.has(m.lightId));
  if (!steps.length) return null;
  const state = (m: MoodLight, l: Light) => {
    if (!m.on) return { on: false };
    const brightness = l.brightness !== null ? m.brightness : undefined;
    if (m.hex && l.kind === 'color') return { on: true, brightness, xy: hexToXy(m.hex) };
    if (m.kelvin && hasTemperature(l)) return { on: true, brightness, mirek: mirekFor(l, m.kelvin) };
    return { on: true, brightness };
  };
  return {
    next: {
      ...s,
      lights: s.lights.map((l) => {
        const m = steps.find((x) => x.lightId === l.id);
        if (!m) return l;
        const st = state(m, l);
        const color = st.xy ? m.hex! : st.mirek ? mirekToHex(st.mirek) : l.color;
        return { ...l, on: st.on, brightness: st.brightness ?? l.brightness, color, mirek: st.mirek ?? (st.xy ? null : l.mirek) };
      }),
    },
    // One request per light: the bridge takes about 10 a second, plenty for a room.
    send: () => Promise.all(steps.map((m) => setLight(m.lightId, state(m, byId.get(m.lightId)!)))),
  };
}
