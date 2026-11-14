import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { HueHttp } from '../../modules/hue-http';
import { hasTemperature, mirekFor, type Planned } from './actions';
import { getBridge } from './hue/bridge';
import { deleteScene } from './hue/behaviors';
import { hexToXy, mirekToHex, mirekToKelvin } from './hue/color';
import { EFFECTS, effectLabel, hasEffect } from './effects';
import { call, setLight, stateBody, type Light, type LightState, type Snapshot } from './hue/client';
import { findRoute, lightsAlongRoute } from './map/route';
import type { FloorPoint, HomeMap, MapLight } from './map/map';
import { glowRooms, spotWeights, sweepPositions } from './map/spread';
import { markColors, type MoodGlyph } from './moodMarks';
import { presetLights, type Palette } from './moodPresets';
import { colorName, kelvinName } from './palette';
import { savedDataChanged } from './savedData';
import { tintAt, tintHex, whiteFor, type Tint } from './tints';

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
export type PathRecipe = {
  from: string;
  to: string;
  brightness: number;
  tone: PathTone;
  others: 'leave' | 'off';
  /** Minutes after it's lit, the path's lights go off (if still as the path left them). None: stays on. */
  offAfter?: number;
};

/** "Turn off after" choices for a path, in minutes (0 = never). */
export const PATH_OFF_AFTER = [0, 5, 10, 15, 30];

/**
 * A path's auto-off, for native code (PathOff.kt): the lights it lights and how bright, keyed by
 * the mood. Null when the path stays on.
 */
export type PathOff = { key: string; min: number; lights: [string, number][] };

export function pathOffFor(s: Snapshot, mood: Mood, map: HomeMap | null): PathOff | null {
  if (!mood.path?.offAfter) return null;
  const lights = (pathLights(s, mood.path, map) ?? []).filter((m) => m.on).map((m): [string, number] => [m.lightId, m.brightness ?? 100]);
  return lights.length ? { key: mood.id, min: mood.path.offAfter, lights } : null;
}

/**
 * After a path is lit from the app: sets its auto-off (an exact alarm in native code, so it
 * happens with the phone locked), or drops one left from before when it now stays on.
 */
export function armPathOff(s: Snapshot, mood: Mood, map: HomeMap | null) {
  if (!mood.path || Platform.OS !== 'android' || !HueHttp.schedulePathOff) return;
  const off = pathOffFor(s, mood, map);
  const done = off ? HueHttp.schedulePathOff(off.key, Date.now() + off.min * 60_000, JSON.stringify(off.lights)) : HueHttp.cancelPathOff?.(mood.id);
  done?.catch((e) => console.warn('Path auto-off', e));
}

/** What happens to the lights a map-aware mood doesn't light: left as they are, or turned off. */
export type Others = 'leave' | 'off';

/**
 * A gradient sweep: 2 or 3 tints spread across the home (or some map rooms) along a direction,
 * the first at the tail of the arrow, the last at its head. `angle` in degrees, map coordinates.
 */
export type SweepRecipe = { kind: 'sweep'; tints: Tint[]; angle: number; rooms: string[] | null; brightness: number; others: Others };

/** A spotlight: lights within `radius` m of a point, brighter the closer they are (up to `brightness`). */
export type SpotRecipe = { kind: 'spot'; at: FloorPoint; radius: number; tint: Tint; brightness: number; others: Others };

/** A room glow: one tint per map room; lights take the tint of the room they stand in. */
export type GlowRecipe = { kind: 'glow'; rooms: { id: string; tint: Tint }[]; brightness: number; others: Others };

/** The map-aware moods other than paths: worked out from the map at each apply, like paths. */
export type MapRecipe = SweepRecipe | SpotRecipe | GlowRecipe;

/**
 * Living: the colors slowly drift across the lights, played by the bridge (a Hue dynamic scene,
 * one per room or group the mood covers, made when the mood is saved). `speed` 0–1.
 */
export type Living = { speed: number; scenes?: { group: string; scene: string }[] };

/**
 * A mood: a look for some lights, light by light (one red, one blue...). Our own data, not a
 * bridge scene. Saved from a room or a group, and shown there; `targetId` is that room or group
 * (null: the whole home). A palette mood has a `palette` (colors spread over the target's lights
 * at each apply), a map-aware mood a `path` (night path) or a `recipe` (sweep, spotlight, room
 * glow); for these `lights` stays empty. `transition` is the fade in ms (absent: Hue's own).
 */
export type Mood = {
  id: string;
  name: string;
  targetId: string | null;
  lights: MoodLight[];
  createdAt: number;
  palette?: Palette;
  path?: PathRecipe;
  recipe?: MapRecipe;
  transition?: number;
  living?: Living;
  /** Its mark's glyph: picked in the editor, null for colors only, absent to suggest one from the name. */
  glyph?: MoodGlyph | null;
};

