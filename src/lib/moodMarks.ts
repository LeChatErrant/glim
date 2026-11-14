/**
 * A mood's mark: one small sign instead of a dot per light (design: "Glim mood marks",
 * https://claude.ai/artifact/JbzRfsXM4gWzx4pRfTZrrf, option B falling back to A).
 * A glyph (a stroke icon) over a soft pool of the mood's colors; without a glyph, its colors as up
 * to three overlapping orbs, like the Palette tab's. Drawn as one SVG string, shared by the app
 * (SvgXml) and the widgets.
 */

// Nocturne stroke glyphs: 24×24 grid, round caps, drawn to match `src/ui/icons.tsx`.
export const GLYPHS = {
  sofa: 'M5 11V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2M3.5 12a1.5 1.5 0 0 1 3 0v2h11v-2a1.5 1.5 0 0 1 3 0v5h-17ZM5.5 17v2M18.5 17v2',
  book: 'M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5ZM12 6.5v13',
  screen: 'M3.5 5h17v11h-17ZM8 20h8M12 16v4',
  moon: 'M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10Z',
  candle: 'M9.5 11h5v9h-5ZM12 11V9.5M12 3.5c1.3 1.5 1.8 2.6 1.8 3.3a1.8 1.8 0 0 1-3.6 0c0-.7.5-1.8 1.8-3.3Z',
  flame: 'M12 21a6 6 0 0 1-6-6c0-3 2-4.5 3-7 .7 1.8 1.6 2.8 2.6 3 0-3 1-6 3.4-8 0 3.5 3 6 3 10a6 6 0 0 1-6 8Z',
  cup: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5ZM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5V6M12 3.5V6',
  dinner: 'M7 3v6a2 2 0 0 0 4 0V3M9 3v18M17 21V3c-2 1.5-3 4-3 7v3h3',
  wine: 'M8 3h8l-.4 5a3.6 3.6 0 0 1-7.2 0ZM12 11.6V20M8.5 20h7',
  bath: 'M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5ZM6 12V6.5a2 2 0 0 1 3.6-1.2M7 19l-1 2M17 19l1 2',
  bed: 'M3 6v13M3 14h18v5M21 14v-2a3 3 0 0 0-3-3h-7v5M8.5 11a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  desk: 'M5 6h14v9H5ZM3 18.5h18',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  leaf: 'M5 19C5 11 10 6 19 5c0 9-5 14-13 14ZM5 19l8-8',
  wave: 'M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  sparkle: 'M12 4c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z',
  heart: 'M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10Z',
  game: 'M7 8h10a4 4 0 0 1 4 4.5l-.5 3a2.5 2.5 0 0 1-4.3 1.3L14.5 15h-5l-1.7 1.8a2.5 2.5 0 0 1-4.3-1.3l-.5-3A4 4 0 0 1 7 8ZM8 10.5v3M6.5 12h3M15.5 11.5h.01M17.5 13h.01',
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  balloon: 'M12 15c-3 0-5-3-5-6a5 5 0 0 1 10 0c0 3-2 6-5 6ZM11 16.5h2l-1-1.5ZM12 16.5c0 2-1.5 2.5-1 4.5',
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z',
};

export type MoodGlyph = keyof typeof GLYPHS;

/** The glyphs in the picker's order, with their names. */
export const GLYPH_LIST: { id: MoodGlyph; label: string }[] = [
  { id: 'sofa', label: 'Sofa' },
  { id: 'book', label: 'Read' },
  { id: 'screen', label: 'Screen' },
  { id: 'moon', label: 'Night' },
  { id: 'candle', label: 'Candle' },
  { id: 'flame', label: 'Fire' },
  { id: 'cup', label: 'Morning' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'wine', label: 'Evening' },
  { id: 'bath', label: 'Bath' },
  { id: 'bed', label: 'Bed' },
  { id: 'desk', label: 'Work' },
  { id: 'sun', label: 'Day' },
  { id: 'leaf', label: 'Nature' },
  { id: 'wave', label: 'Calm' },
  { id: 'music', label: 'Music' },
  { id: 'sparkle', label: 'Party' },
  { id: 'heart', label: 'Love' },
  { id: 'game', label: 'Games' },
  { id: 'home', label: 'Home' },
  { id: 'balloon', label: 'Kids' },
  { id: 'star', label: 'Favorite' },
];

