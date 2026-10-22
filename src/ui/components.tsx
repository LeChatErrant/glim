import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from './theme';

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
      <Text style={[styles.buttonText, primary && { color: theme.bg }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, onPress, active, dot }: { label: string; onPress: () => void; active?: boolean; dot?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: theme.text }]}>
      {dot && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />}
      <Text style={{ color: active ? theme.bg : theme.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={{ color: muted ? theme.muted : theme.text, fontSize: 15, lineHeight: 22 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: theme.text },
  buttonText: { color: theme.text, fontSize: 15, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});
