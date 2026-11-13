import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useRef } from 'react';
import { ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, PageTitle } from '../../ui/controls';
import { GROUPS, type GroupId } from '../../ui/settings/groups';
import { Display } from '../../ui/text';
import { color } from '../../ui/theme';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

/**
 * One Settings group (Your home, Widgets and tile…): its sections stacked. A section titled like
 * the group doesn't repeat the title (`PageTitle`). `?section=` scrolls to a section's anchor.
 */
export default function SettingsGroupScreen() {
  const insets = useSafeAreaInsets();
  const { group, section } = useLocalSearchParams<{ group: string; section?: string }>();
  const scroll = useRef<ScrollViewInstance>(null);
  const g = GROUPS[group as GroupId];
  if (!g) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  return (
    <PageTitle.Provider value={g.title}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1, backgroundColor: color.ground }}
        contentContainerStyle={{ paddingTop: insets.top + 22, paddingHorizontal: 24, paddingBottom: insets.bottom + 48, gap: 36 }}
      >
        <View style={{ gap: 18 }}>
          <IconButton icon="back" label="Back" onPress={goBack} />
          <Display>{g.title}</Display>
        </View>
        {g.sections.map((s, i) =>
          s.anchor ? (
            <View
              key={i}
              onLayout={(e) => {
                if (section === s.anchor) scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - insets.top - 16), animated: false });
              }}
            >
              {s.node}
            </View>
          ) : (
            <Fragment key={i}>{s.node}</Fragment>
          ),
        )}
      </ScrollView>
    </PageTitle.Provider>
  );
}
