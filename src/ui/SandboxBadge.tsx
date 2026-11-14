import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SANDBOX } from '../lib/hue/sandbox';
import { Label } from './text';
import { hairline } from './theme';

/** A small capsule at the top of every screen in Glim Fresh, so it's never mistaken for the real app. */
export function SandboxBadge() {
  const insets = useSafeAreaInsets();
  if (!SANDBOX) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 2, left: 0, right: 0, alignItems: 'center' }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: hairline(0.24), backgroundColor: 'rgba(5,5,6,0.8)' }}>
        <Label size={9} tone="champagne">
          Fresh · sandbox
        </Label>
      </View>
    </View>
  );
}
