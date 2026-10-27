import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AwayFromHome } from '../../ui/settings/AwayFromHome';
import { Bridge } from '../../ui/settings/Bridge';
import { Display } from '../../ui/text';
import { TAB_BAR_SPACE } from '../../ui/theme';

/** Settings: one section per component, stacked. */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + TAB_BAR_SPACE + 32, gap: 36 }}>
      <Display>Settings</Display>
      <Bridge />
      <AwayFromHome />
    </ScrollView>
  );
}
