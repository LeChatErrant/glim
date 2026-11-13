import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { hsvHex } from '../lib/hue/color';
import type { Snapshot } from '../lib/hue/client';
import type { HomeMap } from '../lib/map/map';
import { angleTo, defaultSpot, roomAt, sweepArrow } from '../lib/map/spread';
import { captureLights, recipeLights, type MapRecipe, type MoodLight, type Others } from '../lib/moods';
import { colorName, kelvinName, loadFavorites, WHITE_PRESETS, type Favorite } from '../lib/palette';
import { tintHex, type Tint } from '../lib/tints';
import { PillButton, Slider } from './controls';
import { Icon } from './icons';
import { ColorDot } from './LightControls';
import { Field, ModalSheet } from './ModalSheet';
import { MoodMap, type MapTouch } from './MoodMap';
import { mapRoomName } from './PathSheet';
import { Choice } from './scan/parts';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

export type MapMoodKind = MapRecipe['kind'];

export const KIND_TITLES: Record<MapMoodKind, string> = { sweep: 'Gradient sweep', spot: 'Spotlight', glow: 'Room glow' };

const GLOW_TINTS = ['#FF7A3D', '#3D4BFF', '#19E6A0', '#FF1FD2', '#FFD166', '#00B4FF', '#7B3BF5', '#FF4F6A'];

const walled = (map: HomeMap) => map.rooms.filter((r) => r.points.length >= 3);

/** A new mood of a kind, ready to show: a sunset sweep left to right, a warm spotlight in the biggest room, every room its own color. */
export function defaultRecipe(kind: MapMoodKind, map: HomeMap): MapRecipe {
  if (kind === 'sweep') return { kind, tints: [{ hex: '#FF7A3D' }, { hex: '#7B3BF5' }], angle: -(map.rotation ?? 0), rooms: null, brightness: 70, others: 'leave' };
  if (kind === 'spot') return { kind, at: defaultSpot(map), radius: 2.5, tint: { kelvin: 2700 }, brightness: 100, others: 'off' };
  const rooms = walled(map).filter((r) => map.lights.some((l) => roomAt(map, l)?.id === r.id));
  return { kind, rooms: rooms.map((r, i) => ({ id: r.id, tint: { hex: GLOW_TINTS[i % GLOW_TINTS.length] } })), brightness: 60, others: 'leave' };
}

export const tintName = (t: Tint) => (t.hex ? colorName(t.hex) : kelvinName(t.kelvin ?? 2700));

/** A first name from the recipe: "Ember → violet", "Spotlight · Salon", "Room glow". */
export function recipeName(r: MapRecipe, map: HomeMap, s: Snapshot | null) {
  if (r.kind === 'sweep') return r.tints.map((t, i) => (i ? tintName(t).toLowerCase() : tintName(t))).join(' → ');
  if (r.kind === 'spot') {
    const room = roomAt(map, r.at);
    return room ? `Spotlight · ${mapRoomName(map, s, room.id)}` : 'Spotlight';
  }
  return 'Room glow';
}

const HINTS: Record<MapMoodKind, string> = {
  sweep: 'Drag on the map to turn the arrow: colors run from its tail to its head.',
  spot: 'Tap or drag on the map to move the spotlight.',
  glow: 'Tap a room on the map, then pick its color.',
};

const INTROS: Record<MapMoodKind, string> = {
  sweep: 'Two or three colors across your home, or the rooms you pick, along a direction.',
  spot: 'Light around a point: the closer a light, the brighter it gets.',
  glow: 'One color per room. Lights take the color of the room they stand in.',
};

/**
 * Creates or edits a gradient sweep, a spotlight or a room glow, with the map as the editing
 * surface. "Try it" lights it for real, then every change follows live on the lights;
 * "Put back" restores how they were before trying.
 */
