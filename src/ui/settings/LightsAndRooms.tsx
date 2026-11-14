import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useHome } from '../../lib/hue/useHome';
import { PillButton, Section } from '../controls';
import { SettingsRow, useSectionReady } from './parts';

/**
 * Settings → Lights and rooms: every room, group and light, each opening its own screen, where it
 * can be renamed (the name is written to the bridge) and set up. Lights are folded away: a home can
 * have fifty.
 */
export function LightsAndRooms() {
  const router = useRouter();
  const { snapshot } = useHome(15_000);
  const [showLights, setShowLights] = useState(false);
  useSectionReady(!!snapshot);
  if (!snapshot) return null;

  const count = (n: number) => `${n} ${n === 1 ? 'light' : 'lights'}`;
  const roomName = (id: string | null) => snapshot.rooms.find((r) => r.id === id)?.name ?? 'On its own';
  const lights = [...snapshot.lights].sort((a, b) => roomName(a.roomId).localeCompare(roomName(b.roomId)) || a.name.localeCompare(b.name));

  return (
    <Section title="Lights and rooms">
      <View>
        {snapshot.rooms.map((r) => (
          <SettingsRow key={r.id} icon="rooms" title={r.name} sub={`Room · ${count(r.lightIds.length)}`} onPress={() => router.push(`/room/${r.id}`)} />
        ))}
        {(snapshot.zones ?? []).map((z) => (
          <SettingsRow key={z.id} icon="rooms" title={z.name} sub={`Group · ${count(z.lightIds.length)}`} onPress={() => router.push(`/room/${z.id}`)} />
        ))}
        {showLights &&
          lights.map((l) => (
            <SettingsRow
              key={l.id}
              icon="light"
              title={l.name}
              sub={`${roomName(l.roomId)}${l.reachable ? '' : ' · unreachable'}`}
              onPress={() => router.push(`/light/${l.id}`)}
            />
          ))}
        <PillButton
          title={showLights ? 'Hide the lights' : `Show all ${count(snapshot.lights.length)}`}
          kind="text"
          height={40}
          onPress={() => setShowLights(!showLights)}
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
        />
      </View>
    </Section>
  );
}
