import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasTemperature, mirekFor } from '../lib/actions';
import { readbackHexes } from '../lib/hue/color';
import type { Snapshot } from '../lib/hue/client';
import type { HomeMap } from '../lib/map/map';
import { sceneMarkColors, sceneMoodLights, sceneRequest, sceneShowing } from '../lib/hueMoods';
import { markColors, moodGlyph, suggestGlyph, type MoodGlyph } from '../lib/moodMarks';
import { PRESETS, presetLights } from '../lib/moodPresets';
import { moodColors, moodLights, PATH_TONES, pathOffFor, type Mood, type MoodLight, type MoodOptions, type PathOff } from '../lib/moods';
import { tintHex } from '../lib/tints';
import { near } from '../lib/palette';

/**
 * One button of a Moods widget: a saved mood or path, a preset (whole home), a mood from the Hue
 * app (bridge scene), "All off", or a sleep fade now (on these rooms and groups, as a sleep fade
 * ritual of the Rituals tab).
 */
export type MoodItem = { kind: 'mood'; id: string } | { kind: 'preset'; id: string } | { kind: 'scene'; id: string } | { kind: 'off' } | SleepItem;
export type SleepItem = { kind: 'sleep'; name: string; targets: string[]; fadeMin: number };

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

/**
 * The sleep fades a widget button or the tile can start: one per sleep fade ritual (its rooms and
 * length), else a 20 min one on the bedroom (or the first room), like "Start now · 20 min".
 */
export function sleepItems(s: Snapshot, rituals: { kind: string; name: string; targets: string[]; fadeMin: number }[]): SleepItem[] {
  const items: SleepItem[] = rituals.filter((r) => r.kind === 'sleep' && r.targets.length).map((r) => ({ kind: 'sleep', name: r.name, targets: r.targets, fadeMin: r.fadeMin }));
  if (items.length) return items;
  const rooms = s.rooms.filter((r) => r.lightIds.length);
  const room = rooms.find((r) => r.archetype === 'bedroom') ?? rooms[0];
  return room ? [{ kind: 'sleep', name: 'Sleep fade', targets: [room.id], fadeMin: 20 }] : [];
}

export const MAX_ITEMS = 8;
const DEFAULT_PRESETS = ['relax', 'bright', 'nightlight', 'movie'];

/** Until the user picks: their own moods and paths first, then a few presets, and "All off" last. */
export function defaultItems(moods: Mood[]): MoodItem[] {
  const mine: MoodItem[] = moods.map((m) => ({ kind: 'mood', id: m.id }));
  const presets: MoodItem[] = DEFAULT_PRESETS.map((id) => ({ kind: 'preset', id }));
  return [...[...mine, ...presets].slice(0, MAX_ITEMS - 1), { kind: 'off' }];
}

export const itemKey = (i: MoodItem) => (i.kind === 'off' ? 'off' : i.kind === 'sleep' ? `sleep:${i.targets.join('+')}:${i.fadeMin}` : `${i.kind}:${i.id}`);

/**
 * A button as drawn: its name, a few dots of its colors, and the lights it sets (null = all off),
 * with the mood's fade and living scenes (`opts`, for its requests). A mood from the Hue app has
 * `scene` (its id) and `request`: one scene recall instead of a request per light.
 * `off`: a path's auto-off. `sleep`: a sleep fade button (no lights; native code starts it).
 */
export type MoodButton = {
  key: string;
  name: string;
  dots: string[];
  /** The mark's glyph (null: colors only). */
  glyph?: MoodGlyph | null;
  lights: MoodLight[] | null;
  path: boolean;
  opts?: MoodOptions;
  scene?: string;
  request?: [string, string];
  off?: PathOff | null;
  sleep?: { targets: string[]; fadeMin: number };
};

