import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { color, font } from './theme';

type Props = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number };

/** Small spaced capitals for labels (Geist 500, 9–10px, 0.16em). Pass the text in any case. */
export function Label({ children, style, size = 10, tone = 'muted', numberOfLines }: Props & { size?: number; tone?: 'muted' | 'label' | 'ivory' | 'secondary' | 'champagne' }) {
  const c = { muted: color.muted, label: color.label, ivory: color.ivory, secondary: color.secondary, champagne: color.champagne }[tone];
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: font.uiMedium, fontSize: size, letterSpacing: size * 0.16, color: c, textTransform: 'uppercase' }, style]}
    >
      {children}
    </Text>
  );
}

/** Jost light, for headlines, names and big numbers. */
export function Display({ children, style, size = 34, weight = 300, numberOfLines }: Props & { size?: number; weight?: 200 | 300 | 400 }) {
  const family = weight === 200 ? font.thin : weight === 400 ? font.displayRegular : font.display;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: family, fontSize: size, lineHeight: Math.round(size * 1.12), letterSpacing: -0.01 * size, color: color.ivory }, style]}
    >
      {children}
    </Text>
  );
}

/** Geist, for UI text. */
export function Txt({ children, style, size = 15, tone = 'ivory', medium, numberOfLines }: Props & { size?: number; tone?: 'ivory' | 'secondary' | 'muted' | 'champagne'; medium?: boolean }) {
  const c = { ivory: color.ivory, secondary: color.secondary, muted: color.muted, champagne: color.champagne }[tone];
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: medium ? font.uiMedium : font.ui, fontSize: size, lineHeight: Math.round(size * 1.45), color: c }, style]}>
      {children}
    </Text>
  );
}