export const isGlyph = (g: unknown): g is MoodGlyph => typeof g === 'string' && g in GLYPHS;

/**
 * Words that suggest a glyph, English and French, without accents. The first glyph with a word in
 * the name wins ("Movie night" is a screen, not a moon). Words of 4 letters or more also match the
 * start of a word ("soir" → "soiree"); shorter ones must match whole.
 */
const WORDS: [MoodGlyph, string[]][] = [
  ['screen', ['movie', 'movies', 'film', 'cinema', 'cine', 'tv', 'tele', 'television', 'netflix', 'serie', 'series']],
  ['game', ['game', 'games', 'gaming', 'jeu', 'jeux', 'console']],
  ['book', ['read', 'reading', 'lecture', 'lire', 'livre', 'book']],
  ['dinner', ['dinner', 'diner', 'dine', 'lunch', 'dejeuner', 'repas', 'meal', 'brunch']],
  ['cup', ['morning', 'matin', 'coffee', 'cafe', 'breakfast', 'reveil', 'wake']],
  ['bath', ['bath', 'bain', 'shower', 'douche', 'spa']],
  ['candle', ['candle', 'candlelight', 'bougie', 'chandelle']],
  ['flame', ['fire', 'fireside', 'fireplace', 'feu', 'cheminee']],
  ['music', ['music', 'musique', 'concert', 'dance', 'danse', 'karaoke']],
  ['sparkle', ['party', 'fete', 'disco', 'neon', 'celebration', 'aurora']],
  ['wine', ['evening', 'soir', 'soiree', 'apero', 'aperitif', 'wine', 'vin', 'cocktail', 'drinks']],
  ['heart', ['love', 'romance', 'romantic', 'romantique', 'amour', 'date']],
  ['sofa', ['cozy', 'cosy', 'cocooning', 'lounge', 'sofa', 'canape', 'chill']],
  ['desk', ['work', 'travail', 'focus', 'concentrate', 'concentration', 'study', 'office', 'bureau', 'homework', 'devoirs']],
  ['moon', ['night', 'nuit', 'nightlight', 'veilleuse', 'sleep', 'dodo', 'dormir', 'bedtime', 'coucher', 'goodnight']],
  ['bed', ['bed', 'lit']],
  ['sun', ['bright', 'lumineux', 'day', 'jour', 'daylight', 'energize', 'energy', 'sun', 'soleil', 'sunrise', 'sunset']],
  ['wave', ['relax', 'calm', 'calme', 'zen', 'ocean', 'sea', 'mer', 'meditation', 'yoga']],
  ['leaf', ['forest', 'foret', 'nature', 'garden', 'jardin', 'plant', 'plante', 'spring', 'printemps', 'tropical']],
  ['balloon', ['kids', 'kid', 'enfant', 'enfants', 'baby', 'bebe', 'birthday', 'anniversaire']],
  ['home', ['home', 'maison', 'welcome', 'bienvenue', 'arrive', 'arrival']],
  ['star', ['favorite', 'favourite', 'favori']],
];

/** A glyph that fits the name ("Cinéma" → screen, "Bonne nuit" → moon), or null. */
export function suggestGlyph(name: string): MoodGlyph | null {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const [glyph, keys] of WORDS) if (keys.some((k) => words.some((w) => w === k || (k.length >= 4 && w.startsWith(k))))) return glyph;
  return null;
}

/**
 * The glyph a mood shows: the one picked in the editor, none if "Colors only" was picked (null),
 * else one suggested from its name.
 */
export const moodGlyph = (m: { name: string; glyph?: MoodGlyph | null }): MoodGlyph | null =>
  m.glyph === null ? null : isGlyph(m.glyph) ? m.glyph : suggestGlyph(m.name);

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a: string, b: string) => {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 34;
};

/**
 * A mood's colors for its mark: near shades merged (six lights in about the same warm white are one
 * color), the biggest share first, at most `max`. Give one color per lit light (repeats count);
 * off lights and plugs give none.
 */