/** The widget's buttons, skipping moods that were deleted since. */
export function moodButtons(items: MoodItem[], moods: Mood[], s: Snapshot, map: HomeMap | null): MoodButton[] {
  return items.flatMap((i): MoodButton[] => {
    if (i.kind === 'off') return [{ key: 'off', name: 'All off', dots: [], lights: null, path: false }];
    if (i.kind === 'scene') {
      const sc = s.scenes?.find((x) => x.id === i.id);
      if (!sc) return [];
      return [{ key: itemKey(i), name: sc.name, dots: sceneMarkColors(sc), glyph: suggestGlyph(sc.name), lights: sceneMoodLights(sc), path: false, scene: sc.id, request: sceneRequest(sc) }];
    }
    if (i.kind === 'sleep') return [{ key: itemKey(i), name: i.name, dots: [], lights: [], path: false, sleep: { targets: i.targets, fadeMin: i.fadeMin } }];
    if (i.kind === 'preset') {
      const p = PRESETS.find((x) => x.id === i.id);
      if (!p) return [];
      return [{ key: itemKey(i), name: p.name, dots: markColors(p.tones.map(tintHex)), glyph: suggestGlyph(p.name), lights: presetLights(p, s.lights, map), path: false }];
    }
    const m = moods.find((x) => x.id === i.id);
    if (!m) return [];
    const lights = moodLights(s, m, map);
    const opts: MoodOptions = { transition: m.transition, living: m.living };
    if (m.path) {
      const tint = (PATH_TONES.find((t) => t.id === m.path!.tone) ?? PATH_TONES[0]).hex;
      return [{ key: itemKey(i), name: m.name, dots: [tint, tint, tint], lights, path: true, opts, off: pathOffFor(s, m, map) }];
    }
    // Its mark: a palette's or recipe's colors, else its lights' colors (near shades merged).
    return [{ key: itemKey(i), name: m.name, dots: moodColors(m, lights), glyph: moodGlyph(m), lights, path: false, opts }];
  });
}

/**
 * Whether the lights look like this button right now (its dot turns champagne on the widget):
 * every light it sets is on or off as it says, at about its brightness, color or white. A sleep
 * fade button: while a sleep fade runs on its rooms (`fading`: the rooms and groups fading now).
 */
export function isShowing(s: Snapshot, b: MoodButton, fading: string[] | null = null): boolean {
  if (b.sleep) return !!fading && b.sleep.targets.some((t) => fading.includes(t));
  const reachable = s.lights.filter((l) => l.reachable);
  if (!b.lights) return reachable.length > 0 && reachable.every((l) => !l.on);
  const scene = b.scene && s.scenes?.find((x) => x.id === b.scene);
  if (scene) return sceneShowing(s, scene, (lights) => looksLike(s, lights));
  // A living mood's colors and levels drift: its lights are on and off as it says, and the
  // bridge reports its colored lights playing (Hue's dynamic palette).
  if (b.opts?.living?.scenes?.length) {
    const playing = b.lights.some((m) => m.on && m.hex && s.lights.find((l) => l.id === m.lightId)?.living);
    return playing && looksLike(s, b.lights.map((m) => ({ lightId: m.lightId, on: m.on })));
  }
  return looksLike(s, b.lights);
}

/** Whether every reachable light listed is on or off as it says, at about its brightness, color or white. */
export function looksLike(s: Snapshot, lights: MoodLight[]): boolean {
  const byId = new Map(s.lights.filter((l) => l.reachable).map((l) => [l.id, l]));
  const set = lights.filter((m) => byId.has(m.lightId));
  if (!set.length) return false;
  return set.every((m) => {
    const l = byId.get(m.lightId)!;
    if (l.on !== m.on) return false;
    if (!m.on) return true;
    if (m.brightness !== undefined && l.brightness !== null && Math.abs(l.brightness - m.brightness) > 4) return false;
    if (m.effect && l.effects?.includes(m.effect)) return l.effect === m.effect;
    // Compared as the bridge can read it back: as sent, or clamped to the gamut (a pure red comes back orange-red).
    if (m.hex && l.kind === 'color') return !l.mirek && readbackHexes(m.hex).some((h) => near(l.color, h));
    // A white: the light must be in white mode (a color light showing a color isn't), near that white.
    if (m.kelvin && hasTemperature(l)) return !!l.mirek && Math.abs(l.mirek - mirekFor(l, m.kelvin)) <= 12;
    return true;
  });
}