export function MapMoodSheet({
  kind,
  map,
  snapshot,
  initial,
  onSend,
  onSave,
  onDelete,
  onClose,
}: {
  kind: MapMoodKind;
  map: HomeMap;
  snapshot: Snapshot | null;
  initial?: { name: string; recipe: MapRecipe };
  /** Sets the lights (live preview). */
  onSend: (lights: MoodLight[]) => void;
  onSave: (name: string, r: MapRecipe) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [recipe, setRecipe] = useState<MapRecipe>(() => initial?.recipe ?? defaultRecipe(kind, map));
  const [name, setName] = useState<string | null>(initial && initial.name !== recipeName(initial.recipe, map, snapshot) ? initial.name : null);
  const [active, setActive] = useState(0);
  const [room, setRoom] = useState<string | null>(() => (recipe.kind === 'glow' ? (recipe.rooms[0]?.id ?? null) : null));
  const lights = useMemo(() => (snapshot ? (recipeLights(snapshot, recipe, map) ?? []) : []), [snapshot, recipe, map]);
  const lit = lights.filter((m) => m.on);
  const set = (change: Partial<MapRecipe>) => setRecipe((r) => ({ ...r, ...change }) as MapRecipe);

  // Live preview: what the lights were before trying, and what was last sent to each.
  const [live, setLive] = useState(false);
  const before = useRef<Map<string, MoodLight> | null>(null);
  const sent = useRef(new Map<string, string>());
  const send = (next: MoodLight[]) => {
    const now = new Map(next.map((m) => [m.lightId, m]));
    // Lights the mood no longer sets go back to how they were (a spotlight moved away).
    for (const id of sent.current.keys()) if (!now.has(id) && before.current?.has(id)) now.set(id, before.current.get(id)!);
    const changed = [...now.values()].filter((m) => sent.current.get(m.lightId) !== JSON.stringify(m));
    for (const m of changed) sent.current.set(m.lightId, JSON.stringify(m));
    for (const id of [...sent.current.keys()]) if (!now.has(id)) sent.current.delete(id);
    if (changed.length) onSend(changed);
  };
  const latest = useRef({ send, lights });
  useEffect(() => {
    latest.current = { send, lights };
  });
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => latest.current.send(latest.current.lights), 250);
    return () => clearTimeout(t);
  }, [live, recipe]);

  const tryIt = () => {
    if (!snapshot) return;
    if (!before.current) before.current = new Map(captureLights(snapshot.lights).map((m) => [m.lightId, m]));
    sent.current.clear();
    send(lights);
    setLive(true);
  };
  const putBack = () => {
    if (before.current) onSend([...before.current.values()]);
    before.current = null;
    sent.current.clear();
    setLive(false);
  };

  // The map as the editing surface.
  const turnFrom = useRef<{ x: number; z: number } | null>(null);
  const onTouch = ({ p, phase, moved }: MapTouch) => {
    if (recipe.kind === 'sweep') {
      if (phase === 'start') {
        const a = sweepArrow(map, recipe.angle, recipe.rooms);
        turnFrom.current = { x: (a.from.x + a.to.x) / 2, z: (a.from.z + a.to.z) / 2 };
      }
      const c = turnFrom.current;
      if (c && Math.hypot(p.x - c.x, p.z - c.z) > 0.3) set({ angle: Math.round(angleTo(c, p)) });
    } else if (recipe.kind === 'spot') {
      set({ at: { x: Math.round(p.x * 20) / 20, z: Math.round(p.z * 20) / 20 } });
    } else if (phase === 'end' && !moved) {
      const r = roomAt(map, p);
      if (r) {
        setRoom(r.id);
        if (!recipe.rooms.some((x) => x.id === r.id)) set({ rooms: [...recipe.rooms, { id: r.id, tint: { hex: GLOW_TINTS[recipe.rooms.length % GLOW_TINTS.length] } }] });
      }
    }
  };

  const tint = recipe.kind === 'sweep' ? recipe.tints[Math.min(active, recipe.tints.length - 1)] : recipe.kind === 'spot' ? recipe.tint : recipe.rooms.find((r) => r.id === room)?.tint;
  const pickTint = (t: Tint) => {
    if (recipe.kind === 'sweep') set({ tints: recipe.tints.map((x, i) => (i === Math.min(active, recipe.tints.length - 1) ? t : x)) });
    else if (recipe.kind === 'spot') set({ tint: t });
    else if (room) set({ rooms: recipe.rooms.some((r) => r.id === room) ? recipe.rooms.map((r) => (r.id === room ? { ...r, tint: t } : r)) : [...recipe.rooms, { id: room, tint: t }] });
  };
  const tintColor = tintHex(tint ?? { kelvin: 2700 });
  const names = lit.map((m) => snapshot?.lights.find((l) => l.id === m.lightId)?.name).filter(Boolean);
  const auto = recipeName(recipe, map, snapshot);

  return (
    <ModalSheet visible title={`${initial ? 'Edit' : 'New'} ${KIND_TITLES[kind].toLowerCase()}`} onClose={onClose}>
      <Txt size={13} tone="secondary">
        {INTROS[kind]}
      </Txt>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: hairline(0.1), overflow: 'hidden' }}>
        <MoodMap map={map} recipe={recipe} lights={lights} height={250} selectedRoom={recipe.kind === 'glow' ? room : null} onTouch={onTouch} />
      </View>
      <Txt size={12} tone="muted">
        {HINTS[kind]} {names.length ? `${names.length} ${names.length === 1 ? 'light' : 'lights'}: ${names.join(', ')}.` : 'No light here yet: place some on the map.'}
      </Txt>

      {recipe.kind === 'sweep' && (
        <>
          <Row label="Colors">
            {recipe.tints.map((t, i) => (
              <Pressable key={i} onPress={() => setActive(i)} accessibilityRole="button" accessibilityLabel={`Color ${i + 1}, ${tintName(t)}`} accessibilityState={{ selected: active === i }} hitSlop={4}>
                <ColorDot hex={tintHex(t)} size={36} selected={active === i} ground={color.sheet} />
              </Pressable>
            ))}
            {recipe.tints.length < 3 ? (
              <Choice
                label="Add a color"
                dashed
                onPress={() => {
                  set({ tints: [...recipe.tints, { hex: '#19E6A0' }] });
                  setActive(recipe.tints.length);
                }}
              />
            ) : (
              <Choice
                label="Remove the last"
                dashed
                onPress={() => {
                  set({ tints: recipe.tints.slice(0, 2) });
                  setActive(Math.min(active, 1));
                }}
              />
            )}
          </Row>
          <TintPicker current={tint} onPick={pickTint} />
          <Row label="Across">
            <Choice label="Whole home" chosen={!recipe.rooms} onPress={() => set({ rooms: null })} />
            {walled(map).map((r) => {
              const on = !!recipe.rooms?.includes(r.id);
              return (
                <Choice
                  key={r.id}
                  label={mapRoomName(map, snapshot, r.id)}
                  chosen={on}
                  onPress={() => {
                    const next = on ? recipe.rooms!.filter((x) => x !== r.id) : [...(recipe.rooms ?? []), r.id];
                    set({ rooms: next.length ? next : null });
                  }}
                />
              );
            })}
          </Row>
        </>
      )}

      {recipe.kind === 'spot' && (
        <>
          <TintPicker current={tint} onPick={pickTint} label="Color" />
          <View style={{ gap: 8 }}>
            <Label>Size · {recipe.radius.toFixed(1)} m around</Label>
            <Slider value={Math.round(recipe.radius * 10)} min={8} max={80} tint={tintColor} ground={color.sheet} label="Spotlight size" onChange={(v) => set({ radius: v / 10 })} onCommit={(v) => set({ radius: v / 10 })} />
          </View>
        </>
      )}

      {recipe.kind === 'glow' && (
        <>
          <Row label="Rooms">
            {walled(map).map((r) => {
              const t = recipe.rooms.find((x) => x.id === r.id)?.tint;
              return <Choice key={r.id} label={mapRoomName(map, snapshot, r.id)} chosen={room === r.id} dot={t ? tintHex(t) : undefined} dashed={!t} onPress={() => setRoom(r.id)} />;
            })}
          </Row>
          {room && (
            <>
              <TintPicker current={tint} onPick={pickTint} label={mapRoomName(map, snapshot, room)} />
              {tint && (
                <PillButton
                  title={`No color in ${mapRoomName(map, snapshot, room)}`}
                  kind="text"
                  height={36}
                  onPress={() => set({ rooms: recipe.rooms.filter((r) => r.id !== room) })}
                  style={{ alignSelf: 'flex-start' }}
                />
              )}
            </>
          )}
        </>
      )}

      <View style={{ gap: 8 }}>
        <Label>
          {recipe.kind === 'spot' ? 'Brightest' : 'Brightness'} · {recipe.brightness}%
        </Label>
        <Slider value={recipe.brightness} min={1} max={100} tint={tintColor} ground={color.sheet} label="Brightness" onChange={(brightness) => set({ brightness })} onCommit={(brightness) => set({ brightness })} />
      </View>
      <Row label="Other lights">
        <Choice label="Leave as they are" chosen={recipe.others === 'leave'} onPress={() => set({ others: 'leave' as Others })} />
        <Choice label="Turn off" chosen={recipe.others === 'off'} onPress={() => set({ others: 'off' as Others })} />
      </Row>
      <Field label="Name" value={name ?? auto} onChange={setName} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {live ? (
          <PillButton title="Put back" onPress={putBack} style={{ flex: 1 }} />
        ) : (
          <PillButton title="Try it" onPress={tryIt} disabled={!lit.length} style={{ flex: 1 }} />
        )}
        <PillButton title="Save" kind="primary" onPress={() => onSave(name?.trim() || auto, recipe)} style={{ flex: 1 }} />
      </View>
      {live && (
        <Txt size={12} tone="muted">
          Live: your lights follow each change. Put back restores how they were before.
        </Txt>
      )}
      {onDelete && <PillButton title={`Delete ${KIND_TITLES[kind].toLowerCase()}`} kind="text" height={40} onPress={onDelete} style={{ alignSelf: 'flex-start' }} />}
    </ModalSheet>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8, alignItems: 'center' }}>
        {children}
      </ScrollView>
    </View>
  );
}

