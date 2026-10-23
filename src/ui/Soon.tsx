import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './icons';
import { Display, Label, Txt } from './text';
import { color, hairline } from './theme';

/** A tab whose feature isn't built yet: says what it will do. */
export function Soon({ title, icon, text }: { title: string; icon: IconName; text: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 28, paddingHorizontal: 24 }}>
      <Display>{title}</Display>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18, paddingBottom: 120 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: hairline(0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={28} tint={color.champagne} stroke={1.2} />
        </View>
        <Label tone="label">Coming next</Label>
        <Txt tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}
