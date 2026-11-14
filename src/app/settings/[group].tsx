import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, PageTitle } from '../../ui/controls';
import { GROUPS, type GroupId } from '../../ui/settings/groups';
import { SectionReady } from '../../ui/settings/parts';
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
  const top = useRef(0);
  // Sections still loading (they report before the first paint). The page shows them together
  // once all are in, or after 700 ms at most.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(false);
  const report = useCallback((id: string, ready: boolean) => {
    setPending((p) => {
      if (ready !== p.has(id)) return p;
      const next = new Set(p);
      if (ready) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 700);
    return () => clearTimeout(t);
  }, []);
  const g = GROUPS[group as GroupId];
  if (!g) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  return (
    <SectionReady.Provider value={report}>
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
          <View onLayout={(e) => (top.current = e.nativeEvent.layout.y)} style={{ gap: 36, opacity: shown || !pending.size ? 1 : 0 }}>
            {g.sections.map((s, i) =>
              s.anchor ? (
                <View
                  key={i}
                  onLayout={(e) => {
                    if (section === s.anchor) scroll.current?.scrollTo({ y: Math.max(0, top.current + e.nativeEvent.layout.y - insets.top - 16), animated: false });
                  }}
                >
                  {s.node}
                </View>
              ) : (
                <Fragment key={i}>{s.node}</Fragment>
              ),
            )}
          </View>
        </ScrollView>
      </PageTitle.Provider>
    </SectionReady.Provider>
  );
}
