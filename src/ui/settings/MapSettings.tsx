import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { loadMap, resetMap, type HomeMap } from '../../lib/map/map';
import { refreshAllWidgets } from '../../widgets/task-handler';
import { PillButton, Section } from '../controls';
import { SettingsRow } from './parts';

/** Settings → Map: what's on it, scan or edit it, or start over. */
export function MapSettings() {
  const router = useRouter();
  const [map, setMap] = useState<HomeMap | null | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      loadMap().then(setMap);
    }, []),
  );
  if (map === undefined) return null;

  const rooms = map?.rooms.filter((r) => r.points.length >= 3).length ?? 0;
  const sub = map
    ? `${rooms} ${rooms === 1 ? 'room' : 'rooms'} · ${map.lights.length} ${map.lights.length === 1 ? 'light' : 'lights'} placed · changed ${new Date(map.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
    : 'No map yet: scan your home with the camera, or draw it.';

  const reset = () =>
    Alert.alert('Start the map over?', 'Your rooms and where your lights are on the map are deleted from this phone. Your lights, rooms and moods stay as they are.', [
      { text: 'Keep the map', style: 'cancel' },
      {
        text: 'Delete the map',
        style: 'destructive',
        onPress: async () => {
          await resetMap();
          setMap(null);
          refreshAllWidgets().catch(() => null);
        },
      },
    ]);

  return (
    <Section title="Map">
      <View>
        <SettingsRow icon="map" title={map ? 'Your home' : 'No map'} sub={sub} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 }}>
          <PillButton title={map ? 'Scan more' : 'Scan with camera'} icon="scan" height={40} onPress={() => router.push('/scan')} />
          <PillButton title={map ? 'Edit on screen' : 'Draw it myself'} icon="edit" height={40} onPress={() => router.push('/editor')} />
          {map && <PillButton title="Start over" kind="text" height={40} onPress={reset} />}
        </View>
      </View>
    </Section>
  );
}
