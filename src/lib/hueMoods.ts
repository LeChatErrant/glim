import type { Planned } from './actions';
import { findGroup } from './actions';
import { mirekToHex, mirekToKelvin, xyToHex } from './hue/color';
import { recallScene, sceneRecallBody, type BridgeScene, type Snapshot } from './hue/client';
import { addMood, moodLightColor, planLights, type MoodLight } from './moods';
import { markColors } from './moodMarks';

/**
 * Moods "from the Hue app": the scenes stored on the bridge (made in the Hue app, e.g. "Base",
 * "Lumineux"), shown next to Glim's own moods. Applying one recalls the scene on the bridge, one
 * request for all its lights; "Keep as my mood" copies it light by light into a Glim mood.
 */

/** The scenes of a room or group, by name. */
export const hueMoodsFor = (s: Snapshot | null, groupId: string) => (s?.scenes ?? []).filter((x) => x.groupId === groupId).sort(byName);

const byName = (a: BridgeScene, b: BridgeScene) => a.name.localeCompare(b.name);

/** Every scene, by room or group (in the order of the Rooms tab), then by name. */
export function hueMoods(s: Snapshot | null): BridgeScene[] {
  if (!s?.scenes) return [];
  const order = [...s.rooms, ...(s.zones ?? [])].map((g) => g.id);
  const rank = (x: BridgeScene) => (order.includes(x.groupId) ? order.indexOf(x.groupId) : order.length);
  return [...s.scenes].sort((a, b) => rank(a) - rank(b) || byName(a, b));
}

/** The name of the room or group a scene belongs to. */
export const hueMoodPlace = (s: Snapshot | null, scene: BridgeScene) => (s && findGroup(s, scene.groupId)?.name) ?? 'Home';

/** The scene as Glim mood lights (its still look; a living one starts from it). */
export function sceneMoodLights(scene: BridgeScene): MoodLight[] {
  return scene.lights.map((l): MoodLight => {
    if (!l.on) return { lightId: l.lightId, on: false };
    if (l.effect) return { lightId: l.lightId, on: true, brightness: l.brightness, effect: l.effect };
    if (l.mirek) return { lightId: l.lightId, on: true, brightness: l.brightness, kelvin: Math.round(mirekToKelvin(l.mirek) / 50) * 50 };
    if (l.xy) return { lightId: l.lightId, on: true, brightness: l.brightness, hex: xyToHex(l.xy.x, l.xy.y) };
    return { lightId: l.lightId, on: true, brightness: l.brightness };
  });
}

/** A few colors to show for it: a living mood's palette, else its lights' colors. */
export function sceneColors(scene: BridgeScene): string[] {
  if (scene.palette.length) return [...new Set(scene.palette)];
  return [...new Set(sceneMoodLights(scene).map((m) => moodLightColor(m) ?? (m.on ? mirekToHex(370) : null)).filter((c): c is string => !!c))];
}

/** Its mark's colors: near shades merged, the biggest share first (`markColors`). */
export function sceneMarkColors(scene: BridgeScene): string[] {
  if (scene.palette.length) return markColors(scene.palette);
  return markColors(sceneMoodLights(scene).map((m) => moodLightColor(m) ?? (m.on ? mirekToHex(370) : null)));
}

/** The one request that applies it, for native taps (widgets, Quick Settings tile). */
export const sceneRequest = (scene: BridgeScene): [string, string] => [`scene/${scene.id}`, JSON.stringify(sceneRecallBody(scene))];

/** Applies a scene: the lights show its look at once, the bridge recalls it. */
export function planScene(s: Snapshot, scene: BridgeScene): Planned | null {
  return {
    next: {
      ...(planLights(s, sceneMoodLights(scene))?.next ?? s),
      // The bridge marks the recalled scene active, and the others of its room no longer.
      scenes: s.scenes?.map((x) =>
        x.id === scene.id ? { ...x, active: scene.living ? 'dynamic_palette' : 'static' } : x.groupId === scene.groupId ? { ...x, active: 'inactive' } : x,
      ),
    },
    send: () => recallScene(scene),
  };
}

/** Whether the lights show it now: the bridge says it's active, or (a still one) every light looks like it. */
export function sceneShowing(s: Snapshot, scene: BridgeScene, looksLike: (lights: MoodLight[]) => boolean): boolean {
  const now = s.scenes?.find((x) => x.id === scene.id) ?? scene;
  if (now.active !== 'inactive') return true;
  return !now.living && looksLike(sceneMoodLights(now));
}

/** Keeps a scene as a Glim mood of its room or group, light by light, so it can be edited. */
export const keepAsMood = (scene: BridgeScene) => addMood({ name: scene.name, targetId: scene.groupId || null, lights: sceneMoodLights(scene) });
