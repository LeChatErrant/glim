import { memo, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';

import { moodMarkSvg, type MoodGlyph } from '../lib/moodMarks';

/**
 * A mood's mark: its glyph over a pool of its colors, or its colors as orbs (`src/lib/moodMarks.ts`,
 * the same drawing as on the widgets).
 */
export const MoodMark = memo(function MoodMark({ colors, glyph, size = 38, faded = false }: { colors: string[]; glyph: MoodGlyph | null; size?: number; faded?: boolean }) {
  const key = colors.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const xml = useMemo(() => moodMarkSvg({ colors, glyph, size, faded }), [key, glyph, size, faded]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
