import { Geist_400Regular, Geist_500Medium } from '@expo-google-fonts/geist';
import { Jost_200ExtraLight, Jost_300Light, Jost_400Regular } from '@expo-google-fonts/jost';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { WidgetPreview, type WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { cachedSnapshot, type Snapshot } from '../lib/hue/client';
import { loadMap, type HomeMap } from '../lib/map/map';
import { PillButton } from '../ui/controls';
import { Choice } from '../ui/scan/parts';
import { Display, Label, Txt } from '../ui/text';
import { color } from '../ui/theme';
import { loadWidgetSettings, saveWidgetSettings, widgetPlan, type MapWidgetSettings } from './settings';
import { render } from './task-handler';
import { MapWidget } from './widgets';

/**
 * Configuration of a Map widget (long-press the widget, then the edit pen): which rooms it shows,
 * so a big home stays tappable, and how it's turned. A live preview sits on top.
 */
export function MapWidgetConfig({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const [fontsReady] = useFonts({ Jost_200ExtraLight, Jost_300Light, Jost_400Regular, Geist_400Regular, Geist_500Medium });
  const { width } = useWindowDimensions();
  const [map, setMap] = useState<HomeMap | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<MapWidgetSettings | null>(null);

  useEffect(() => {
    Promise.all([loadMap(), cachedSnapshot(), loadWidgetSettings(widgetInfo.widgetId)]).then(([m, s, w]) => {
      setMap(m);
      setSnapshot(s);
      setSettings(w);
    });
  }, [widgetInfo.widgetId]);

  if (!fontsReady || !settings) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  const rooms = map?.rooms ?? [];
  const chosen = settings.roomIds ?? [];
  const toggleRoom = (id: string) =>
    setSettings({ ...settings, roomIds: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });
  const turn = (d: number) => setSettings({ ...settings, rotation: ((((settings.rotation ?? map?.rotation ?? 0) + d) % 360) + 360) % 360 });
  const roomName = (r: HomeMap['rooms'][number]) => snapshot?.rooms.find((x) => x.id === r.hueRoomId)?.name ?? (r.name || 'Room');

  // Preview at the widget's real size, shrunk to fit the screen if needed.
  const k = Math.min(1, (width - 48) / widgetInfo.width);
  const pw = Math.round(widgetInfo.width * k);
  const ph = Math.round(widgetInfo.height * k);
  const plan = widgetPlan(map, settings);

  const save = async () => {
    await saveWidgetSettings(widgetInfo.widgetId, settings);
    renderWidget(await render(widgetInfo, { snapshot, stale: false }));
    setResult('ok');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }} contentContainerStyle={{ padding: 24, paddingTop: 56, gap: 22 }}>
      <Display size={30}>Map widget</Display>
      <View style={{ alignItems: 'center' }}>
        {/* Key: the native preview is drawn once, so redraw it when anything changes. */}
        <WidgetPreview
          key={JSON.stringify(settings)}
          width={pw}
          height={ph}
          renderWidget={() => <MapWidget snapshot={snapshot} plan={plan} width={pw} height={ph} stale={false} />}
        />
      </View>

      <View style={{ gap: 10 }}>
        <Label tone="label">Show</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Choice label="Whole home" chosen={!chosen.length} onPress={() => setSettings({ ...settings, roomIds: [] })} />
          {rooms.map((r) => (
            <Choice key={r.id} label={roomName(r)} chosen={chosen.includes(r.id)} onPress={() => toggleRoom(r.id)} />
          ))}
        </View>
        <Txt size={12} tone="muted">
          Pick a few rooms for a closer map with bigger targets. Add several widgets for different parts of the home.
        </Txt>
      </View>

      <View style={{ gap: 10 }}>
        <Label tone="label">Orientation</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Choice label="Like the app" chosen={settings.rotation === undefined} onPress={() => setSettings({ ...settings, rotation: undefined })} />
          <Choice label="Turn left" onPress={() => turn(-90)} />
          <Choice label="Turn right" onPress={() => turn(90)} />
        </View>
      </View>

      <View style={{ gap: 10, marginTop: 8 }}>
        <PillButton title="Save" kind="primary" onPress={save} />
        <PillButton title="Cancel" kind="text" onPress={() => setResult('cancel')} />
      </View>
    </ScrollView>
  );
}
