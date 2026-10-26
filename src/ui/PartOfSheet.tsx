import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Planned } from '../lib/actions';
import { createRoom, moveDeviceToRoom, removeDeviceFromRoom, updateZone, type Light, type Snapshot } from '../lib/hue/client';
import { PillButton } from './controls';
import { Icon } from './icons';
import { Field, ModalSheet } from './ModalSheet';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

type Act = (plan: (s: Snapshot) => Planned | null) => void;

/**
 * "Part of": which room a light is in (one at most) and which groups it belongs to (any).
 * Each tap is applied at once, on screen first, then on the bridge.
 */
export function PartOfSheet({ light, snapshot, act, onClose }: { light: Light; snapshot: Snapshot; act: Act; onClose: () => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = snapshot.rooms.find((r) => r.lightIds.includes(light.id));

  const moveTo = (roomId: string | null) => {
    if (roomId === (room?.id ?? null)) return;
    act((s) => ({
      next: {
        ...s,
        rooms: s.rooms.map((r) => ({ ...r, lightIds: r.id === roomId ? [...r.lightIds.filter((id) => id !== light.id), light.id] : r.lightIds.filter((id) => id !== light.id) })),
        lights: s.lights.map((l) => (l.id === light.id ? { ...l, roomId } : l)),
      },
      send: () => (roomId ? moveDeviceToRoom(light.deviceId, roomId) : removeDeviceFromRoom(light.deviceId)),
    }));
  };

  const toggleGroup = (zoneId: string) =>
    act((s) => {
      const zone = s.zones?.find((z) => z.id === zoneId);
      if (!zone) return null;
      const lightIds = zone.lightIds.includes(light.id) ? zone.lightIds.filter((id) => id !== light.id) : [...zone.lightIds, light.id];
      return { next: { ...s, zones: s.zones!.map((z) => (z.id === zoneId ? { ...z, lightIds } : z)) }, send: () => updateZone(zoneId, { lightIds }) };
    });

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the room a name.');
    setBusy(true);
    setError(null);
    try {
      const id = await createRoom(trimmed, 'other');
      act((s) => ({
        next: { ...s, rooms: [...s.rooms.map((r) => ({ ...r, lightIds: r.lightIds.filter((x) => x !== light.id) })), { id, name: trimmed, archetype: 'other', groupedLightId: null, lightIds: [light.id] }], lights: s.lights.map((l) => (l.id === light.id ? { ...l, roomId: id } : l)) },
        send: () => moveDeviceToRoom(light.deviceId, id),
      }));
      setCreating(false);
      setName('');
    } catch (e) {
      setError(`Couldn't create the room: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const zones = snapshot.zones ?? [];

  return (
    <ModalSheet visible title="Part of" onClose={onClose}>
      <View>
        <Label>Room</Label>
        <Txt size={12} tone="muted" style={{ marginTop: 4 }}>
          A light is in one room at most. It can also stay on its own.
        </Txt>
        <View style={{ marginTop: 6 }}>
          {snapshot.rooms.map((r) => (
            <Row key={r.id} title={r.name} sub={count(r.lightIds.filter((id) => id !== light.id).length, 'other light')} on={room?.id === r.id} radio onPress={() => moveTo(r.id)} />
          ))}
          <Row title="No room" sub="On its own, still in groups and moods" on={!room} radio onPress={() => moveTo(null)} />
          {creating ? (
            <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: hairline(0.08) }}>
              <Field label="New room" value={name} onChange={setName} placeholder="Office" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <PillButton title="Cancel" kind="text" onPress={() => setCreating(false)} style={{ flex: 1 }} />
                <PillButton title={busy ? 'Creating…' : `Create and move`} kind="primary" disabled={busy} onPress={create} style={{ flex: 2 }} />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setCreating(true)}
              accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderTopWidth: 1, borderTopColor: hairline(0.08), opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name="add" size={16} tint={color.champagne} />
              <Txt size={14} tone="champagne">
                New room
              </Txt>
            </Pressable>
          )}
        </View>
      </View>

      <View>
        <Label>Groups</Label>
        <Txt size={12} tone="muted" style={{ marginTop: 4 }}>
          {zones.length ? 'Any number, across rooms.' : 'No groups yet. Make one from the Rooms tab (+).'}
        </Txt>
        <View style={{ marginTop: 6 }}>
          {zones.map((z) => (
            <Row key={z.id} title={z.name} sub={count(z.lightIds.filter((id) => id !== light.id).length, 'other light')} on={z.lightIds.includes(light.id)} onPress={() => toggleGroup(z.id)} />
          ))}
        </View>
      </View>

      {error && (
        <Txt size={13} style={{ color: color.error }}>
          {error}
        </Txt>
      )}
      {room && (
        <PillButton
          title={`Open ${room.name}`}
          icon="chevronRight"
          onPress={() => {
            onClose();
            router.push(`/room/${room.id}`);
          }}
        />
      )}
      <PillButton title="Done" kind="primary" onPress={onClose} />
    </ModalSheet>
  );
}

const count = (n: number, what: string) => (n === 0 ? `No ${what}s` : `${n} ${what}${n === 1 ? '' : 's'}`);

function Row({ title, sub, on, radio, onPress }: { title: string; sub: string; on: boolean; radio?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={radio ? { selected: on } : { checked: on }}
      accessibilityLabel={title}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, borderTopWidth: 1, borderTopColor: hairline(0.08), opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={14} numberOfLines={1} style={{ lineHeight: 18 }}>
          {title}
        </Txt>
        <Txt size={12} tone="muted" numberOfLines={1} style={{ lineHeight: 16 }}>
          {sub}
        </Txt>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radio ? 11 : 7,
          borderWidth: 1,
          borderColor: on ? color.champagne : hairline(0.3),
          backgroundColor: on ? color.champagne : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on && <Icon name="check" size={12} tint={color.onChampagne} stroke={2.2} />}
      </View>
    </Pressable>
  );
}