/** How a mood is played beyond each light's look: its fade, and its living scenes. */
export type MoodOptions = Pick<Mood, 'transition' | 'living'>;

/** Paths, sweeps, spotlights and room glows: moods worked out from the map. */
export const isMapAware = (m: Mood) => !!(m.path || m.recipe);

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
  savedDataChanged();
  return list;
}

export async function addMood(m: Omit<Mood, 'id' | 'createdAt'>) {
  return save([...(await loadMoods()), { ...m, id: `mood-${Date.now()}`, createdAt: Date.now() }]);
}

export async function updateMood(id: string, change: Partial<Omit<Mood, 'id'>>) {
  return save((await loadMoods()).map((m) => (m.id === id ? { ...m, ...change } : m)));
}

export async function deleteMood(id: string) {
  const list = await loadMoods();
  for (const sc of list.find((m) => m.id === id)?.living?.scenes ?? []) await deleteScene(sc.scene).catch(() => null);
  return save(list.filter((m) => m.id !== id));
}

/** The lights of a room or a group, or every light (null: the whole home). */
export function targetLights(s: Snapshot, targetId: string | null): Light[] {
  if (targetId === null) return s.lights;
  const g = s.rooms.find((r) => r.id === targetId) ?? s.zones?.find((z) => z.id === targetId);
  return g ? s.lights.filter((l) => g.lightIds.includes(l.id)) : [];
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

/**
 * A light set to a tint, as far as it can: a color light takes the color (or the white), a
 * white light the white (or the white closest to the color), a plain one just the brightness.
 */
export function tintLight(l: Light, tint: Tint, brightness: number): MoodLight {
  const b = Math.max(1, Math.min(100, Math.round(brightness)));
  if (l.kind === 'color') return tint.hex ? { lightId: l.id, on: true, brightness: b, hex: tint.hex } : { lightId: l.id, on: true, brightness: b, kelvin: tint.kelvin ?? 2700 };
  if (hasTemperature(l)) return { lightId: l.id, on: true, brightness: b, kelvin: tint.kelvin ?? whiteFor(tint.hex ?? '#FFB868') };
  return { lightId: l.id, on: true, brightness: b };
}

/**
 * A sweep, spotlight or room glow's lights for today's map and lights, or null without a map.
 * Smart plugs are never turned on (a plug has no color or brightness); they go off with the
 * other lights when the mood turns the others off.
 */
export function recipeLights(s: Snapshot, recipe: MapRecipe, map: HomeMap | null): MoodLight[] | null {
  if (!map) return null;
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  const usable = (m: MapLight) => {
    const l = byId.get(m.lightId);
    return !!l && l.reachable && l.kind !== 'onoff';
  };
  let on: MoodLight[];
  if (recipe.kind === 'sweep') {
    const at = sweepPositions(map, recipe.angle, recipe.rooms, usable);
    on = [...at].map(([id, t]) => tintLight(byId.get(id)!, tintAt(recipe.tints, t), recipe.brightness));
  } else if (recipe.kind === 'spot') {
    const w = spotWeights(map, recipe.at, recipe.radius, usable);
    // Lights at the very edge would come on at 1%: below 2% they're left out (off with the others).
    on = [...w].filter(([, k]) => recipe.brightness * k >= 2).map(([id, k]) => tintLight(byId.get(id)!, recipe.tint, recipe.brightness * k));
  } else {
    const tints = new Map(recipe.rooms.map((r) => [r.id, r.tint]));
    const rooms = glowRooms(map, new Set(tints.keys()), usable);
    on = [...rooms].map(([id, room]) => tintLight(byId.get(id)!, tints.get(room)!, recipe.brightness));
  }
  const lit = new Set(on.map((m) => m.lightId));
  const off = recipe.others === 'off' ? s.lights.filter((l) => l.reachable && !lit.has(l.id)).map((l): MoodLight => ({ lightId: l.id, on: false })) : [];
  return [...on, ...off];
}

/** The colors a sweep, spotlight or room glow shows, for dots and previews (no lights needed). */
export function recipeColors(recipe: MapRecipe): string[] {
  if (recipe.kind === 'sweep') return recipe.tints.map(tintHex);
  if (recipe.kind === 'spot') return [tintHex(recipe.tint)];
  return [...new Set(recipe.rooms.map((r) => tintHex(r.tint)))];
}

/** The lights a mood sets, light by light: its saved lights, or a path or recipe worked out from the map. */
export function moodLights(s: Snapshot, mood: Mood, map: HomeMap | null): MoodLight[] {
  if (mood.path) return pathLights(s, mood.path, map) ?? [];
  if (mood.recipe) return recipeLights(s, mood.recipe, map) ?? [];
  if (mood.palette) return presetLights(mood.palette, targetLights(s, mood.targetId), map);
  return mood.lights;
}

/**
 * The colors of a mood's mark: a palette's colors in order, a sweep's, spotlight's or room glow's,
 * a path's tone; else its lit lights' colors with near shades merged, the biggest share first.
 * `lights`: the mood as worked out today, when a palette or recipe is already worked out.
 */
export function moodColors(mood: Mood, lights: MoodLight[] = mood.lights): string[] {
  if (mood.path) return [(PATH_TONES.find((t) => t.id === mood.path!.tone) ?? PATH_TONES[0]).hex];
  if (mood.recipe) return markColors(recipeColors(mood.recipe));
  if (mood.palette) return markColors(mood.palette.tones.map(tintHex));
  return markColors(lights.map(moodLightColor));
}

/** Puts every light of the mood back as it was saved. Lights gone from the bridge are skipped. */
export function planMood(s: Snapshot, mood: Mood, map: HomeMap | null = null): Planned | null {
  const plan = planLights(s, moodLights(s, mood, map), mood);
  if (!plan || !mood.path) return plan;
  // A path that turns itself off: its alarm is set once the lights are sent.
  return { ...plan, send: () => plan.send().finally(() => armPathOff(s, mood, map)) };
}

/** What to send a light to make it look like a mood light, given what it can do; `transition` in ms. */
export function moodLightState(m: MoodLight, l: Light, transition?: number): LightState {
  if (!m.on) return { on: false };
  const brightness = l.brightness !== null ? m.brightness : undefined;
  const duration = transition;
  if (m.effect && l.effects?.includes(m.effect)) return { on: true, brightness, effect: m.effect, duration };
  // A mood without an effect stops one that's running.
  const stop = hasEffect(l.effect) ? { effect: 'no_effect' } : {};
  if (m.hex && l.kind === 'color') return { on: true, brightness, xy: hexToXy(m.hex), duration, ...stop };
  if (m.kelvin && hasTemperature(l)) return { on: true, brightness, mirek: mirekFor(l, m.kelvin), duration, ...stop };
  return { on: true, brightness, duration, ...stop };
}

/**
 * A living mood's bridge scenes: the recall of each (the bridge then plays the colors across its
 * room or group), and the lights it plays, which then get no request of their own. Lights the
 * mood turns off, and lights outside those rooms and groups, are still set one by one.
 */
function livingPart(s: Snapshot, lights: MoodLight[], opts?: MoodOptions) {
  const scenes = opts?.living?.scenes ?? [];
  const covered = new Set<string>();
  if (!scenes.length) return { recalls: [] as [string, object][], covered };
  const groups = [...s.rooms, ...(s.zones ?? [])];
  const inScenes = new Set(scenes.flatMap((sc) => groups.find((g) => g.id === sc.group)?.lightIds ?? []));
  // A light playing a Hue effect (candle...) keeps its own request: the scene can't hold an effect.
  for (const m of lights) if (m.on && !m.effect && inScenes.has(m.lightId)) covered.add(m.lightId);
  const recall = { action: 'dynamic_palette', ...(opts?.transition !== undefined ? { duration: opts.transition } : {}) };
  return { recalls: scenes.map((sc): [string, object] => [`scene/${sc.scene}`, { recall }]), covered };
}

/** A mood as ready-made bridge requests, [path, body] each (widget and tile taps, sent from native code). */
export function moodRequests(s: Snapshot, lights: MoodLight[], opts?: MoodOptions): [string, string][] {
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  const { recalls, covered } = livingPart(s, lights, opts);
  const each = lights
    .filter((m) => byId.has(m.lightId) && !covered.has(m.lightId))
    .map((m): [string, string] => [`light/${m.lightId}`, JSON.stringify(stateBody(moodLightState(m, byId.get(m.lightId)!, opts?.transition)))]);
  return [...recalls.map(([p, b]): [string, string] => [p, JSON.stringify(b)]), ...each];
}

/** Sets each light as listed (with the mood's fade and living scenes, if given). Lights gone from the bridge are skipped. */
export function planLights(s: Snapshot, lights: MoodLight[], opts?: MoodOptions): Planned | null {
  const byId = new Map(s.lights.map((l) => [l.id, l]));
  const steps = lights.filter((m) => byId.has(m.lightId));
  if (!steps.length) return null;
  const { recalls, covered } = livingPart(s, steps, opts);
  const state = (m: MoodLight, l: Light) => moodLightState(m, l, opts?.transition);
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
    // Living scenes first (they set every light of their room), then one request per other light:
    // the bridge takes about 10 a second, plenty for a room.
    send: async () => {
      await Promise.all(recalls.map(([path, body]) => call(path, 'PUT', body)));
      return Promise.all(steps.filter((m) => !covered.has(m.lightId)).map((m) => setLight(m.lightId, state(m, byId.get(m.lightId)!))));
    },
  };
}
