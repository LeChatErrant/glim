import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasTemperature, mirekFor } from '../lib/actions';
import { gamutHex, mirekToHex } from '../lib/hue/color';
import type { Snapshot } from '../lib/hue/client';
import type { HomeMap } from '../lib/map/map';
import { PRESETS, presetLights } from '../lib/moodPresets';
import { moodLightColor, moodLights, PATH_TONES, recipeColors, type Mood, type MoodLight } from '../lib/moods';
import { near } from '../lib/palette';

/** One button of a Moods widget: a saved mood or path, a preset (whole home), or "All off". */
export type MoodItem = { kind: 'mood'; id: string } | { kind: 'preset'; id: string } | { kind: 'off' };

/** Per-widget options of the Moods widget (its configuration screen). Absent = the defaults. */
export type MoodsWidgetSettings = { items?: MoodItem[] };

const key = (widgetId: number) => `widget-moods:${widgetId}`;

export async function loadMoodsWidgetSettings(widgetId: number): Promise<MoodsWidgetSettings> {
  try {
    return JSON.parse((await AsyncStorage.getItem(key(widgetId))) ?? '{}');
  } catch {
    return {};
  }
}

export const saveMoodsWidgetSettings = (widgetId: number, s: MoodsWidgetSettings) => AsyncStorage.setItem(key(widgetId), JSON.stringify(s));
export const forgetMoodsWidgetSettings = (widgetId: number) => AsyncStorage.removeItem(key(widgetId));

export const MAX_ITEMS = 8;
const DEFAULT_PRESETS = ['relax', 'bright', 'nightlight', 'movie'];

/** Until the user picks: their own moods and paths first, then a few presets, and "All off" last. */
export function defaultItems(moods: Mood[]): MoodItem[] {
  const mine: MoodItem[] = moods.map((m) => ({ kind: 'mood', id: m.id }));
  const presets: MoodItem[] = DEFAULT_PRESETS.map((id) => ({ kind: 'preset', id }));
  return [...[...mine, ...presets].slice(0, MAX_ITEMS - 1), { kind: 'off' }];
}

export const itemKey = (i: MoodItem) => (i.kind === 'off' ? 'off' : `${i.kind}:${i.id}`);

/** A button as drawn: its name, a few dots of its colors, and the lights it sets (null = all off). */
export type MoodButton = { key: string; name: string; dots: string[]; lights: MoodLight[] | null; path: boolean };

/** The widget's buttons, skipping moods that were deleted since. */
export function moodButtons(items: MoodItem[], moods: Mood[], s: Snapshot, map: HomeMap | null): MoodButton[] {
  return items.flatMap((i): MoodButton[] => {
    if (i.kind === 'off') return [{ key: 'off', name: 'All off', dots: [], lights: null, path: false }];
    if (i.kind === 'preset') {
      const p = PRESETS.find((x) => x.id === i.id);
      if (!p) return [];
      const dots = p.tones.map((t) => t.hex ?? mirekToHex(1_000_000 / (t.kelvin ?? 2700)));
      return [{ key: itemKey(i), name: p.name, dots, lights: presetLights(p, s.lights, map), path: false }];
    }
    const m = moods.find((x) => x.id === i.id);
    if (!m) return [];
    const lights = moodLights(s, m, map);
    if (m.path) {
      const tint = (PATH_TONES.find((t) => t.id === m.path!.tone) ?? PATH_TONES[0]).hex;
      return [{ key: itemKey(i), name: m.name, dots: [tint, tint, tint], lights, path: true }];
    }
    // A sweep shows its colors in order, a spotlight its color, a room glow one dot per room color.
    if (m.recipe) return [{ key: itemKey(i), name: m.name, dots: recipeColors(m.recipe), lights, path: false }];
    const dots = [...new Set(lights.map((l) => moodLightColor(l)).filter((c): c is string => !!c))];
    return [{ key: itemKey(i), name: m.name, dots, lights, path: false }];
  });
}

/**
 * Whether the lights look like this button right now (its dot turns champagne on the widget):
 * every light it sets is on or off as it says, at about its brightness, color or white.
 */
export function isShowing(s: Snapshot, b: MoodButton): boolean {
  const reachable = s.lights.filter((l) => l.reachable);
  if (!b.lights) return reachable.length > 0 && reachable.every((l) => !l.on);
  const byId = new Map(reachable.map((l) => [l.id, l]));
  const set = b.lights.filter((m) => byId.has(m.lightId));
  if (!set.length) return false;
  return set.every((m) => {
    const l = byId.get(m.lightId)!;
    if (l.on !== m.on) return false;
    if (!m.on) return true;
    if (m.brightness !== undefined && l.brightness !== null && Math.abs(l.brightness - m.brightness) > 4) return false;
    if (m.effect && l.effects?.includes(m.effect)) return l.effect === m.effect;
    // Compared as the bridge reads it back: clamped to the light's gamut (a pure red comes back orange-red).
    if (m.hex && l.kind === 'color') return !l.mirek && near(l.color, gamutHex(m.hex));
    // A white: the light must be in white mode (a color light showing a color isn't), near that white.
    if (m.kelvin && hasTemperature(l)) return !!l.mirek && Math.abs(l.mirek - mirekFor(l, m.kelvin)) <= 12;
    return true;
  });
}
