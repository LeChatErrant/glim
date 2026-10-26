import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { planAll, planRoomBrightness, planToggleLight, planToggleRoom, planToggleZone, type Planned } from '../../lib/actions';
import { roomIsOn, type Light, type Room, type Snapshot, type Zone } from '../../lib/hue/client';
import { useHome } from '../../lib/hue/useHome';
import { isLit, lightLevel, lightShape, lightsOf, lightTypeLabel } from '../../lib/lights';
import { nestedRooms } from '../../lib/map/glow';
import { loadMap, type HomeMap } from '../../lib/map/map';
import { ConnectionBadge, Glow, IconButton, PillButton, Slider, Switch } from '../../ui/controls';
import { Jewel, LightMarker } from '../../ui/FloorPlan';
import { Icon } from '../../ui/icons';
import { useThrottle } from '../../ui/LightControls';
import { ManageSheet, type Editing } from '../../ui/ManageSheets';
import { ModalSheet } from '../../ui/ModalSheet';
import { ChoiceRow } from '../../ui/scan/parts';
import { Display, Label, Txt } from '../../ui/text';
import { color, hairline, TAB_BAR_SPACE } from '../../ui/theme';

const OUTDOOR_ARCHETYPES = ['terrace', 'balcony', 'garden', 'porch', 'driveway', 'carport', 'pool', 'front_door', 'backyard'];

type Act = (plan: (s: Snapshot) => Planned | null) => void;

export default function RoomsScreen() {
  const insets = useSafeAreaInsets();
  const { snapshot, connection, act, refresh } = useHome();
  const [map, setMap] = useState<HomeMap | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadMap().then(setMap);
    }, []),
  );

  const parents = useMemo(() => (snapshot ? nestedRooms(map, snapshot) : new Map<string, string>()), [map, snapshot]);

  if (!snapshot) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 28, paddingHorizontal: 24 }}>
        <Display>Rooms</Display>
        <Txt tone="secondary" style={{ marginTop: 6 }}>
          {connection === 'offline' ? "Can't reach your lights." : 'Looking for your lights…'}
        </Txt>
      </View>
    );
  }

  const lights = snapshot.lights;
  const on = lights.filter(isLit).length;
  const topLevel = snapshot.rooms.filter((r) => !parents.has(r.id));
  const childrenOf = (id: string) => snapshot.rooms.filter((r) => parents.get(r.id) === id);
  const homeless = lights.filter((l) => !snapshot.rooms.some((r) => r.lightIds.includes(l.id)));
  const outdoor = (room: Room) =>
    OUTDOOR_ARCHETYPES.includes(room.archetype) || !!map?.rooms.some((r) => r.hueRoomId === room.id && r.outdoor);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + TAB_BAR_SPACE + 32 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Display>Rooms</Display>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IconButton icon="add" label="New room or group" onPress={() => setAdding(true)} />
            <PillButton title={on ? 'All off' : 'All on'} icon="power" height={40} onPress={() => act((s) => planAll(s, !on))} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <Txt size={14} tone="secondary">
            {on ? (
              <>
                <Text style={{ color: color.champagne }}>{on}</Text> of {lights.length} lights on
              </>
            ) : (
              'All lights off'
            )}
          </Txt>
          <ConnectionBadge state={connection} />
        </View>

        <View style={{ gap: 10, marginTop: 20 }}>
          {topLevel.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              snapshot={snapshot}
              subRooms={childrenOf(room.id)}
              outdoor={outdoor(room)}
              expanded={open === room.id}
              onExpand={() => setOpen(open === room.id ? null : room.id)}
              act={act}
            />
          ))}
          {homeless.length > 0 && <LooseLights lights={homeless} act={act} />}
          {(snapshot.zones ?? []).length > 0 && (
            <Label tone="label" style={{ marginTop: 14 }}>
              Groups
            </Label>
          )}
          {(snapshot.zones ?? []).map((z) => (
            <GroupCard key={z.id} zone={z} snapshot={snapshot} act={act} onEdit={() => setEditing({ kind: 'group', zone: z })} />
          ))}
          {snapshot.rooms.length === 0 && homeless.length === 0 && <Txt tone="secondary">No lights on this bridge yet.</Txt>}
        </View>
      </ScrollView>
      <ModalSheet visible={adding} title="Add" onClose={() => setAdding(false)}>
        <View>
          <ChoiceRow
            icon="rooms"
            title="New room"
            sub="A place in your home. Each light is in one room"
            onPress={() => {
              setAdding(false);
              setEditing({ kind: 'new-room' });
            }}
          />
          <ChoiceRow
            icon="light"
            title="New group"
            sub="Any lights together, across rooms"
            onPress={() => {
              setAdding(false);
              setEditing({ kind: 'new-group' });
            }}
          />
        </View>
      </ModalSheet>
      {editing && <ManageSheet editing={editing} snapshot={snapshot} onClose={() => setEditing(null)} onSaved={refresh} />}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom + 110, experimental_backgroundImage: `linear-gradient(rgba(5,5,6,0), ${color.ground} 66%)` }} />
    </View>
  );
}