export function markColors(colors: (string | null | undefined)[], max = 3): string[] {
  const groups: { c: string; n: number }[] = [];
  for (const c of colors) {
    if (!c || !/^#[0-9a-f]{6}$/i.test(c)) continue;
    const g = groups.find((x) => near(x.c, c));
    if (g) g.n++;
    else groups.push({ c, n: 1 });
  }
  // Stable: equal shares keep their order (a palette's first color first).
  return groups
    .map((g, i) => ({ ...g, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, max)
    .map((g) => g.c);
}

const IVORY = '#F2E8D8';

/**
 * The mark as an SVG string, `size` px square. With a glyph: the glyph in ivory over a pool of the
 * colors, in a hairline ring. Without: the colors as overlapping orbs. No colors (everything off):
 * a dashed ring, with the glyph in muted ivory if there is one.
 */
export function moodMarkSvg({ colors, glyph, size, faded = false }: { colors: string[]; glyph: MoodGlyph | null; size: number; faded?: boolean }) {
  const cs = colors.slice(0, 3);
  const a = faded ? 0.5 : 1;
  // Ids unique to the look, so marks side by side never borrow each other's gradients.
  const id = `m${glyph ?? 'o'}${cs.join('').replace(/#/g, '')}${size}`;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">`;
  // A glyph at 20 units in a 40 box, its stroke about 1.5 px whatever the size.
  const strokeW = Math.min(2.6, (1.5 * 40) / size / (20 / 24));
  const glyphEl = (c: string, op: number) =>
    glyph
      ? `<path d="${GLYPHS[glyph]}" transform="translate(10 10) scale(${20 / 24})" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';

  if (!cs.length)
    return (
      `${head}<circle cx="20" cy="20" r="18.5" fill="none" stroke="${IVORY}" stroke-opacity="0.35" stroke-width="${(40 / size).toFixed(2)}" stroke-dasharray="2.5 2.5"/>` +
      `${glyphEl(IVORY, 0.55 * a)}</svg>`
    );

  if (glyph) {
    const at = cs.length === 1 ? [[20, 20]] : cs.length === 2 ? [[14, 17], [27, 23]] : [[14, 15], [27, 17], [20, 28]];
    const r = cs.length === 1 ? 20 : 17;
    const defs = cs
      .map((c, i) => `<radialGradient id="${id}${i}"><stop offset="0" stop-color="${c}" stop-opacity="${0.62 * a}"/><stop offset="0.55" stop-color="${c}" stop-opacity="${0.3 * a}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`)
      .join('');
    const pools = cs.map((_, i) => `<circle cx="${at[i][0]}" cy="${at[i][1]}" r="${r}" fill="url(#${id}${i})"/>`).join('');
    return (
      `${head}<defs><clipPath id="${id}c"><circle cx="20" cy="20" r="19.5"/></clipPath>${defs}</defs>` +
      `<g clip-path="url(#${id}c)">${pools}</g>` +
      `<circle cx="20" cy="20" r="19" fill="none" stroke="${IVORY}" stroke-opacity="0.28" stroke-width="${(40 / size).toFixed(2)}"/>` +
      `${glyphEl(IVORY, a)}</svg>`
    );
  }

  const at = cs.length === 1 ? [[20, 20]] : cs.length === 2 ? [[15, 20], [25, 20]] : [[14.5, 16], [25.5, 16], [20, 26]];
  const r = cs.length === 1 ? 14 : 12;
  const defs = cs
    .map(
      (c, i) =>
        `<radialGradient id="${id}${i}"><stop offset="0" stop-color="${c}" stop-opacity="${a}"/><stop offset="0.5" stop-color="${c}" stop-opacity="${0.9 * a}"/><stop offset="0.75" stop-color="${c}" stop-opacity="${0.35 * a}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`,
    )
    .join('');
  const orbs = cs.map((_, i) => `<circle cx="${at[i][0]}" cy="${at[i][1]}" r="${r}" fill="url(#${id}${i})"/>`).join('');
  return `${head}<defs>${defs}</defs>${orbs}</svg>`;
}
