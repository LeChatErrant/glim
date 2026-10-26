/**
 * Hue's built-in light effects (CLIP v2 `effects_v2`): the light animates by itself on the bridge,
 * so it keeps going with the phone off. Swatches only hint at each effect's colors.
 */
export const EFFECTS: { id: string; label: string; hint: string; swatch: [string, string] }[] = [
  { id: 'candle', label: 'Candle', hint: 'Flickers like a flame', swatch: ['#FFB25E', '#FF7A2E'] },
  { id: 'fire', label: 'Fireplace', hint: 'Warm, lively flames', swatch: ['#FF8A3D', '#E8401C'] },
  { id: 'sparkle', label: 'Sparkle', hint: 'Short bright twinkles', swatch: ['#FFF1D6', '#FFD27A'] },
  { id: 'glisten', label: 'Glisten', hint: 'Soft shimmer', swatch: ['#FFF6E8', '#C9D8FF'] },
  { id: 'opal', label: 'Opal', hint: 'Slow pastel drift', swatch: ['#F7C6E0', '#B8E6F0'] },
  { id: 'prism', label: 'Prism', hint: 'Cycles through colors', swatch: ['#FF5FA2', '#5FB8FF'] },
  { id: 'underwater', label: 'Underwater', hint: 'Rippling blues', swatch: ['#3FA8FF', '#1E5BD6'] },
  { id: 'cosmos', label: 'Cosmos', hint: 'Deep purples, drifting', swatch: ['#8A5BFF', '#3B2A8F'] },
  { id: 'sunbeam', label: 'Sunbeam', hint: 'Sun through leaves', swatch: ['#FFE08A', '#FFB84D'] },
  { id: 'enchant', label: 'Enchant', hint: 'Magical, slow and colorful', swatch: ['#C77DFF', '#FF9ED2'] },
];

export const effectLabel = (id: string | undefined) => EFFECTS.find((e) => e.id === id)?.label ?? null;

/** An effect is running (Hue reports "no_effect" otherwise). */
export const hasEffect = (effect: string | undefined): effect is string => !!effect && effect !== 'no_effect';

/** Effects that flicker: their glow flickers on the map too. */
export const FLICKERS = ['candle', 'fire'];