function RoomCard({
  room,
  snapshot,
  subRooms,
  outdoor,
  expanded,
  onExpand,
  act,
}: {
  room: Room;
  snapshot: Snapshot;
  subRooms: Room[];
  outdoor: boolean;
  expanded: boolean;
  onExpand: () => void;
  act: Act;
}) {
  const own = lightsOf(room, snapshot);
  const all = [...own, ...subRooms.flatMap((r) => lightsOf(r, snapshot))];
  const lit = all.filter(isLit);
  const anyOn = lit.length > 0;
  const dimmable = all.filter((l) => l.brightness !== null);
  const plugOnly = all.length > 0 && dimmable.length === 0;
  const level = useRoomLevel(dimmable);
  const tints = lit.filter((l) => l.kind !== 'onoff').map((l) => l.color);
  const c1 = tints[0] ?? lit[0]?.color;
  const c2 = tints[1];
  const throttle = useThrottle();
  const { width } = useWindowDimensions();

  const meta = (anyOn ? `${lit.length} of ${all.length} on` : all.length === 1 ? 'Off' : 'All off') + (plugOnly ? (outdoor ? ' · outdoor' : '') : anyOn && level.value ? ` · ${level.value}%` : '');

  const toggleAll = () =>
    act((s) => {
      // A room with sub-rooms: switch them along with it.
      let next: Snapshot = s;
      const sends: (() => Promise<unknown>)[] = [];
      for (const r of [room, ...subRooms]) {
        const p = planToggleRoom(next, r.id, !anyOn);
        if (p) {
          next = p.next;
          sends.push(p.send);
        }
      }
      return sends.length ? { next, send: () => Promise.all(sends.map((f) => f())) } : null;
    });

  return (
    <View style={{ borderRadius: 22, borderWidth: 1, borderColor: hairline(expanded ? 0.14 : 0.1), backgroundColor: color.card, overflow: 'hidden', paddingTop: 12, paddingBottom: plugOnly && !expanded ? 12 : 8, paddingLeft: 18, paddingRight: 10 }}>
      {c1 && <Glow tint={c1} cx={0} cy={0} rx={240} ry={150} alpha={0.11} />}
      {c2 && <Glow tint={c2} cx={width - 48} cy={0} rx={200} ry={130} alpha={0.08} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 2 }}>
        <Pressable
          onPress={() => router.push(`/room/${room.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${room.name}`}
          style={({ pressed }) => ({ flex: 1, minWidth: 0, gap: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 20 }}>
            {room.name}
          </Display>
          <JewelsMeta lights={all} meta={meta} />
        </Pressable>
        {plugOnly && (
          <Txt size={12} tone="muted" style={{ marginRight: 2 }}>
            On/off only
          </Txt>
        )}
        <Pressable
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${expanded ? 'Hide' : 'Show'} lights in ${room.name}`}
          style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        >
          <Icon name="chevronDown" size={14} tint={expanded ? color.champagne : color.muted} stroke={1.6} />
        </Pressable>
        <Switch big on={anyOn} label={`${room.name}, ${anyOn ? 'on' : 'off'}`} onToggle={toggleAll} />
      </View>

      {!plugOnly && dimmable.length > 0 && (
        <Slider
          value={level.shown}
          tint={anyOn ? (c1 ?? color.champagne) : '#5A5650'}
          label={`${room.name} brightness`}
          onChange={(v) => {
            level.setDrag(v);
            throttle(() => act((s) => planRoomBrightness(s, room.id, v)));
          }}
          onCommit={(v) => {
            level.setDrag(null);
            act((s) => planRoomBrightness(s, room.id, v));
          }}
        />
      )}

      {expanded && own.map((l) => <LightRow key={l.id} light={l} act={act} />)}
      {subRooms.map((sub) => (
        <SubRoom key={sub.id} room={sub} snapshot={snapshot} expanded={expanded} act={act} />
      ))}
    </View>
  );
}

/** A Hue room that sits inside another one (a bedside in the bedroom). */
function SubRoom({ room, snapshot, expanded, act }: { room: Room; snapshot: Snapshot; expanded: boolean; act: Act }) {
  const lights = lightsOf(room, snapshot);
  const lit = lights.filter(isLit);
  const on = roomIsOn(room, snapshot.lights);
  const dim = lit.filter((l) => l.brightness !== null);
  const avg = dim.length ? Math.round(dim.reduce((s, l) => s + l.brightness!, 0) / dim.length) : null;
  const meta = on ? `${lit.length} of ${lights.length} on${avg !== null ? ` · ${avg}%` : ''}` : 'All off';
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderTopWidth: 1, borderTopColor: hairline(0.08) }}>
        <TreeGlyph />
        <Pressable
          onPress={() => router.push(`/room/${room.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${room.name}`}
          style={({ pressed }) => ({ flex: 1, minWidth: 0, gap: 5, opacity: pressed ? 0.6 : 1 })}
        >
          <Display size={15} weight={400} numberOfLines={1} style={{ lineHeight: 18 }}>
            {room.name}
          </Display>
          <JewelsMeta lights={lights} meta={meta} />
        </Pressable>
        <Switch on={on} label={`${room.name}, ${on ? 'on' : 'off'}`} onToggle={() => act((s) => planToggleRoom(s, room.id))} />
      </View>
      {expanded && lights.map((l) => <LightRow key={l.id} light={l} act={act} indent={28} />)}
    </>
  );
}

function TreeGlyph() {
  return (
    <View style={{ width: 14, height: 26, marginLeft: 4, alignSelf: 'flex-start' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, width: 8, height: 19, borderLeftWidth: 1, borderBottomWidth: 1, borderBottomLeftRadius: 6, borderColor: hairline(0.24) }} />
    </View>
  );
}

function LightRow({ light, act, indent = 0 }: { light: Light; act: Act; indent?: number }) {
  const on = isLit(light);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderTopWidth: 1, borderTopColor: hairline(0.08), paddingLeft: indent }}>
      <Pressable
        onPress={() => router.push(`/light/${light.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${light.name}`}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
          <LightMarker light={light} size={26} ground={color.card} glow={false} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={14} numberOfLines={1} style={{ lineHeight: 18 }}>
            {light.name}
          </Txt>
          <Txt size={12} tone="muted" numberOfLines={1} style={{ lineHeight: 16 }}>
            {lightTypeLabel(light)}
          </Txt>
        </View>
      </Pressable>
      <Txt size={13} tone={on ? 'secondary' : 'muted'} style={{ minWidth: 38, textAlign: 'right', fontVariant: ['tabular-nums'], color: light.reachable ? undefined : color.warning }}>
        {lightLevel(light)}
      </Txt>
      <Switch on={light.on && light.reachable} label={`${light.name}, ${on ? 'on' : 'off'}`} onToggle={() => act((s) => planToggleLight(s, light.id))} />
    </View>
  );
}

/** A group (Hue zone): its lights across rooms, one switch. Tap for its sheet, long-press to edit it. */
function GroupCard({ zone, snapshot, act, onEdit }: { zone: Zone; snapshot: Snapshot; act: Act; onEdit: () => void }) {
  const lights = snapshot.lights.filter((l) => zone.lightIds.includes(l.id));
  const lit = lights.filter(isLit);
  const on = lit.length > 0;
  const meta = on ? `${lit.length} of ${lights.length} on` : lights.length ? 'All off' : 'No lights yet';
  return (
    <View style={{ borderRadius: 22, borderWidth: 1, borderColor: hairline(0.1), backgroundColor: color.card, paddingVertical: 12, paddingLeft: 18, paddingRight: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        <Pressable onPress={() => router.push(`/room/${zone.id}`)} onLongPress={onEdit} accessibilityRole="button" accessibilityLabel={`Open ${zone.name}`} accessibilityHint="Long-press to edit" style={({ pressed }) => ({ flex: 1, minWidth: 0, gap: 6, opacity: pressed ? 0.6 : 1 })}>
          <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 20 }}>
            {zone.name}
          </Display>
          <JewelsMeta lights={lights} meta={meta} />
        </Pressable>
        {zone.groupedLightId && lights.length > 0 && (
          <Switch big on={on} label={`${zone.name}, ${on ? 'on' : 'off'}`} onToggle={() => act((s) => planToggleZone(s, zone.id))} />
        )}
      </View>
    </View>
  );
}

/** Lights that belong to no room: still controllable. */
function LooseLights({ lights, act }: { lights: Light[]; act: Act }) {
  return (
    <View style={{ borderRadius: 22, borderWidth: 1, borderColor: hairline(0.1), backgroundColor: color.card, paddingTop: 12, paddingBottom: 8, paddingLeft: 18, paddingRight: 10 }}>
      <Display size={17} weight={400} style={{ lineHeight: 20, marginBottom: 6 }}>
        Not in a room
      </Display>
      <Label size={9} style={{ marginBottom: 8 }}>
        Edit a room to add them, or place them on the map
      </Label>
      {lights.map((l) => (
        <LightRow key={l.id} light={l} act={act} />
      ))}
    </View>
  );
}

function JewelsMeta({ lights, meta }: { lights: Light[]; meta: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, height: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 3 }}>
        {lights.slice(0, 8).map((l) => (
          <Jewel key={l.id} light={l} shape={lightShape(l.archetype)} size={7} ground={color.card} />
        ))}
      </View>
      <Label size={9} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {meta}
      </Label>
    </View>
  );
}

/** Room brightness: the average of its dimmable lights, overridden while the slider is dragged. */
function useRoomLevel(dimmable: Light[]) {
  const [drag, setDrag] = useState<number | null>(null);
  const lit = dimmable.filter(isLit);
  const pool = lit.length ? lit : dimmable;
  const value = pool.length ? Math.round(pool.reduce((s, l) => s + (l.brightness ?? 0), 0) / pool.length) : 0;
  return { value: lit.length ? value : null, shown: drag ?? value, setDrag };
}
