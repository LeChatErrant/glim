import { Tabs, type BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '../../ui/icons';
import { Label } from '../../ui/text';
import { color, hairline } from '../../ui/theme';

const TABS: Record<string, { title: string; icon: IconName }> = {
  index: { title: 'Map', icon: 'map' },
  rooms: { title: 'Rooms', icon: 'rooms' },
  moods: { title: 'Moods', icon: 'moods' },
  rituals: { title: 'Rituals', icon: 'rituals' },
  settings: { title: 'Settings', icon: 'settings' },
};

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.ground } }}
    >
      {Object.keys(TABS).map((name) => (
        <Tabs.Screen key={name} name={name} options={{ title: TABS[name].title }} />
      ))}
    </Tabs>
  );
}

/** Floating pill over the content, as in the Nocturne design. */
function TabBar({ state, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: 20 + insets.bottom,
        height: 62,
        borderRadius: 31,
        backgroundColor: 'rgba(18,18,20,0.94)',
        borderWidth: 1,
        borderColor: hairline(0.1),
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {state.routes.map((route, i) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === i;
        const tint = focused ? color.champagne : color.muted;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.title}
            onPress={() => !focused && navigateToTab(route.key)}
            style={{ flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          >
            <Icon name={tab.icon} size={20} tint={tint} />
            <Label size={9} style={{ color: tint, letterSpacing: 9 * 0.14 }}>
              {tab.title}
            </Label>
          </Pressable>
        );
      })}
    </View>
  );
}
