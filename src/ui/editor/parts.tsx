import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createRoom, ROOM_ARCHETYPES, type Light, type Room } from '../../lib/hue/client';
import { PillButton } from '../controls';
import { LightMarker } from '../FloorPlan';
import { Icon, type IconName } from '../icons';
import { Choice } from '../scan/parts';
import { Label, Txt } from '../text';
import { color, font, hairline } from '../theme';

/** Round hairline button with one icon; dims when disabled. */
export function RoundButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: hairline(0.16),
        backgroundColor: 'rgba(5,5,6,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={16} />
    </Pressable>
  );
}

/** The editor's top bar: back, the screen's name, turn and undo. */
export function EditorTop({ onBack, onTurn, onUndo, canUndo }: { onBack: () => void; onTurn: () => void; onUndo: () => void; canUndo: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 24, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <RoundButton icon="back" label="Done" onPress={onBack} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Label tone="label">Edit map</Label>
      </View>
      <RoundButton icon="rotate" label="Turn the map a quarter turn right" onPress={onTurn} />
      <RoundButton icon="undo" label="Undo" onPress={onUndo} disabled={!canUndo} />
    </View>
  );
}

/** The bottom panel under the plan: a sheet with a grab line, what's selected and what to do with it. */
export function EditorSheet({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: color.sheet,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderTopWidth: 1,
        borderColor: hairline(0.1),
        paddingTop: 22,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 18,
        gap: 14,
      }}
    >
      <View style={{ position: 'absolute', top: 10, alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: hairline(0.2) }} />
      {children}
    </View>
  );
}

/** A sheet's title row: an optional mark, a name in Jost, a line under it, and a close button. */
export function SheetTitle({ mark, title, sub, onClose }: { mark?: ReactNode; title: string; sub?: string; onClose?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {mark}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={19} numberOfLines={1} style={{ fontFamily: font.display, lineHeight: 24 }}>
          {title}
        </Txt>
        {sub ? (
          <Txt size={12} tone="muted" numberOfLines={1} style={{ lineHeight: 16 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {onClose && <RoundButton icon="close" label="Done" onPress={onClose} />}
    </View>
  );
}

/** A light to place: its marker (as on the map), its name, a check when it's already on the map. */
export function LightChip({ light, placed, onPress }: { light: Light; placed: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${light.name}${placed ? ', on the map' : ''}`}
      style={({ pressed }) => ({
        height: 44,
        paddingLeft: 8,
        paddingRight: 15,
        borderRadius: 22,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        borderWidth: 1,
        borderStyle: placed ? 'solid' : 'dashed',
        borderColor: placed ? hairline(0.16) : 'rgba(233,207,159,0.45)',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <LightMarker light={light} size={26} ground={color.sheet} glow={false} />
      <Txt size={14} style={{ lineHeight: 18 }}>
        {light.name}
      </Txt>
      {placed && <Icon name="check" size={13} tint={color.muted} stroke={1.8} />}
    </Pressable>
  );
}

/** Lights to place, in a row: the ones not on the map first, with a dashed edge. */
export function LightRow({ lights, placed, onPick }: { lights: Light[]; placed: Set<string>; onPick: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}>
      {lights.map((l) => (
        <LightChip key={l.id} light={l} placed={placed.has(l.id)} onPress={() => onPick(l.id)} />
      ))}
    </ScrollView>
  );
}

export type RoomChoice = { name: string; hueRoomId: string | null };

/**
 * Which Hue room an outline is. Works on a fresh bridge too: "New room" creates the room on the
 * bridge, and "Other space" is for places without lights.
 */
export function RoomPicker({
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
      setCreating(false);
    } catch (e) {
      setError(`Couldn't create the room: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <View style={{ gap: 12 }}>
        <TextInput
          value={name}
          onChangeText={(t) => {
            setName(t);
            setError(null);
          }}
          placeholder="Living room"
          placeholderTextColor={color.muted}
          autoFocus
          style={{ color: color.ivory, fontFamily: font.display, fontSize: 22, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: hairline(0.24) }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}>
          {ROOM_ARCHETYPES.map((a) => (
            <Choice key={a.id} label={a.label} chosen={archetype === a.id} onPress={() => setArchetype(a.id)} />
          ))}
        </ScrollView>
        {error && (
          <Txt size={13} style={{ color: color.error }}>
            {error}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <PillButton title="Cancel" kind="text" height={44} onPress={() => setCreating(false)} />
          <PillButton title={busy ? 'Creating' : 'Create room'} kind="primary" height={44} style={{ flex: 1 }} disabled={busy} onPress={create} />
          {busy && <ActivityIndicator color={color.champagne} />}
        </View>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}>
      {rooms.map((r) => (
        <Choice key={r.id} label={r.name} chosen={current === r.id} onPress={() => onAssign({ name: r.name, hueRoomId: r.id })} />
      ))}
      <Choice label="Other space" dashed chosen={current === null} onPress={() => onAssign({ name: 'Other', hueRoomId: null })} />
      <Choice label="+ New room" dashed onPress={() => setCreating(true)} />
    </ScrollView>
  );
}
