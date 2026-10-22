import Constants from 'expo-constants';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { requestPinWidget } from 'react-native-android-widget';

import { setRoomBrightness, toggleLight, toggleRoom } from '../lib/actions';
import { getBridge, syncFastConfig } from '../lib/hue/bridge';
import { cachedSnapshot, roomIsOn, type Light } from '../lib/hue/client';
import { useSnapshot } from '../lib/hue/useSnapshot';
import { Body, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { refreshAllWidgets } from '../widgets/task-handler';

export default function Home() {
  const [paired, setPaired] = useState<boolean | null>(null);
  useEffect(() => {
    getBridge().then((b) => setPaired(!!b));
    syncFastConfig().catch(() => null);
  }, []);
  if (paired === null) return null;
  if (!paired) return <Redirect href="/pair" />;
  return <Rooms />;
}

function Rooms() {
  const { snapshot, setSnapshot, error, refresh } = useSnapshot();

  async function run(action: () => Promise<unknown>) {
    const pending = action();
    // Show the optimistic state right away.
    setTimeout(() => cachedSnapshot().then((s) => s && setSnapshot(s)), 30);
    try {
      await pending;
    } finally {
      await refresh();
      refreshAllWidgets();
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Map" primary style={{ flex: 1 }} onPress={() => router.push('/map')} />
        <Button title="Scan (AR)" style={{ flex: 1 }} onPress={() => router.push('/scan')} />
        <Button title="Edit map" style={{ flex: 1 }} onPress={() => router.push('/editor')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Add rooms widget" style={{ flex: 1 }} onPress={() => requestPinWidget({ widgetName: 'Rooms' }).catch(() => null)} />
        <Button title="Add map widget" style={{ flex: 1 }} onPress={() => requestPinWidget({ widgetName: 'Map' }).catch(() => null)} />
      </View>

      {error && <Text style={{ color: theme.danger }}>Can't reach the bridge: {error}</Text>}
      {!snapshot && !error && <Body muted>Loading…</Body>}

      {snapshot?.rooms.map((room) => {
        const lights = snapshot.lights.filter((l) => room.lightIds.includes(l.id));
        const on = roomIsOn(room, snapshot.lights);
        const dimmable = lights.some((l) => l.brightness !== null);
        return (
          <View key={room.id} style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 14, gap: 10 }}>
            <Pressable onPress={() => run(() => toggleRoom(room.id))} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600', flex: 1 }}>{room.name}</Text>
              <Toggle on={on} />
            </Pressable>
            {dimmable && (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[10, 40, 70, 100].map((b) => (
                  <Button key={b} title={`${b}%`} style={{ flex: 1, minHeight: 40 }} onPress={() => run(() => setRoomBrightness(room.id, b))} />
                ))}
              </View>
            )}
            {lights.map((l) => (
              <LightRow key={l.id} light={l} onPress={() => run(() => toggleLight(l.id))} />
            ))}
          </View>
        );
      })}

      <Text style={{ color: theme.muted, textAlign: 'center', marginTop: 8 }}>hue-lab {Constants.expoConfig?.version}</Text>
    </ScrollView>
  );
}

function LightRow({ light, onPress }: { light: Light; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: light.on ? light.color : 'transparent',
          borderWidth: light.on ? 0 : 2,
          borderColor: theme.muted,
          opacity: light.reachable ? 1 : 0.4,
        }}
      />
      <Text style={{ color: theme.text, fontSize: 15, flex: 1 }}>{light.name}</Text>
      <Text style={{ color: theme.muted, fontSize: 13 }}>
        {!light.reachable ? 'Unreachable' : !light.on ? 'Off' : light.brightness === null ? 'On' : `${light.brightness}%`}
      </Text>
    </Pressable>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <View style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: on ? theme.text : theme.surface2, padding: 3, alignItems: on ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: on ? theme.bg : theme.muted }} />
    </View>
  );
}
