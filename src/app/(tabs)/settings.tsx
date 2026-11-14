import Constants from 'expo-constants';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { getWidgetInfo } from 'react-native-android-widget';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHome } from '../../lib/hue/useHome';
import { loadMap } from '../../lib/map/map';
import { loadTileTarget, type TileTarget } from '../../lib/tile';
import { useOutside, weatherLabel } from '../../lib/weather/source';
import { GROUP_ORDER, GROUPS, groupOfAnchor, type GroupId } from '../../ui/settings/groups';
import { SettingsRow } from '../../ui/settings/parts';
import { Display } from '../../ui/text';
import { TAB_BAR_SPACE } from '../../ui/theme';
import { WIDGET_NAMES } from '../../widgets/task-handler';
import { SANDBOX } from '../../lib/hue/sandbox';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Settings: one row per group (`src/ui/settings/groups.tsx`), each with a line on where it stands,
 * opening the group's screen. `?section=tile` (long-press on the Quick Settings tile,
 * glim://settings?section=tile) opens the group holding that section, scrolled to it.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { snapshot, connection } = useHome(15_000);
  const { settings: weather, live } = useOutside(false);
  const [mapped, setMapped] = useState<boolean | null>(null);
  const [widgets, setWidgets] = useState<number | null>(null);
  const [tile, setTile] = useState<TileTarget | null>(null);

  useEffect(() => {
    if (!section) return;
    const group = groupOfAnchor(section);
    router.setParams({ section: undefined });
    if (group) router.push(`/settings/${group}?section=${section}`);
  }, [section, router]);

  useFocusEffect(
    useCallback(() => {
      loadMap().then((m) => setMapped(!!m?.rooms.length));
      loadTileTarget().then(setTile);
      if (Platform.OS === 'android') {
        Promise.all(WIDGET_NAMES.map((n) => getWidgetInfo(n)))
          .then((all) => setWidgets(all.reduce((k, list) => k + list.length, 0)))
          .catch(() => setWidgets(0));
      }
    }, []),
  );

  const tileName = !tile
    ? null
    : tile.kind === 'home'
      ? 'All lights'
      : tile.kind === 'room' || tile.kind === 'group'
        ? ([...(snapshot?.rooms ?? []), ...(snapshot?.zones ?? [])].find((r) => r.id === tile.id)?.name ?? 'Removed')
        : tile.kind === 'sleep'
          ? 'Sleep fade'
          : 'A mood';
  const commit = (Constants.expoConfig?.extra as { commit?: string | null } | undefined)?.commit;

  const subs: Record<GroupId, string> = {
    home: [
      snapshot ? `${plural(snapshot.rooms.length, 'room', 'rooms')} · ${plural(snapshot.lights.length, 'light', 'lights')}` : null,
      mapped === null ? null : mapped ? 'Map drawn' : 'No map yet',
    ]
      .filter(Boolean)
      .join(' · '),
    widgets:
      Platform.OS === 'android'
        ? [widgets === null ? null : widgets ? `${plural(widgets, 'widget', 'widgets')} on your home screen` : 'No widget yet', tileName && `Tile: ${tileName}`].filter(Boolean).join(' · ')
        : 'Home-screen widgets',
    connection: SANDBOX
      ? 'Glim Fresh · a sandbox, the bridge is read-only'
      : connection === 'home' ? 'At home · straight to your bridge' : connection === 'cloud' ? 'Away · through Hue’s cloud' : 'Offline · your bridge doesn’t answer',
    outside: !weather
      ? ''
      : !weather.outside
        ? 'Off · the map on plain black'
        : weather.weather !== 'live' || weather.time !== 'live'
          ? 'Set by hand'
          : live
            ? `${weatherLabel(live.kind, live.isDay, live.code)} · ${live.temp}° at home`
            : 'On',
    about: `Glim ${Constants.expoConfig?.version ?? ''}${commit ? ` · ${commit}` : ''}`,
  };

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + TAB_BAR_SPACE + 32, gap: 28 }}>
      <Display>Settings</Display>
      <View>
        {GROUP_ORDER.map((id) => (
          <SettingsRow key={id} icon={GROUPS[id].icon} title={GROUPS[id].title} sub={subs[id]} onPress={() => router.push(`/settings/${id}`)} />
        ))}
      </View>
    </ScrollView>
  );
}
