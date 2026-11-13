import { Geist_400Regular, Geist_500Medium } from '@expo-google-fonts/geist';
import { Jost_200ExtraLight, Jost_300Light, Jost_400Regular } from '@expo-google-fonts/jost';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { WidgetPreview, type WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { cachedSnapshot, type Snapshot } from '../lib/hue/client';
import { loadMap, type HomeMap } from '../lib/map/map';
import { loadMoods, type Mood } from '../lib/moods';
import { loadBridgeRituals, type BridgeRitual } from '../lib/rituals/rituals';
import { PillButton } from '../ui/controls';
import { Display, Txt } from '../ui/text';
import { color } from '../ui/theme';
import { defaultItems, isShowing, itemKey, loadMoodsWidgetSettings, MAX_ITEMS, moodButtons, saveMoodsWidgetSettings, type MoodItem } from './moodButtons';
import { MoodItemPicker, prepareMoodItems } from './MoodItemPicker';
import { render } from './task-handler';
import { MoodsWidget } from './widgets';

/**
 * Configuration of a Moods widget (long-press the widget, then the edit pen): which buttons it
 * shows, in the order they were picked, up to 8. A live preview sits on top.
 */
export function MoodsWidgetConfig({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const [fontsReady] = useFonts({ Jost_200ExtraLight, Jost_300Light, Jost_400Regular, Geist_400Regular, Geist_500Medium });
  const { width } = useWindowDimensions();
  const [data, setData] = useState<{ moods: Mood[]; map: HomeMap | null; snapshot: Snapshot | null } | null>(null);
  const [items, setItems] = useState<MoodItem[] | null>(null);
  const [rituals, setRituals] = useState<BridgeRitual[]>([]);

  useEffect(() => {
    Promise.all([loadMoods(), loadMap(), cachedSnapshot(), loadMoodsWidgetSettings(widgetInfo.widgetId)]).then(([moods, map, snapshot, s]) => {
      setData({ moods, map, snapshot });
      setItems(s.items ?? defaultItems(moods));
    });
    // Sleep fades a button can start: the Rituals tab's (needs the bridge; a default without it).
    loadBridgeRituals()
      .then((b) => setRituals(b.rituals))
      .catch(() => null);
  }, [widgetInfo.widgetId]);

  if (!fontsReady || !data || !items) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  const { moods, map, snapshot } = data;
  const keys = items.map(itemKey);
  const k = Math.min(1, (width - 48) / widgetInfo.width);
  const pw = Math.round(widgetInfo.width * k);
  const ph = Math.round(widgetInfo.height * k);
  const buttons = snapshot ? moodButtons(items, moods, snapshot, map).map((b) => ({ ...b, showing: isShowing(snapshot, b) })) : [];

  const save = async () => {
    await saveMoodsWidgetSettings(widgetInfo.widgetId, { items });
    await prepareMoodItems(snapshot, items);
    const widget = await render(widgetInfo, { snapshot, stale: false });
    if (widget) renderWidget(widget);
    setResult('ok');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }} contentContainerStyle={{ padding: 24, paddingTop: 56, gap: 22 }}>
      <Display size={30}>Moods widget</Display>
      <View style={{ alignItems: 'center' }}>
        <WidgetPreview
          key={keys.join(',')}
          width={pw}
          height={ph}
          renderWidget={() => <MoodsWidget snapshot={snapshot} buttons={buttons} width={pw} height={ph} stale={false} />}
        />
      </View>
      <Txt size={12} tone="muted">
        Pick up to {MAX_ITEMS}, in the order you want them. A small widget shows the first ones and keeps All off last. Presets apply to the whole home.
      </Txt>

      <MoodItemPicker items={items} onChange={setItems} max={MAX_ITEMS} moods={moods} snapshot={snapshot} rituals={rituals} />

      <View style={{ gap: 10, marginTop: 8 }}>
        <PillButton title="Save" kind="primary" onPress={save} disabled={!items.length} />
        <PillButton title="Cancel" kind="text" onPress={() => setResult('cancel')} />
      </View>
    </ScrollView>
  );
}
