// Nocturne: near-black ground, warm ivory text, one champagne accent, hairlines instead of
// filled cards. The only saturated colors on screen are the lights.
// Canvas: https://claude.ai/artifact/Dx8ryX9uZt4sECfUHSJfUE (Foundations page).

export const color = {
  ground: '#050506',
  card: '#0A0A0C',
  sheet: '#0E0E10',
  selected: '#16161A',
  floor: '#0B0B0D',
  floorOutdoor: '#070708',
  ivory: '#F2E8D8',
  secondary: '#B9B0A2',
  muted: '#8F887D',
  champagne: '#E9CF9F',
  label: '#D9C39A',
  connected: '#A9E6B8',
  warning: '#F2B872',
  error: '#F28B7A',
  /** Text and icons drawn on champagne. */
  onChampagne: '#1A1208',
  track: '#2A2A2E',
  thumb: '#FBF6EE',
  /** Ivory ring around a lit light marker. */
  jewelRing: 'rgba(255,246,230,0.85)',
};

/** Ivory hairline at the given strength (the design uses 0.08–0.24). */
export const hairline = (alpha = 0.1) => `rgba(242,232,216,${alpha})`;

/** Font family names as loaded in the root layout (one family per weight, so Android picks the right file). */
export const font = {
  thin: 'Jost_200ExtraLight',
  display: 'Jost_300Light',
  displayRegular: 'Jost_400Regular',
  ui: 'Geist_400Regular',
  uiMedium: 'Geist_500Medium',
};

export const space = { gutter: 24 };

/** Height of the floating tab bar plus its bottom margin, without the safe-area inset. */
export const TAB_BAR_SPACE = 62 + 20;

// Older screens (scan, editor, pairing) still use these names.
export const theme = {
  bg: color.ground,
  surface: color.card,
  surface2: color.selected,
  border: hairline(0.16),
  text: color.ivory,
  muted: color.muted,
  accent: color.champagne,
  danger: color.error,
  success: color.connected,
};