const HUES = [0, 18, 32, 46, 60, 100, 140, 170, 195, 215, 240, 265, 290, 320, 340];
const SAME = (a: Tint | undefined, b: Tint) => !!a && (a.hex && b.hex ? a.hex.toLowerCase() === b.hex.toLowerCase() : !a.hex && !b.hex && a.kelvin === b.kelvin);

/** Colors to pick from: your favorites, the whites, then a spectrum of colors. */
function TintPicker({ current, onPick, label }: { current?: Tint; onPick: (t: Tint) => void; label?: string }) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  useEffect(() => {
    loadFavorites().then(setFavorites);
  }, []);
  const offered: (Tint & { fav?: boolean })[] = [
    ...favorites.map((f) => ({ hex: f.hex, kelvin: f.kelvin, fav: true })),
    ...WHITE_PRESETS.map((w) => ({ kelvin: w.kelvin })),
    ...HUES.map((h) => ({ hex: hsvHex(h, h >= 32 && h <= 60 ? 0.9 : 0.85, 1).toUpperCase() })),
  ];
  // The color in use comes first when it isn't one of these (a default, an older pick).
  const items: (Tint & { fav?: boolean })[] = current && !offered.some((t) => SAME(current, t)) ? [current, ...offered] : offered;
  return (
    <View style={{ gap: 8 }}>
      {label && <Label>{label}</Label>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8, alignItems: 'center' }}>
        {items.map((t, i) => (
          <Pressable key={i} onPress={() => onPick({ hex: t.hex, kelvin: t.hex ? undefined : t.kelvin })} accessibilityRole="button" accessibilityLabel={tintName(t)} hitSlop={4}>
            <ColorDot hex={tintHex(t)} size={32} selected={SAME(current, t)} ground={color.sheet} />
            {t.fav && (
              <View style={{ position: 'absolute', right: -3, bottom: -3, width: 15, height: 15, borderRadius: 8, backgroundColor: color.sheet, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="star" size={9} tint={color.champagne} stroke={1.8} />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
