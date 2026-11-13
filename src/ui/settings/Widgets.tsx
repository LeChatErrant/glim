import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { getWidgetInfo, type WidgetInfo } from 'react-native-android-widget';

import { cachedSnapshot, type Snapshot } from '../../lib/hue/client';
import { loadMap } from '../../lib/map/map';
import { loadMoods, type Mood } from '../../lib/moods';
import { defaultItems, loadMoodsWidgetSettings } from '../../widgets/moodButtons';
import { loadWidgetSettings } from '../../widgets/settings';
import { WIDGET_NAMES } from '../../widgets/task-handler';
import { loadTilesWidgetSettings } from '../../widgets/tiles';
import { Section } from '../controls';
import { Txt } from '../text';
import { SettingsRow } from './parts';

type Placed = { info: WidgetInfo; title: string; sub: string };

/** One line on what a placed widget shows. */
async function describe(info: WidgetInfo, rooms: { id: string; name: string }[], moods: Mood[], snapshot: Snapshot | null) {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (info.widgetName === 'Map') {
    const s = await loadWidgetSettings(info.widgetId);
    return s.roomIds?.length ? rooms.filter((r) => s.roomIds!.includes(r.id)).map((r) => r.name).join(', ') || 'Some rooms' : 'Whole home';
  }
  if (info.widgetName === 'Moods') {
    const s = await loadMoodsWidgetSettings(info.widgetId);
    return n((s.items ?? defaultItems(moods)).length, 'button', 'buttons');
  }
  if (info.widgetName === 'Light' || info.widgetName === 'Grid') {
    const items = (await loadTilesWidgetSettings(info.widgetId)).items;
    if (!items?.length) return info.widgetName === 'Light' ? 'Not set up yet' : 'Your rooms';
    if (info.widgetName === 'Light') {
      const it = items[0];
      return (it.kind === 'room' ? snapshot?.rooms.find((r) => r.id === it.id)?.name : snapshot?.lights.find((l) => l.id === it.id)?.name) ?? 'Removed';
    }
    return n(items.length, 'tile', 'tiles');
  }
  return 'Your rooms';
}

const TITLES: Record<string, string> = { Rooms: 'Rooms', Map: 'Map', Moods: 'Moods', Light: 'Light', Grid: 'Light grid' };

/**
 * Settings → Widgets: the widgets on the home screen, each opening its configuration (the same
 * screen as long-pressing it). Rooms widgets have nothing to set.
 */
export function Widgets() {
  const router = useRouter();
  const [placed, setPlaced] = useState<Placed[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      (async () => {
        const [map, moods, snapshot] = await Promise.all([loadMap(), loadMoods(), cachedSnapshot()]);
        const list: Placed[] = [];
        for (const name of WIDGET_NAMES) {
          for (const info of await getWidgetInfo(name)) {
            list.push({ info, title: TITLES[name] ?? name, sub: await describe(info, map?.rooms ?? [], moods, snapshot) });
          }
        }
        setPlaced(list);
      })().catch(() => setPlaced([]));
    }, []),
  );

  if (Platform.OS !== 'android' || placed === null) return null;
  return (
    <Section title="Widgets">
      <View>
        {placed.map((p) => (
          <SettingsRow
            key={p.info.widgetId}
            icon={p.info.widgetName === 'Map' ? 'map' : p.info.widgetName === 'Moods' ? 'moods' : p.info.widgetName === 'Light' ? 'light' : 'rooms'}
            title={p.title}
            sub={p.sub}
            onPress={p.info.widgetName === 'Rooms' ? undefined : () => router.push(`/widget/${p.info.widgetId}`)}
          />
        ))}
        <Txt size={12} tone="muted" style={{ marginTop: 8 }}>
          {placed.length
            ? 'Long-press a widget on your home screen to change it there too.'
            : 'No Glim widget on your home screen yet. Long-press your home screen, then Widgets, and search for Glim.'}
        </Txt>
      </View>
    </Section>
  );
}
