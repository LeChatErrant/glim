import { Geist_400Regular, Geist_500Medium } from '@expo-google-fonts/geist';
import { Jost_200ExtraLight, Jost_300Light, Jost_400Regular } from '@expo-google-fonts/jost';
import { useFonts } from 'expo-font';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { WidgetPreview, type WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { cachedSnapshot, type Snapshot } from '../lib/hue/client';
import { isLit, lightsOf } from '../lib/lights';
import { PillButton } from '../ui/controls';
import { Choice } from '../ui/scan/parts';
import { Display, Label, Txt } from '../ui/text';
import { color } from '../ui/theme';
import { render } from './task-handler';
import { defaultTiles, loadTilesWidgetSettings, MAX_TILES, resolveTiles, saveTilesWidgetSettings, tileKey, type TileItem } from './tiles';
import { GridWidget, LightWidget } from './widgets';

/**
 * Configuration of a Light widget (1×1: one room or one light) or a Grid widget (up to 8 rooms
 * and lights, in the order picked). Opens when the widget is added, and from long-press → edit.
 */
export function TilesWidgetConfig({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const [fontsReady] = useFonts({ Jost_200ExtraLight, Jost_300Light, Jost_400Regular, Geist_400Regular, Geist_500Medium });
  const { width } = useWindowDimensions();
  const single = widgetInfo.widgetName === 'Light';
  const [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [items, setItems] = useState<TileItem[] | null>(null);

  useEffect(() => {
    Promise.all([cachedSnapshot(), loadTilesWidgetSettings(widgetInfo.widgetId)]).then(([snap, s]) => {
      setSnapshot(snap);
      setItems(s.items ?? (!single && snap ? defaultTiles(snap) : []));
    });
  }, [widgetInfo.widgetId, single]);

  if (!fontsReady || snapshot === undefined || !items) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  const keys = items.map(tileKey);
  const toggle = (i: TileItem) => {
    const k = tileKey(i);
    if (single) setItems([i]);
    else if (keys.includes(k)) setItems(items.filter((x) => tileKey(x) !== k));
    else if (items.length < MAX_TILES) setItems([...items, i]);
  };
  const chip = (i: TileItem, label: string, dot?: string) => {
    const at = keys.indexOf(tileKey(i));
    const text = at >= 0 && !single ? `${at + 1} · ${label}` : label;
    return <Choice key={tileKey(i)} label={text} chosen={at >= 0} dot={dot} onPress={() => toggle(i)} />;
  };

  const k = Math.min(1, (width - 48) / widgetInfo.width);
  const pw = Math.round(widgetInfo.width * k);
  const ph = Math.round(widgetInfo.height * k);
  const tiles = snapshot ? resolveTiles(items, snapshot) : [];

  const save = async () => {
    await saveTilesWidgetSettings(widgetInfo.widgetId, { items });
    const widget = await render(widgetInfo, { snapshot: snapshot ?? null, stale: false });
    if (widget) renderWidget(widget);
    setResult('ok');
  };

  const rooms = snapshot?.rooms ?? [];
  const loose = snapshot?.lights.filter((l) => !l.roomId || !rooms.some((r) => r.id === l.roomId)) ?? [];
  const dotOf = (on: boolean, c: string) => (on ? c : undefined);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }} contentContainerStyle={{ padding: 24, paddingTop: 56, gap: 22 }}>
      <Display size={30}>{single ? 'Light widget' : 'Grid widget'}</Display>
      <View style={{ alignItems: 'center' }}>
        <WidgetPreview
          key={keys.join(',')}
          width={pw}
          height={ph}
          renderWidget={() =>
            single ? (
              <LightWidget snapshot={snapshot} tile={tiles[0] ?? null} width={pw} height={ph} stale={false} />
            ) : (
              <GridWidget snapshot={snapshot} tiles={tiles} width={pw} height={ph} stale={false} />
            )
          }
        />
      </View>
      <Txt size={12} tone="muted">
        {single
          ? 'Pick one room or one light. Tap the widget to turn it on or off.'
          : `Pick up to ${MAX_TILES} rooms and lights, in the order you want them. A 4×1 widget shows the first 4.`}
      </Txt>
      {!snapshot && (
        <Txt size={13} tone="muted">
          Open Glim and pair your bridge first.
        </Txt>
      )}

      {!!rooms.length && (
        <Section title="Rooms">
          {rooms.map((r) => {
            const lit = lightsOf(r, snapshot!).filter(isLit);
            return chip({ kind: 'room', id: r.id }, r.name, dotOf(lit.length > 0, lit[0]?.color ?? color.champagne));
          })}
        </Section>
      )}
      {rooms.map((r) => {
        const lights = lightsOf(r, snapshot!);
        if (!lights.length) return null;
        return (
          <Section key={r.id} title={`Lights · ${r.name}`}>
            {lights.map((l) => chip({ kind: 'light', id: l.id }, l.name, dotOf(isLit(l), l.color)))}
          </Section>
        );
      })}
      {!!loose.length && <Section title="Lights on their own">{loose.map((l) => chip({ kind: 'light', id: l.id }, l.name, dotOf(isLit(l), l.color)))}</Section>}

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
