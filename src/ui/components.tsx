import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

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
});
