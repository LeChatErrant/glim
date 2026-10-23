import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, font, hairline, theme } from './theme';

export function Button({
  title,
  onPress,
  primary,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primary,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, primary && { color: color.onChampagne }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, onPress, active, dot }: { label: string; onPress: () => void; active?: boolean; dot?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: color.champagne, borderColor: color.champagne }]}>
      {dot && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />}
      <Text style={{ color: active ? color.onChampagne : theme.text, fontSize: 13, fontFamily: active ? font.uiMedium : font.ui }}>{label}</Text>
    </Pressable>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={{ color: muted ? color.secondary : theme.text, fontSize: 15, lineHeight: 22, fontFamily: font.ui }}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: hairline(0.16),
    backgroundColor: 'rgba(5,5,6,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: color.champagne, borderColor: color.champagne },
  buttonText: { color: theme.text, fontSize: 15, fontFamily: font.uiMedium },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: hairline(0.16),
    backgroundColor: 'rgba(5,5,6,0.6)',
  },
});
