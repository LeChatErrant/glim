import { Geist_400Regular, Geist_500Medium } from '@expo-google-fonts/geist';
import { Jost_200ExtraLight, Jost_300Light, Jost_400Regular } from '@expo-google-fonts/jost';
import { useFonts } from 'expo-font';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { WidgetPreview, type WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { cachedSnapshot, type Snapshot } from '../lib/hue/client';
import { loadMap, type HomeMap } from '../lib/map/map';
import { PRESET_CATEGORIES, PRESETS } from '../lib/moodPresets';
import { loadMoods, type Mood } from '../lib/moods';
import { PillButton } from '../ui/controls';
import { Choice } from '../ui/scan/parts';
import { Display, Label, Txt } from '../ui/text';
import { color } from '../ui/theme';
import { defaultItems, isShowing, itemKey, loadMoodsWidgetSettings, MAX_ITEMS, moodButtons, saveMoodsWidgetSettings, type MoodItem } from './moodButtons';
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

  useEffect(() => {
    Promise.all([loadMoods(), loadMap(), cachedSnapshot(), loadMoodsWidgetSettings(widgetInfo.widgetId)]).then(([moods, map, snapshot, s]) => {
      setData({ moods, map, snapshot });
      setItems(s.items ?? defaultItems(moods));
    });
  }, [widgetInfo.widgetId]);

  if (!fontsReady || !data || !items) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  const { moods, map, snapshot } = data;
  const keys = items.map(itemKey);
  const toggle = (i: MoodItem) => {
    const k = itemKey(i);
    if (keys.includes(k)) setItems(items.filter((x) => itemKey(x) !== k));
    else if (items.length < MAX_ITEMS) setItems([...items, i]);
  };
  const chip = (i: MoodItem, label: string) => {
    const at = keys.indexOf(itemKey(i));
    return <Choice key={itemKey(i)} label={at >= 0 ? `${at + 1} · ${label}` : label} chosen={at >= 0} onPress={() => toggle(i)} />;
  };

  const k = Math.min(1, (width - 48) / widgetInfo.width);
  const pw = Math.round(widgetInfo.width * k);
  const ph = Math.round(widgetInfo.height * k);
  const buttons = snapshot ? moodButtons(items, moods, snapshot, map).map((b) => ({ ...b, showing: isShowing(snapshot, b) })) : [];
  const own = moods.filter((m) => !m.path);
  const paths = moods.filter((m) => m.path);

  const save = async () => {
    await saveMoodsWidgetSettings(widgetInfo.widgetId, { items });
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

      {!!own.length && (
        <Section title="My moods">
          {own.map((m) => chip({ kind: 'mood', id: m.id }, m.name))}
        </Section>
      )}
      {!!paths.length && (
        <Section title="Paths">
          {paths.map((m) => chip({ kind: 'mood', id: m.id }, m.name))}
        </Section>
      )}
      {PRESET_CATEGORIES.map((c) => (
        <Section key={c} title={c}>
          {PRESETS.filter((p) => p.category === c).map((p) => chip({ kind: 'preset', id: p.id }, p.name))}
        </Section>
      ))}
      <Section title="Other">{chip({ kind: 'off' }, 'All off')}</Section>

      <View style={{ gap: 10, marginTop: 8 }}>
        <PillButton title="Save" kind="primary" onPress={save} disabled={!items.length} />
        <PillButton title="Cancel" kind="text" onPress={() => setResult('cancel')} />
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Label tone="label">{title}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}
