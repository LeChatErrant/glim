import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Display, Label } from './text';
import { color, font, hairline } from './theme';

/** A bottom sheet over the current screen (Nocturne): dim backdrop, rounded top, hairline edge. */
export function ModalSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(5,5,6,0.6)' }} />
        <View
          style={{
            maxHeight: '88%',
            backgroundColor: color.sheet,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: hairline(0.1),
            paddingTop: 22,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <Display size={24} style={{ marginBottom: 14, paddingHorizontal: 24 }}>
            {title}
          </Display>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A labeled one-line text field with a hairline underline. */
export function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        selectionColor={color.champagne}
        accessibilityLabel={label}
        style={{ fontFamily: font.display, fontSize: 22, color: color.ivory, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: hairline(0.2) }}
      />
    </View>
  );
}
