import { hasTemperature } from './actions';
import type { Light } from './hue/client';
import type { HomeMap } from './map/map';
import type { MoodLight } from './moods';

/** One color of a preset: a color (hex) or a white (kelvin), optionally at its own brightness. */
export type Tone = { hex?: string; kelvin?: number; brightness?: number };

/**
 * A preset mood: a palette, spread over whichever lights it's applied to (a room, a group, the
 * whole home). Presets ship with the app; keeping one as "my mood" saves it light by light, and
 * from there it can be changed like any mood.
 */
export type Preset = {
  id: string;
  name: string;
  category: PresetCategory;
  tones: Tone[];
  brightness: number;
  /** Lights that can play it run this Hue effect instead (candle, fire...). */
  effect?: string;
  /** The white given to white-only lights when the tones are colors. */
  white?: number;
};

export type PresetCategory = 'Everyday' | 'Focus' | 'Evening' | 'Color';
export const PRESET_CATEGORIES: PresetCategory[] = ['Everyday', 'Focus', 'Evening', 'Color'];

export const PRESETS: Preset[] = [
  { id: 'bright', name: 'Bright', category: 'Everyday', tones: [{ kelvin: 4000 }], brightness: 100 },
  { id: 'read', name: 'Read', category: 'Everyday', tones: [{ kelvin: 2900 }], brightness: 100 },
  { id: 'relax', name: 'Relax', category: 'Everyday', tones: [{ kelvin: 2250 }], brightness: 56 },
  { id: 'dimmed', name: 'Dimmed', category: 'Everyday', tones: [{ kelvin: 2700 }], brightness: 30 },
  { id: 'nightlight', name: 'Nightlight', category: 'Everyday', tones: [{ hex: '#FF8A1E' }], brightness: 2, white: 2200 },

  { id: 'concentrate', name: 'Concentrate', category: 'Focus', tones: [{ kelvin: 4300 }], brightness: 100 },
  { id: 'energize', name: 'Energize', category: 'Focus', tones: [{ kelvin: 6200 }], brightness: 100 },
  { id: 'daylight', name: 'Daylight', category: 'Focus', tones: [{ kelvin: 5200 }], brightness: 90 },

  { id: 'sunset', name: 'Sunset', category: 'Evening', tones: [{ hex: '#FF7A3D' }, { hex: '#FF4F6A' }, { hex: '#FFB347' }], brightness: 60, white: 2200 },
  { id: 'candlelight', name: 'Candlelight', category: 'Evening', tones: [{ kelvin: 2200 }], brightness: 35, effect: 'candle' },
  { id: 'fireside', name: 'Fireside', category: 'Evening', tones: [{ hex: '#FF6A1F' }, { kelvin: 2200 }], brightness: 45, effect: 'fire', white: 2200 },
  { id: 'cozy', name: 'Cozy', category: 'Evening', tones: [{ kelvin: 2400 }, { hex: '#FF9F5A' }], brightness: 45, white: 2400 },
  { id: 'movie', name: 'Movie', category: 'Evening', tones: [{ hex: '#3D4BFF', brightness: 18 }, { hex: '#7B3BF5', brightness: 12 }], brightness: 15, white: 2200 },

  { id: 'aurora', name: 'Aurora', category: 'Color', tones: [{ hex: '#19E6A0' }, { hex: '#7C4DFF' }, { hex: '#00B4FF' }, { hex: '#C04DFF' }], brightness: 70, white: 4000 },
  { id: 'tropical', name: 'Tropical', category: 'Color', tones: [{ hex: '#FF6F61' }, { hex: '#FFD166' }, { hex: '#06D6A0' }, { hex: '#1FA2E0' }], brightness: 80, white: 3500 },
  { id: 'neon', name: 'Neon', category: 'Color', tones: [{ hex: '#FF1FD2' }, { hex: '#00E8FF' }, { hex: '#7A2BFF' }], brightness: 75, white: 4000 },
  { id: 'ocean', name: 'Ocean', category: 'Color', tones: [{ hex: '#0A6CFF' }, { hex: '#00B8D9' }, { hex: '#4FD6E8' }], brightness: 65, white: 5000 },
  { id: 'forest', name: 'Forest', category: 'Color', tones: [{ hex: '#3A9A3E' }, { hex: '#8BCB5A' }, { hex: '#D5D96A' }], brightness: 60, white: 3000 },
];

/**
 * A preset spread over some lights, light by light. Colors go round the lights in their order
 * across the map (unplaced lights after, by name), so neighbours differ. White-only lights take
 * the preset's white; smart plugs are left as they are (a preset is a look, and a plug has none).
 */
export function presetLights(preset: Preset, lights: Light[], map: HomeMap | null): MoodLight[] {
  const placed = new Map(map?.lights.map((l) => [l.lightId, l]) ?? []);
  const order = lights
    .filter((l) => l.reachable && l.kind !== 'onoff')
    .sort((a, b) => {
      const pa = placed.get(a.id);
      const pb = placed.get(b.id);
      if (pa && pb) return pa.x - pb.x || pa.z - pb.z;
      if (pa || pb) return pa ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return order.map((l, i) => {
    const tone = preset.tones[i % preset.tones.length];
    const brightness = tone.brightness ?? preset.brightness;
    if (preset.effect && l.effects?.includes(preset.effect)) return { lightId: l.id, on: true, brightness, effect: preset.effect };
    if (tone.hex && l.kind === 'color') return { lightId: l.id, on: true, brightness, hex: tone.hex };
    const kelvin = tone.kelvin ?? preset.white ?? 2700;
    return { lightId: l.id, on: true, brightness, kelvin: hasTemperature(l) ? kelvin : undefined };
  });
}
