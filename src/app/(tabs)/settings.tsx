import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { About } from '../../ui/settings/About';
import { AwayFromHome } from '../../ui/settings/AwayFromHome';
import { Bridge } from '../../ui/settings/Bridge';
import { HomeLocation } from '../../ui/settings/HomeLocation';
import { LightsAndRooms } from '../../ui/settings/LightsAndRooms';
import { MapSettings } from '../../ui/settings/MapSettings';
import { QuickTile } from '../../ui/settings/QuickTile';
import { Weather } from '../../ui/settings/Weather';
import { Widgets } from '../../ui/settings/Widgets';
import { Display } from '../../ui/text';
import { TAB_BAR_SPACE } from '../../ui/theme';

/**
 * Settings: one section per component, stacked. `?section=tile` (long-press on the Quick Settings
 * tile, glim://settings?section=tile) scrolls to that section.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scroll = useRef<ScrollViewInstance>(null);
  const jumpTo = (name: string) => (y: number) => {
    if (section === name) scroll.current?.scrollTo({ y: Math.max(0, y - insets.top - 16), animated: false });
  };
  return (
    <ScrollView ref={scroll} contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + TAB_BAR_SPACE + 32, gap: 36 }}>
      <Display>Settings</Display>
      <Weather />
      <Bridge />
      <AwayFromHome />
      <HomeLocation />
      <MapSettings />
      <LightsAndRooms />
      <Widgets />
      <View onLayout={(e) => jumpTo('tile')(e.nativeEvent.layout.y)}>
        <QuickTile />
      </View>
      <About />
    </ScrollView>
  );
}
