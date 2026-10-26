import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { createRoom, type Light, type Room } from '../../lib/hue/client';
import { lightShape, lightTypeLabel } from '../../lib/lights';
import { PillButton, Switch } from '../controls';
import { Jewel } from '../FloorPlan';
import { Icon } from '../icons';
import { Display, Label, Txt } from '../text';
import { color, font, hairline } from '../theme';
import { Choice, Sheet } from './parts';

export type RoomNaming = { name: string; hueRoomId: string | null; outdoor: boolean };

const OUTDOOR_HINT = ['terrace', 'balcony', 'garden', 'porch', 'terrasse', 'balcon', 'jardin'];

/**
 * Name the room just traced: one of the Hue rooms, "Other space" (no lights), or a typed name.
 * A typed name can be created as a room in Hue, so a fresh bridge gets set up from here.
 */
export function NameSheet({
  rooms,
  lights,
  title,
  meta,
  onDone,
  onRoomCreated,
}: {
  rooms: Room[];
  lights: Light[];
  title: string;
  meta: string;
  onDone: (n: RoomNaming) => void;
  onRoomCreated: () => void;
}) {
  const [chosen, setChosen] = useState<string | 'other' | null>(null);
  const [typed, setTyped] = useState('');
  const [outdoor, setOutdoor] = useState<boolean | null>(null);
  const [inHue, setInHue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === chosen);
  const name = typed.trim() || (room ? room.name : chosen === 'other' ? 'Other space' : '');
  const guessOutdoor = OUTDOOR_HINT.some((w) => name.toLowerCase().includes(w)) || ['terrace', 'balcony', 'garden'].includes(room?.archetype ?? '');
  const isOutdoor = outdoor ?? guessOutdoor;
  const count = room ? lights.filter((l) => l.roomId === room.id).length : null;
  const hint = count === null ? (typed.trim() && inHue ? 'New room in Hue' : '') : count === 0 ? 'No lights to place' : count === 1 ? '1 light to place' : `${count} lights to place`;

  async function done() {
    if (!name) return;
    if (typed.trim() && inHue) {
      setBusy(true);
      setError(null);
      try {
        const id = await createRoom(typed.trim(), isOutdoor ? 'terrace' : 'other');
        onRoomCreated();
        onDone({ name: typed.trim(), hueRoomId: id, outdoor: isOutdoor });
      } catch (e) {
        setError(`Couldn't create the room in Hue: ${e}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    onDone({ name, hueRoomId: room?.id ?? null, outdoor: isOutdoor });
  }

  return (
    <Sheet>
      <Label tone="label" style={{ marginTop: 6 }}>
        {meta}
      </Label>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
        <Display size={24}>{title}</Display>
        <Txt size={12} tone="muted">
          {hint}
        </Txt>
      </View>
      <ScrollView style={{ maxHeight: 150, marginTop: 14 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {rooms.map((r) => (
          <Choice
            key={r.id}
            label={r.name}
            chosen={!typed.trim() && chosen === r.id}
            onPress={() => {
              setChosen(r.id);
              setTyped('');
              setOutdoor(null);
            }}
          />
        ))}
        <Choice
          label="Other space"
          dashed
          chosen={!typed.trim() && chosen === 'other'}
          onPress={() => {
            setChosen('other');
            setTyped('');
          }}
        />
      </ScrollView>
      <Txt size={12} tone="secondary" style={{ marginTop: 16 }}>
        Or type a name
      </Txt>
      <TextInput
        value={typed}
        onChangeText={(t) => {
          setTyped(t);
          setError(null);
        }}
        placeholder="Entrée"
        placeholderTextColor={color.muted}
        autoCorrect={false}
        style={{ height: 48, marginTop: 8, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: hairline(0.16), backgroundColor: color.card, color: color.ivory, fontFamily: font.ui, fontSize: 15 }}
      />
      {typed.trim().length > 0 && (
        <ToggleRow title="Add it to Hue as a room" sub="So its lights can be switched together" on={inHue} onToggle={() => setInHue(!inHue)} />
      )}
      <ToggleRow title="Outdoor space" sub="Drawn with an open, dashed edge on the map" on={isOutdoor} onToggle={() => setOutdoor(!isOutdoor)} />
      {error && (
        <Txt size={13} style={{ color: color.error, marginTop: 6 }}>
          {error}
        </Txt>
      )}
      <View style={{ marginTop: 12 }}>{busy ? <ActivityIndicator color={color.champagne} style={{ height: 52 }} /> : <PillButton title="Continue" kind="primary" disabled={!name} onPress={done} />}</View>
    </Sheet>
  );
}

function ToggleRow({ title, sub, on, onToggle }: { title: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 56, marginTop: 12, borderTopWidth: 1, borderTopColor: hairline(0.1) }}>
      <View style={{ flex: 1 }}>
        <Txt size={15} style={{ lineHeight: 20 }}>
          {title}
        </Txt>
        <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
          {sub}
        </Txt>
      </View>
      <Switch big on={on} label={title} onToggle={onToggle} />
    </View>
  );
}

export type LightRowState = 'active' | 'activePlaced' | 'placed' | 'skipped' | 'idle';

/** Pick a light (it blinks), point at it, Place. Placing again moves it. */
export function LightsSheet({
  title,
  rows,
  placedCount,
  canPlace,
  onPick,
  onSkip,
  onPlace,
  onDone,
  doneLabel,
  moreLabel,
  onMore,
}: {
  title: string;
  rows: { light: Light; state: LightRowState }[];
  placedCount: number;
  canPlace: boolean;
  onPick: (l: Light) => void;
  onSkip: () => void;
  onPlace: () => void;
  onDone: () => void;
  doneLabel: string;
  moreLabel?: string;
  onMore?: () => void;
}) {
  const active = rows.find((r) => r.state === 'active' || r.state === 'activePlaced');
  return (
    <Sheet>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
        <Display size={24} numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Display>
        <Txt size={12} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {placedCount} of {rows.length} placed
        </Txt>
      </View>
      <ScrollView style={{ maxHeight: 236, marginTop: 10, marginHorizontal: -12 }} contentContainerStyle={{ gap: 2 }}>
        {rows.length === 0 && (
          <Txt size={13} tone="secondary" style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            No lights here yet.
          </Txt>
        )}
        {rows.map(({ light, state }) => {
          const isActive = state === 'active' || state === 'activePlaced';
          const status =
            state === 'activePlaced'
              ? 'Blinking · place again to move it'
              : state === 'active'
                ? 'Blinking now · point at it'
                : state === 'placed'
                  ? 'Placed · tap to move it'
                  : state === 'skipped'
                    ? 'Skipped · place it later'
                    : `${lightTypeLabel(light)} · tap to blink`;
          return (
            <Pressable
              key={light.id}
              onPress={() => onPick(light)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${light.name}, ${status}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                height: 56,
                paddingHorizontal: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: isActive ? 'rgba(233,207,159,0.38)' : 'transparent',
                backgroundColor: isActive ? 'rgba(233,207,159,0.07)' : 'transparent',
              }}
            >
              <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                <Jewel light={light} shape={lightShape(light.archetype)} ground={color.sheet} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Display size={16} weight={400} numberOfLines={1} style={{ lineHeight: 20 }}>
                  {light.name}
                </Display>
                <Txt size={12} numberOfLines={1} style={{ lineHeight: 16, color: isActive ? color.champagne : state === 'placed' ? color.secondary : color.muted }}>
                  {status}
                </Txt>
              </View>
              {state === 'placed' && <Icon name="target" size={14} tint={color.secondary} />}
              {state === 'idle' && (
                <Txt size={12} tone="secondary">
                  Blink
                </Txt>
              )}
            </Pressable>
          );
        })}
        {moreLabel && onMore && (
          <Pressable onPress={onMore} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
            <Txt size={13} tone="champagne">
              {moreLabel}
            </Txt>
          </Pressable>
        )}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <Pressable onPress={onSkip} disabled={!active} style={{ width: 88, height: 56, alignItems: 'center', justifyContent: 'center', opacity: active ? 1 : 0.35 }}>
          <Txt>Skip</Txt>
        </Pressable>
        <PillButton
          title={active ? (active.state === 'activePlaced' ? 'Move it here' : 'Place it here') : 'Pick a light'}
          kind="primary"
          icon="target"
          height={56}
          disabled={!active || !canPlace}
          onPress={onPlace}
          style={{ flex: 1 }}
        />
      </View>
      <PillButton title={doneLabel} height={48} onPress={onDone} style={{ marginTop: 10 }} />
    </Sheet>
  );
}
