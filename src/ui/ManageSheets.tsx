import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import {
  createRoom,
  createZone,
  deleteRoom,
  deleteZone,
  moveDeviceToRoom,
  removeDeviceFromRoom,
  ROOM_ARCHETYPES,
  updateRoom,
  updateZone,
  type Light,
  type Room,
  type Snapshot,
  type Zone,
} from '../lib/hue/client';
import { lightTypeLabel } from '../lib/lights';
import { PillButton } from './controls';
import { LightMarker } from './FloorPlan';
import { Icon } from './icons';
import { Field, ModalSheet } from './ModalSheet';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

/** What a room or group sheet edits. `new-room` / `new-group` create one. */
export type Editing = { kind: 'room'; room: Room } | { kind: 'group'; zone: Zone } | { kind: 'new-room' } | { kind: 'new-group' };

/**
 * Create, rename, reshape and delete rooms and groups (Hue rooms and zones), on the bridge.
 * A light belongs to one room at most; a group can take lights from any rooms.
 */
export function ManageSheet({ editing, snapshot, onClose, onSaved }: { editing: Editing; snapshot: Snapshot; onClose: () => void; onSaved: () => void }) {
  const isRoom = editing.kind === 'room' || editing.kind === 'new-room';
  const existing = editing.kind === 'room' ? editing.room : editing.kind === 'group' ? editing.zone : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [archetype, setArchetype] = useState(existing?.archetype ?? (isRoom ? 'living_room' : 'other'));
  const [picked, setPicked] = useState<string[]>(existing?.lightIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomOf = (l: Light) => snapshot.rooms.find((r) => r.lightIds.includes(l.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const what = isRoom ? 'room' : 'group';

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
      onClose();
    } catch (e) {
      setError(`The bridge refused: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return setError(`Give the ${what} a name.`);
    run(async () => {
      if (isRoom) {
        const roomId = existing?.id ?? (await createRoom(trimmed, archetype));
        if (existing && (trimmed !== existing.name || archetype !== existing.archetype)) await updateRoom(roomId, { name: trimmed, archetype });
        const before = existing?.lightIds ?? [];
        // Rooms hold devices: moving a light moves its device (and takes it out of its old room).
        for (const l of snapshot.lights) {
          if (picked.includes(l.id) && !before.includes(l.id)) await moveDeviceToRoom(l.deviceId, roomId);
          if (!picked.includes(l.id) && before.includes(l.id)) await removeDeviceFromRoom(l.deviceId);
        }
      } else if (existing) {
        await updateZone(existing.id, { name: trimmed, archetype, lightIds: picked });
      } else {
        await createZone(trimmed, archetype, picked);
      }
    });
  };

  const remove = () =>
    existing &&
    Alert.alert(`Delete ${existing.name}?`, isRoom ? 'Its lights stay, in no room.' : 'Its lights stay where they are.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => (isRoom ? deleteRoom(existing.id) : deleteZone(existing.id))) },
    ]);

  const title = existing ? `Edit ${existing.name}` : isRoom ? 'New room' : 'New group';

  return (
    <ModalSheet visible title={title} onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} placeholder={isRoom ? 'Living room' : 'Downstairs'} />
      <View style={{ gap: 8 }}>
        <Label>Type</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ROOM_ARCHETYPES.map((a) => (
            <Chip key={a.id} label={a.label} on={archetype === a.id} onPress={() => setArchetype(a.id)} />
          ))}
        </View>
      </View>
      <View>
        <Label>{isRoom ? 'Lights in this room' : 'Lights in this group'}</Label>
        {!isRoom && (
          <Txt size={12} tone="muted" style={{ marginTop: 4 }}>
            A group can mix lights from several rooms.
          </Txt>
        )}
        <View style={{ marginTop: 6 }}>
          {snapshot.lights.map((l) => {
            const on = picked.includes(l.id);
            const elsewhere = isRoom && !on ? roomOf(l) : undefined;
            const sub = elsewhere && elsewhere.id !== existing?.id ? `${lightTypeLabel(l)} · in ${elsewhere.name}` : lightTypeLabel(l);
            return (
              <Pressable
                key={l.id}
                onPress={() => toggle(l.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={l.name}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, borderTopWidth: 1, borderTopColor: hairline(0.08), opacity: pressed ? 0.6 : 1 })}
              >
                <LightMarker light={l} size={24} ground={color.sheet} glow={false} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={14} numberOfLines={1} style={{ lineHeight: 18 }}>
                    {l.name}
                  </Txt>
                  <Txt size={12} tone="muted" numberOfLines={1} style={{ lineHeight: 16 }}>
                    {sub}
                  </Txt>
                </View>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
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
          })}
        </View>
        {isRoom && (
          <Txt size={12} tone="muted" style={{ marginTop: 6 }}>
            A light is in one room only: adding it here takes it out of its other room.
          </Txt>
        )}
      </View>
      {error && (
        <Txt size={13} style={{ color: color.error }}>
          {error}
        </Txt>
      )}
      <PillButton title={busy ? 'Saving…' : existing ? 'Save' : `Create ${what}`} kind="primary" disabled={busy} onPress={save} />
      {existing && <PillButton title={`Delete ${what}`} kind="text" disabled={busy} onPress={remove} />}
    </ModalSheet>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: on ? color.champagne : hairline(0.16),
        backgroundColor: on ? color.selected : 'transparent',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Txt size={13} tone={on ? 'ivory' : 'secondary'} style={{ lineHeight: 17 }}>
        {label}
      </Txt>
    </Pressable>
  );
}
