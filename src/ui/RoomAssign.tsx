import { useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';

import { createRoom, ROOM_ARCHETYPES, type Room } from '../lib/hue/client';
import { Button, Chip } from './components';
import { theme } from './theme';

export type RoomChoice = { name: string; hueRoomId: string | null };

/**
 * Picks which Hue room an outline is. Works on a fresh bridge too: "New room" creates
 * the room on the bridge, and "Other space" is for places without lights.
 */
export function RoomAssign({
  rooms,
  current,
  onAssign,
  onRoomCreated,
}: {
  rooms: Room[];
  current?: string | null;
  onAssign: (choice: RoomChoice) => void;
  /** Called after a room is created on the bridge, so the caller can refresh its snapshot. */
  onRoomCreated?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [archetype, setArchetype] = useState<string>('living_room');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name for the room.');
    setBusy(true);
    setError(null);
    try {
      const id = await createRoom(trimmed, archetype);
      onRoomCreated?.();
      onAssign({ name: trimmed, hueRoomId: id });
    } catch (e) {
      setError(`Couldn't create the room: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <View style={{ gap: 10 }}>
        <TextInput
          value={name}
          onChangeText={(t) => {
            setName(t);
            setError(null);
          }}
          placeholder="Living room"
          placeholderTextColor={theme.muted}
          autoFocus
          style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: theme.text, borderRadius: 12, paddingHorizontal: 14, minHeight: 46, fontSize: 16 }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ROOM_ARCHETYPES.map((a) => (
            <Chip key={a.id} label={a.label} active={archetype === a.id} onPress={() => setArchetype(a.id)} />
          ))}
        </View>
        {error && <Text style={{ color: theme.danger }}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Cancel" style={{ flex: 1 }} onPress={() => setCreating(false)} />
          <Button title={busy ? 'Creating…' : 'Create room'} primary style={{ flex: 2 }} disabled={busy} onPress={create} />
        </View>
        {busy && <ActivityIndicator color={theme.text} />}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {rooms.map((r) => (
        <Chip key={r.id} label={r.name} active={current === r.id} onPress={() => onAssign({ name: r.name, hueRoomId: r.id })} />
      ))}
      <Chip label="+ New room" onPress={() => setCreating(true)} />
      <Chip label="Other space" active={current === null} onPress={() => onAssign({ name: 'Other', hueRoomId: null })} />
    </View>
  );
}
