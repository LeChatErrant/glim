import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { PanResponder, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { identifyLight, type Light, type Snapshot } from '../lib/hue/client';
import { inkOn, LIGHT_ICON_PATHS } from '../lib/lightIcons';
import { DEFAULT_LENGTH, isPlug, lightShape, lightType } from '../lib/lights';
import { useSnapshot } from '../lib/hue/useSnapshot';
import {
  centroid,
  closestOnSegment,
  distance,
  pointInPolygon,
  roomWalls,
  snapCorner,
  snapRoom,
  type SnapGuide,
  type SnapTargets,
  type SnapTolerance,
} from '../lib/map/geometry';
import { loadMap, saveMap, saveMapRotation, type FloorPoint, type HomeMap, type MapLight, type MapRoom } from '../lib/map/map';
import { PLAN_COLORS } from '../lib/map/svg';
import { Body, Button, Chip } from '../ui/components';
import { offerMoveToRoom } from '../ui/offerMoveToRoom';
import { RoomAssign } from '../ui/RoomAssign';
import { turnTo } from '../ui/MapGestures';
import { theme } from '../ui/theme';
import { refreshAllWidgets } from '../widgets/task-handler';

/**
 * 2D floor plan editor. Draw a map from scratch (when AR isn't available) or touch up a
 * scanned one. Every change is saved right away and can be undone.
 */

type Doc = { rooms: MapRoom[]; lights: MapLight[] };

type Selection =
  | { kind: 'room'; roomId: string }
  | { kind: 'corner'; roomId: string; index: number }
  | { kind: 'light'; lightId: string }
  | { kind: 'add-light' }
  | null;

/**
 * Screen = (meters turned by `rot`) × scale + offset. `rot` is the map's orientation, degrees
 * clockwise on screen, the same one the Map tab shows.
 */
type ViewBox = { scale: number; ox: number; oy: number; rot: number };

const turned = (x: number, z: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.cos(a) * x - Math.sin(a) * z, z: Math.sin(a) * x + Math.cos(a) * z };
};
const screenOf = (p: FloorPoint, v: ViewBox) => {
  const t = turned(p.x, p.z, v.rot);
  return { sx: t.x * v.scale + v.ox, sy: t.z * v.scale + v.oy };
};
const metersOf = (sx: number, sy: number, v: ViewBox): FloorPoint => turned((sx - v.ox) / v.scale, (sy - v.oy) / v.scale, -v.rot);
/** A finger move on screen, in meters on the map. */
const deltaOf = (dx: number, dy: number, v: ViewBox): FloorPoint => turned(dx / v.scale, dy / v.scale, -v.rot);
/** The view turned to `rot`, keeping the map point under (sx, sy) where it is. */
function turnView(v: ViewBox, rot: number, sx: number, sy: number, scale = v.scale): ViewBox {
  const m = metersOf(sx, sy, v);
  const t = turned(m.x, m.z, rot);
  return { scale, rot, ox: sx - t.x * scale, oy: sy - t.z * scale };
}

type Drag =
  | { kind: 'corner'; roomId: string; index: number }
  | { kind: 'room'; roomId: string }
  | { kind: 'light'; lightId: string }
  | { kind: 'handle'; lightId: string; end: 1 | -1 }
  | { kind: 'pan'; start: ViewBox }
  | { kind: 'pinch'; start: ViewBox; dist: number; cx: number; cy: number; angle: number };

const HIT_PX = 26;
// Snap distances on screen, so snapping feels the same at any zoom.
const SNAP_CORNER_PX = 16;
const SNAP_WALL_PX = 12;
const SNAP_AXIS_PX = 10;
const ACCENT = theme.accent;

export default function Editor() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    loadMap().then((m) => {
      setRotation(m?.rotation ?? 0);
      setDoc(m ? { rooms: m.rooms, lights: m.lights } : { rooms: [], lights: [] });
    });
  }, []);
  if (!doc) return null;
  return <EditorCanvas initial={doc} rotation={rotation} />;
}

function EditorCanvas({ initial, rotation }: { initial: Doc; rotation: number }) {
  const insets = useSafeAreaInsets();
  const { snapshot, refresh } = useSnapshot(5000);
  // `?place=1`: opened to place lights missing from the map, so start on the light picker.
  const { place } = useLocalSearchParams<{ place?: string }>();
  const [doc, setDoc] = useState<Doc>(initial);
  const [draft, setDraft] = useState<Doc | null>(null);
  const [history, setHistory] = useState<Doc[]>([]);
  const [sel, setSel] = useState<Selection>(place ? { kind: 'add-light' } : null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewBox | null>(null);
  // What the dragged corner or room snapped to, drawn until release.
  const [guides, setGuides] = useState<SnapGuide[]>([]);

  const shown = draft ?? doc;

  // PanResponder is created once; it reads the latest values through this ref.
  const live = useRef({ doc, shown, sel, view, snapshot });
  useLayoutEffect(() => {
    live.current = { doc, shown, sel, view, snapshot };
  });

  function commit(next: Doc) {
    setHistory((h) => [...h, doc]);
    setDoc(next);
    setDraft(null);
    persist(next);
  }

  function undo() {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setDoc(prev);
    setSel(null);
    persist(prev);
  }

  async function persist(next: Doc) {
    await saveMap(toHomeMap(next));
    refreshAllWidgets();
  }

  const toScreen = screenOf;
  const toMeters = metersOf;

  /** Saves a new orientation: the Map tab and widgets show the map turned the same way. */
  function saveTurn(rot: number) {
    saveMapRotation(rot).then(() => refreshAllWidgets());
  }

  function turnRight() {
    if (!view) return;
    const rot = (((view.rot + 90) % 360) + 360) % 360;
    setView(turnView(view, rot, size.w / 2, size.h / 2));
    saveTurn(rot);
  }

  /** What's under a touch, in priority order: handles of the selected room, lights, rooms. */
  function hitTest(sx: number, sy: number) {
    const { shown: d, sel: s, view: v } = live.current;
    if (!v) return null;
    const selRoomId = s?.kind === 'room' || s?.kind === 'corner' ? s.roomId : null;
    const selRoom = d.rooms.find((r) => r.id === selRoomId);
    if (selRoom) {
      for (let i = 0; i < selRoom.points.length; i++) {
        const { sx: x, sy: y } = toScreen(selRoom.points[i], v);
        if (Math.hypot(x - sx, y - sy) < HIT_PX) return { kind: 'corner' as const, roomId: selRoom.id, index: i };
      }
      for (let i = 0; i < selRoom.points.length; i++) {
        const a = selRoom.points[i];
        const b = selRoom.points[(i + 1) % selRoom.points.length];
        const { sx: x, sy: y } = toScreen({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, v);
        if (Math.hypot(x - sx, y - sy) < HIT_PX * 0.8) return { kind: 'midpoint' as const, roomId: selRoom.id, index: i };
      }
    }
    const selLight = s?.kind === 'light' ? d.lights.find((l) => l.lightId === s.lightId) : undefined;
    const kind = selLight ? directional(selLight.lightId, live.current.snapshot) : null;
    if (selLight && kind) {
      for (const end of [1, -1] as const) {
        if (end === -1 && !stretchy(kind)) continue;
        const { sx: x, sy: y } = toScreen(handleAt(selLight, d.rooms, kind, v.scale, end), v);
        if (Math.hypot(x - sx, y - sy) < HIT_PX) return { kind: 'handle' as const, lightId: selLight.lightId, end };
      }
    }
    for (const l of d.lights) {
      const { sx: x, sy: y } = toScreen(l, v);
      if (Math.hypot(x - sx, y - sy) < HIT_PX) return { kind: 'light' as const, lightId: l.lightId };
    }
    const p = toMeters(sx, sy, v);
    // Smallest room first, so a room drawn inside another one can still be picked.
    const containing = d.rooms
      .filter((r) => r.points.length > 2 && pointInPolygon(p, r.points))
      .sort((a, b) => area(a.points) - area(b.points));
    if (containing[0]) return { kind: 'room' as const, roomId: containing[0].id };
    return null;
  }

  const drag = useRef<Drag | null>(null);
  // The document a drag started from; moves are applied to it from scratch on every event.
  const dragBase = useRef<Doc | null>(null);
  const moved = useRef(false);

  const responder = useMemo(
    () =>
      // The handlers only read refs when touched, never during render.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          moved.current = false;
          dragBase.current = live.current.doc;
          const { locationX: sx, locationY: sy } = e.nativeEvent;
          const hit = hitTest(sx, sy);
          const { sel: s, view: v, shown: d } = live.current;
          if (!v) return;
          const selRoomId = s?.kind === 'room' || s?.kind === 'corner' ? s.roomId : null;
          if (hit?.kind === 'corner') drag.current = { kind: 'corner', roomId: hit.roomId, index: hit.index };
          else if (hit?.kind === 'midpoint') {
            // Insert a corner in the middle of the wall and drag it right away.
            const rooms = d.rooms.map((r) => {
              if (r.id !== hit.roomId) return r;
              const a = r.points[hit.index];
              const b = r.points[(hit.index + 1) % r.points.length];
              const pts = [...r.points];
              pts.splice(hit.index + 1, 0, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
              return { ...r, points: pts };
            });
            dragBase.current = { ...d, rooms };
            setDraft(dragBase.current);
            drag.current = { kind: 'corner', roomId: hit.roomId, index: hit.index + 1 };
            moved.current = true;
          } else if (hit?.kind === 'light') drag.current = { kind: 'light', lightId: hit.lightId };
          else if (hit?.kind === 'handle') drag.current = { kind: 'handle', lightId: hit.lightId, end: hit.end };
          else if (hit?.kind === 'room' && hit.roomId === selRoomId) drag.current = { kind: 'room', roomId: hit.roomId };
          else drag.current = { kind: 'pan', start: v };
        },
        onPanResponderMove: (e: GestureResponderEvent, g) => {
          const touches = e.nativeEvent.touches;
          const { view: v, doc: base } = live.current;
          if (!v) return;
          if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6 || touches.length > 1) moved.current = true;
          if (touches.length === 2) {
            const [t1, t2] = touches;
            const dist = Math.hypot(t1.locationX - t2.locationX, t1.locationY - t2.locationY);
            const cx = (t1.locationX + t2.locationX) / 2;
            const cy = (t1.locationY + t2.locationY) / 2;
            const angle = (Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX) * 180) / Math.PI;
            if (drag.current?.kind !== 'pinch') {
              drag.current = { kind: 'pinch', start: v, dist, cx, cy, angle };
              setDraft(null);
              setGuides([]);
              return;
            }
            const p = drag.current;
            const scale = Math.max(10, Math.min(600, p.start.scale * (dist / p.dist)));
            // A small wobble while zooming isn't a twist.
            let twist = (((angle - p.angle + 540) % 360) + 360) % 360 - 180;
            if (Math.abs(twist) < 10) twist = 0;
            // The point that was between the fingers follows them, zoomed and turned.
            const m = metersOf(p.cx, p.cy, p.start);
            const t = turned(m.x, m.z, p.start.rot + twist);
            setView({ scale, rot: p.start.rot + twist, ox: cx - t.x * scale, oy: cy - t.z * scale });
            return;
          }
          const d = drag.current;
          if (!d || d.kind === 'pinch') return;
          if (d.kind === 'pan') {
            setView({ ...d.start, ox: d.start.ox + g.dx, oy: d.start.oy + g.dy });
            return;
          }
          const { x: dx, z: dz } = deltaOf(g.dx, g.dy, v);
          const from = dragBase.current ?? base;
          // Corners and rooms snap live, so what's shown is what gets saved on release.
          if (d.kind === 'corner') {
            const start = from.rooms.find((r) => r.id === d.roomId)?.points[d.index];
            if (!start) return;
            const align = from.rooms.flatMap((r) => r.points.filter((_, i) => !(r.id === d.roomId && i === d.index)));
            const snap = snapCorner({ x: start.x + dx, z: start.z + dz }, { ...snapTargets(from.rooms, d.roomId), align }, snapTolerance(v));
            setGuides(snap.guides);
            setDraft({
              ...from,
              rooms: from.rooms.map((r) => (r.id === d.roomId ? { ...r, points: r.points.map((p, i) => (i === d.index ? snap.point : p)) } : r)),
            });
          } else if (d.kind === 'room') {
            const room = from.rooms.find((r) => r.id === d.roomId);
            if (!room) return;
            const shifted = room.points.map((p) => ({ x: p.x + dx, z: p.z + dz }));
            const { offset, guides: g } = snapRoom(shifted, snapTargets(from.rooms, d.roomId), snapTolerance(v));
            setGuides(g);
            const points = shifted.map((p) => ({ x: p.x + offset.x, z: p.z + offset.z }));
            setDraft({ ...from, rooms: from.rooms.map((r) => (r.id === d.roomId ? { ...r, points } : r)) });
          } else if (d.kind === 'light') {
            setDraft({ ...from, lights: from.lights.map((l) => (l.lightId === d.lightId ? { ...l, x: l.x + dx, z: l.z + dz } : l)) });
          } else if (d.kind === 'handle') {
            const light = from.lights.find((l) => l.lightId === d.lightId);
            const kind = light && directional(light.lightId, live.current.snapshot);
            if (!light || !kind) return;
            // The handle follows the finger: its direction turns the light, its reach sets a string's or strip's length.
            const knob = handleAt(light, from.rooms, kind, v.scale, d.end);
            const p = { x: knob.x + dx - light.x, z: knob.z + dz - light.z };
            const raw = (Math.atan2(p.z, p.x) * 180) / Math.PI + (d.end === -1 ? 180 : 0);
            const angle = snapAngle(raw, from.rooms);
            setGuides(angle.wall ? [{ kind: 'line', a: angle.wall[0], b: angle.wall[1] }] : []);
            const length = stretchy(kind) ? Math.max(0.4, Math.min(20, Math.round(Math.hypot(p.x, p.z) * 2 * 10) / 10)) : light.length;
            setDraft({ ...from, lights: from.lights.map((l) => (l.lightId === d.lightId ? { ...l, angle: angle.deg, length } : l)) });
          }
        },
        onPanResponderRelease: (e) => {
          const d = drag.current;
          drag.current = null;
          dragBase.current = null;
          setGuides([]);
          if (!moved.current) {
            setDraft(null);
            const { locationX: sx, locationY: sy } = e.nativeEvent;
            const hit = hitTest(sx, sy);
            if (hit?.kind === 'corner') setSel({ kind: 'corner', roomId: hit.roomId, index: hit.index });
            else if (hit?.kind === 'light') setSel({ kind: 'light', lightId: hit.lightId });
            else if (hit?.kind === 'room') setSel({ kind: 'room', roomId: hit.roomId });
            else setSel(null);
            return;
          }
          // A twist settles on a quarter turn when close to one, and becomes the map's orientation.
          const v = live.current.view;
          if (d?.kind === 'pinch' && v && v.rot !== d.start.rot) {
            const rot = ((turnTo(d.start.rot, v.rot - d.start.rot) % 360) + 360) % 360;
            setView(turnView(v, rot, d.cx, d.cy));
            saveTurn(rot);
          }
          const draftDoc = live.current.shown;
          if (!d || d.kind === 'pan' || d.kind === 'pinch' || draftDoc === live.current.doc) return;
          if (d.kind === 'corner') {
            commit(draftDoc);
            setSel({ kind: 'corner', roomId: d.roomId, index: d.index });
          } else if (d.kind === 'room') {
            commit(draftDoc);
          } else if (d.kind === 'handle') {
            commit(draftDoc);
          } else if (d.kind === 'light') {
            commit(draftDoc);
            setSel({ kind: 'light', lightId: d.lightId });
            const l = draftDoc.lights.find((x) => x.lightId === d.lightId);
            if (l) offerRoomMove(l, draftDoc);
          }
        },
        onPanResponderTerminate: () => {
          drag.current = null;
          setDraft(null);
          setGuides([]);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** When a light is dropped in a room other than its Hue room, offer to move it in Hue. */
  function offerRoomMove(l: MapLight, d: Doc) {
    const room = [...d.rooms]
      .filter((r) => r.hueRoomId && r.points.length > 2 && pointInPolygon(l, r.points))
      .sort((a, b) => area(a.points) - area(b.points))[0];
    if (room) offerMoveToRoom(live.current.snapshot, l.lightId, room, refresh);
  }

  // ---- Toolbar actions -------------------------------------------------------

  function addRoom() {
    if (!view) return;
    const c = toMeters(size.w / 2, size.h / 2, view);
    const half = 1.5;
    const room: MapRoom = {
      id: newRoomId(),
      name: 'New room',
      hueRoomId: null,
      points: [
        { x: c.x - half, z: c.z - half },
        { x: c.x + half, z: c.z - half },
        { x: c.x + half, z: c.z + half },
        { x: c.x - half, z: c.z + half },
      ].map((p) => ({ x: Math.round(p.x * 20) / 20, z: Math.round(p.z * 20) / 20 })),
    };
    commit({ ...doc, rooms: [...doc.rooms, room] });
    setSel({ kind: 'room', roomId: room.id });
  }

  function addLight(lightId: string) {
    if (!view) return;
    // A light in a Hue room on the map lands in that room, else in the middle of the screen.
    const hueRoomId = snapshot?.lights.find((l) => l.id === lightId)?.roomId;
    const room = hueRoomId ? doc.rooms.find((r) => r.hueRoomId === hueRoomId && r.points.length >= 3) : undefined;
    const c = room ? spot(room, doc.lights.filter((l) => l.lightId !== lightId)) : toMeters(size.w / 2, size.h / 2, view);
    const next = { ...doc, lights: [...doc.lights.filter((l) => l.lightId !== lightId), { lightId, ...c }] };
    commit(next);
    setSel({ kind: 'light', lightId });
    identifyLight(lightId).catch(() => null);
  }

  function updateRoom(roomId: string, patch: Partial<MapRoom>) {
    commit({ ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)) });
  }

  const selRoom = sel && (sel.kind === 'room' || sel.kind === 'corner') ? doc.rooms.find((r) => r.id === sel.roomId) : undefined;
  const selLight = sel?.kind === 'light' ? snapshot?.lights.find((l) => l.id === sel.lightId) : undefined;
  const placedIds = new Set(doc.lights.map((l) => l.lightId));
  const selPlaced = sel?.kind === 'light' ? doc.lights.find((l) => l.lightId === sel.lightId) : undefined;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: 'Edit map',
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={turnRight} accessibilityLabel="Turn the map a quarter turn right" hitSlop={8} style={{ padding: 8 }}>
                <Text style={{ color: theme.text, fontSize: 16 }}>⟳ Turn</Text>
              </Pressable>
              <Pressable onPress={undo} disabled={!history.length} hitSlop={12} style={{ opacity: history.length ? 1 : 0.35, padding: 8 }}>
                <Text style={{ color: theme.text, fontSize: 16 }}>↶ Undo</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setSize({ w, h });
          // Fit the whole plan on screen the first time we know the canvas size.
          if (w && !view) setView(fitView(doc, w, h, rotation));
        }}
        {...responder.panHandlers}
      >
        {view && <Canvas doc={shown} view={view} sel={sel} guides={guides} snapshot={snapshot} width={size.w} height={size.h} />}
        {!doc.rooms.length && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 24, left: 24, right: 24 }}>
            <Body muted>{"Start with Add room, then drag the corners to the shape of your room. Tap a wall's middle dot to add a corner."}</Body>
          </View>
        )}
      </View>

      <View style={{ padding: 16, paddingBottom: insets.bottom + 12, gap: 10, backgroundColor: theme.surface }}>
        {sel === null && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Add room" primary style={{ flex: 1 }} onPress={addRoom} />
            <Button title="Add light" style={{ flex: 1 }} onPress={() => setSel({ kind: 'add-light' })} />
            <Button title="Done" style={{ flex: 0.8 }} onPress={() => router.back()} />
          </View>
        )}

        {sel?.kind === 'add-light' && snapshot && (
          <>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Pick a light to place</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {sortLightsForPlacing(snapshot, placedIds).map((l) => (
                <Chip key={l.id} label={`${placedIds.has(l.id) ? '✓ ' : ''}${l.name}`} dot={l.on ? l.color : undefined} onPress={() => addLight(l.id)} />
              ))}
            </ScrollView>
            <Button title="Cancel" onPress={() => setSel(null)} />
          </>
        )}

        {selRoom && sel?.kind === 'room' && snapshot && (
          <>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
              {selRoom.name} · {area(selRoom.points).toFixed(1)} m²
            </Text>
            <RoomAssign
              rooms={snapshot.rooms}
              // A room just drawn isn't "Other space" yet: highlight nothing until the user picks.
              current={selRoom.hueRoomId ?? (selRoom.name === 'Other' ? null : undefined)}
              onAssign={(c) => updateRoom(selRoom.id, { name: c.name, hueRoomId: c.hueRoomId })}
              onRoomCreated={refresh}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title={selRoom.outdoor ? '✓ Outdoor' : 'Outdoor'} style={{ flex: 1 }} onPress={() => updateRoom(selRoom.id, { outdoor: !selRoom.outdoor })} />
              <Button
                title="Delete room"
                style={{ flex: 1 }}
                onPress={() => {
                  commit({ ...doc, rooms: doc.rooms.filter((r) => r.id !== selRoom.id) });
                  setSel(null);
                }}
              />
              <Button title="Done" style={{ flex: 0.8 }} onPress={() => setSel(null)} />
            </View>
            <Body muted>{"Drag the room to move it, drag a corner to reshape it, tap a wall's middle dot to add a corner."}</Body>
          </>
        )}

        {selRoom && sel?.kind === 'corner' && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              title="Delete corner"
              style={{ flex: 1 }}
              disabled={selRoom.points.length <= 3}
              onPress={() => {
                updateRoom(selRoom.id, { points: selRoom.points.filter((_, i) => i !== sel.index) });
                setSel({ kind: 'room', roomId: selRoom.id });
              }}
            />
            <Button title="Done" style={{ flex: 1 }} onPress={() => setSel({ kind: 'room', roomId: selRoom.id })} />
          </View>
        )}

        {sel?.kind === 'light' && (
          <>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{selLight?.name ?? 'Light'}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Blink" style={{ flex: 1 }} onPress={() => identifyLight(sel.lightId).catch(() => null)} />
              <Button
                title="Remove from map"
                style={{ flex: 1.4 }}
                onPress={() => {
                  commit({ ...doc, lights: doc.lights.filter((l) => l.lightId !== sel.lightId) });
                  setSel(null);
                }}
              />
              <Button title="Done" style={{ flex: 0.8 }} onPress={() => setSel(null)} />
            </View>
            {selPlaced && directional(sel.lightId, snapshot) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Body muted>
                    {directional(sel.lightId, snapshot) === 'string'
                      ? 'Drag a ⟳ end to turn the string and stretch it to its real length.'
                      : directional(sel.lightId, snapshot) === 'strip'
                        ? 'Drag a ⟳ end to turn the strip and stretch it to its real length. It snaps to walls.'
                      : directional(sel.lightId, snapshot) === 'lantern'
                        ? 'Drag ⟳ to turn it along the wall it hangs on. It snaps to walls.'
                        : 'Drag ⟳ to turn the bar the way it really stands. It snaps to walls.'}
                  </Body>
                </View>
                {selPlaced.angle !== undefined && (
                  <Button
                    title="Along the wall"
                    onPress={() =>
                      commit({ ...doc, lights: doc.lights.map((l) => (l.lightId === sel.lightId ? { ...l, angle: undefined, length: undefined } : l)) })
                    }
                  />
                )}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

type Directional = 'string' | 'strip' | 'bar' | 'lantern';

/** Lights drawn along a direction, with a handle to turn them: string lights, strips, bars, lanterns. */
function directional(lightId: string, s: Snapshot | null): Directional | null {
  const light = s?.lights.find((l) => l.id === lightId);
  const shape = light ? lightShape(light.archetype) : null;
  return shape === 'string' || shape === 'strip' || shape === 'bar' || shape === 'lantern' ? shape : null;
}

/** String lights and strips are drawn at their real length: a handle at each end stretches them. */
const stretchy = (kind: Directional) => kind === 'string' || kind === 'strip';
const lengthOf = (l: MapLight, kind: Directional) => l.length ?? DEFAULT_LENGTH[kind] ?? 0;

/** The direction a light runs along, in degrees: set by the user, else along the nearest wall (as the map draws it). */
function lightAngle(l: MapLight, rooms: MapRoom[]) {
  if (l.angle !== undefined) return l.angle;
  let best = Infinity;
  let angle = 0;
  for (const r of rooms) {
    for (const [a, b] of roomWalls(r.points)) {
      const d = distance(l, closestOnSegment(l, a, b));
      if (d < best) {
        best = d;
        angle = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
      }
    }
  }
  return angle;
}

/** Where a light's handle sits: the ends of a string or strip (its length), or a fixed reach for the others. */
function handleAt(l: MapLight, rooms: MapRoom[], kind: Directional, scale: number, end: 1 | -1): FloorPoint {
  const a = (lightAngle(l, rooms) * Math.PI) / 180;
  const reach = stretchy(kind) ? Math.max(lengthOf(l, kind) / 2, 30 / scale) : 46 / scale;
  return { x: l.x + Math.cos(a) * reach * end, z: l.z + Math.sin(a) * reach * end };
}

/** Snaps a direction to the nearest wall's within 6° (either way along it), else to 5° steps. */
function snapAngle(deg: number, rooms: MapRoom[]): { deg: number; wall?: [FloorPoint, FloorPoint] } {
  for (const r of rooms) {
    for (const [a, b] of roomWalls(r.points)) {
      const w = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
      for (const cand of [w, w + 180, w - 180]) if (Math.abs(cand - deg) < 6) return { deg: cand, wall: [a, b] };
    }
  }
  return { deg: Math.round(deg / 5) * 5 };
}

const ROTATE_ICON = 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15';

/**
 * The selected light's handle: a knob with a turn icon at the end of a dashed arm, labeled with
 * what dragging it does. String lights and strips get a knob at each end, and their length in the middle.
 */
function Handle({ l, rooms, kind, view }: { l: MapLight; rooms: MapRoom[]; kind: Directional; view: ViewBox }) {
  const X = (p: FloorPoint) => screenOf(p, view).sx;
  const Y = (p: FloorPoint) => screenOf(p, view).sy;
  const a = handleAt(l, rooms, kind, view.scale, 1);
  const b = stretchy(kind) ? handleAt(l, rooms, kind, view.scale, -1) : l;
  const knob = (p: FloorPoint, key: string) => (
    <G key={key}>
      <Circle cx={X(p)} cy={Y(p)} r={14} fill={theme.bg} stroke={ACCENT} strokeWidth={2} />
      <Path d={ROTATE_ICON} fill="none" stroke={ACCENT} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${X(p) - 8} ${Y(p) - 8}) scale(${16 / 24})`} />
    </G>
  );
  const length = stretchy(kind) ? `${lengthOf(l, kind).toFixed(1)} m` : null;
  return (
    <G>
      <Line x1={X(b)} y1={Y(b)} x2={X(a)} y2={Y(a)} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="5 4" />
      {knob(a, 'a')}
      {stretchy(kind) && knob(b, 'b')}
      <PlanChip x={X(a)} y={Y(a) - 30} text={stretchy(kind) ? 'TURN · STRETCH' : 'TURN'} />
      {length && <PlanChip x={(X(a) + X(b)) / 2} y={(Y(a) + Y(b)) / 2 - 26} text={length} />}
    </G>
  );
}

/** A small dark label with champagne text, centered on (x, y). */
function PlanChip({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 6.6 + 16;
  return (
    <G>
      <Rect x={x - w / 2} y={y - 10} width={w} height={20} rx={10} fill="rgba(5,5,6,0.88)" stroke={ACCENT} strokeOpacity={0.45} strokeWidth={1} />
      <SvgText x={x} y={y + 3.5} fill={ACCENT} fontSize={10} letterSpacing={1.2} textAnchor="middle">
        {text}
      </SvgText>
    </G>
  );
}

/**
 * A light as the Map tab draws it: color core, dark gap, ivory ring, and its type icon on top.
 * Plugs are diamonds, light bars capsules turned along `angle` (degrees on screen). Off = hollow.
 */
function MarkerG({ light, x, y, angle }: { light: Light; x: number; y: number; angle?: number }) {
  const on = light.on && light.reachable;
  const core = on ? light.color : theme.bg;
  const ink = on ? inkOn(light.color) : 'rgba(242,232,216,0.85)';
  const r = 13;
  const plug = isPlug(light);
  const shape = (grow: number, fill: string, stroke?: string, dash?: string) =>
    plug ? (
      <Rect x={x - r + 2 - grow} y={y - r + 2 - grow} width={(r - 2 + grow) * 2} height={(r - 2 + grow) * 2} transform={`rotate(45 ${x} ${y})`} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.2 : 0} strokeDasharray={dash} />
    ) : angle !== undefined ? (
      <Rect x={x - r - 5 - grow} y={y - r + 3 - grow} width={(r + 5 + grow) * 2} height={(r - 3 + grow) * 2} rx={r - 3 + grow} transform={`rotate(${angle} ${x} ${y})`} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.2 : 0} strokeDasharray={dash} />
    ) : (
      <Circle cx={x} cy={y} r={r + grow} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.2 : 0} strokeDasharray={dash} />
    );
  const icon = 15;
  return (
    <G>
      {on && <Circle cx={x} cy={y} r={r + 9} fill={light.color} fillOpacity={0.18} />}
      {!light.reachable ? shape(3, 'none', '#F2B872', '3 3') : on ? shape(3, 'rgba(255,246,230,0.85)') : null}
      {on && shape(1.6, PLAN_COLORS.off)}
      {shape(0, core, on ? undefined : PLAN_COLORS.offStroke)}
      <Path
        d={LIGHT_ICON_PATHS[lightType(light.archetype)]}
        fill="none"
        stroke={ink}
        strokeWidth={1.6 * (24 / icon)}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`translate(${x - icon / 2} ${y - icon / 2}) scale(${icon / 24})`}
      />
    </G>
  );
}

/**
 * What the light physically is, on the floor: a light bar's length, a string's row of beads or a
 * strip (their real length), a lantern's wall plate. Turning the handle turns this, so its effect shows.
 */
function Footprint({ l, light, rooms, kind, view }: { l: MapLight; light: Light; rooms: MapRoom[]; kind: Directional; view: ViewBox }) {
  const a = (lightAngle(l, rooms) * Math.PI) / 180;
  const half = stretchy(kind) ? lengthOf(l, kind) / 2 : kind === 'bar' ? 0.3 : 0.25;
  const at = (t: number) => screenOf({ x: l.x + Math.cos(a) * t, z: l.z + Math.sin(a) * t }, view);
  const p = at(-half);
  const q = at(half);
  const on = light.on && light.reachable;
  const tint = on ? light.color : 'rgba(242,232,216,0.45)';
  if (kind === 'string') {
    const n = Math.max(3, Math.round((half * 2) / 0.3));
    return (
      <G>
        <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={tint} strokeOpacity={0.5} strokeWidth={1} />
        {Array.from({ length: n + 1 }, (_, i) => {
          const b = at(-half + (i * half * 2) / n);
          return <Circle key={i} cx={b.sx} cy={b.sy} r={2.6} fill={on ? light.color : theme.bg} stroke={on ? undefined : tint} strokeWidth={1} />;
        })}
      </G>
    );
  }
  if (kind === 'strip') {
    return (
      <G>
        {on && <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={tint} strokeOpacity={0.4} strokeWidth={8} strokeLinecap="round" />}
        <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={on ? '#FFE2B0' : tint} strokeWidth={2.5} strokeLinecap="round" />
      </G>
    );
  }
  return <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={tint} strokeOpacity={on ? 0.6 : 0.5} strokeWidth={kind === 'bar' ? 7 : 3} strokeLinecap="round" />;
}

/** A free spot in a room: its center, nudged so it doesn't land on a light already there. */
function spot(room: MapRoom, lights: MapLight[]): FloorPoint {
  const c = centroid(room.points);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4;
    const r = i === 0 ? 0 : 0.35 + i * 0.08;
    const p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
    if (pointInPolygon(p, room.points) && lights.every((l) => distance(l, p) > 0.4)) return p;
  }
  return c;
}

/** Lights not on the map first, then the rest. */
function sortLightsForPlacing(s: Snapshot, placed: Set<string>) {
  return [...s.lights].sort((a, b) => Number(placed.has(a.id)) - Number(placed.has(b.id)));
}

const newRoomId = () => `room-${Date.now()}`;

const toHomeMap = (d: Doc): HomeMap => ({ version: 2, rooms: d.rooms, lights: d.lights, updatedAt: Date.now() });

/** A view that fits the whole plan, turned by `rot`, in a canvas of w × h. */
function fitView(doc: Doc, w: number, h: number, rot: number): ViewBox {
  const pts = [...doc.rooms.flatMap((r) => r.points), ...doc.lights].map((p) => turned(p.x, p.z, rot));
  const minX = pts.length ? Math.min(...pts.map((p) => p.x)) : -3;
  const maxX = pts.length ? Math.max(...pts.map((p) => p.x)) : 3;
  const minZ = pts.length ? Math.min(...pts.map((p) => p.z)) : -3;
  const maxZ = pts.length ? Math.max(...pts.map((p) => p.z)) : 3;
  const scale = Math.min((w - 60) / Math.max(maxX - minX, 2), (h - 60) / Math.max(maxZ - minZ, 2));
  return { scale, rot, ox: (w - (maxX + minX) * scale) / 2, oy: (h - (maxZ + minZ) * scale) / 2 };
}

/** Snap distances in meters for the current zoom. */
function snapTolerance(v: ViewBox): SnapTolerance {
  return { corner: SNAP_CORNER_PX / v.scale, wall: SNAP_WALL_PX / v.scale, axis: SNAP_AXIS_PX / v.scale };
}

/** Corners and walls of every room but the one being edited. */
function snapTargets(rooms: MapRoom[], exceptRoomId: string): SnapTargets {
  const others = rooms.filter((r) => r.id !== exceptRoomId);
  return { corners: others.flatMap((r) => r.points), walls: others.flatMap((r) => roomWalls(r.points)) };
}

function area(pts: FloorPoint[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

function Canvas({
  doc,
  view,
  sel,
  guides,
  snapshot,
  width,
  height,
}: {
  doc: Doc;
  view: ViewBox;
  sel: Selection;
  guides: SnapGuide[];
  snapshot: Snapshot | null;
  width: number;
  height: number;
}) {
  const X = (p: FloorPoint) => screenOf(p, view).sx;
  const Y = (p: FloorPoint) => screenOf(p, view).sy;
  const selRoomId = sel?.kind === 'room' || sel?.kind === 'corner' ? sel.roomId : null;

  // 1 m grid in map coordinates (it turns with the map), so sizes are readable at a glance.
  const grid: JSX.Element[] = [];
  const ends = [metersOf(0, 0, view), metersOf(width, 0, view), metersOf(0, height, view), metersOf(width, height, view)];
  const x0 = Math.floor(Math.min(...ends.map((p) => p.x)));
  const x1 = Math.ceil(Math.max(...ends.map((p) => p.x)));
  const z0 = Math.floor(Math.min(...ends.map((p) => p.z)));
  const z1 = Math.ceil(Math.max(...ends.map((p) => p.z)));
  if (x1 - x0 < 80 && z1 - z0 < 80) {
    for (let x = x0; x <= x1; x++) grid.push(<Line key={`x${x}`} x1={X({ x, z: z0 })} y1={Y({ x, z: z0 })} x2={X({ x, z: z1 })} y2={Y({ x, z: z1 })} stroke="#ffffff" strokeOpacity={0.05} />);
    for (let z = z0; z <= z1; z++) grid.push(<Line key={`z${z}`} x1={X({ x: x0, z })} y1={Y({ x: x0, z })} x2={X({ x: x1, z })} y2={Y({ x: x1, z })} stroke="#ffffff" strokeOpacity={0.05} />);
  }

  const ordered = [...doc.rooms].sort((a, b) => Number(a.id === selRoomId) - Number(b.id === selRoomId));

  return (
    <Svg width={width} height={height} pointerEvents="none">
      {grid}
      {ordered.map((r) => {
        if (r.points.length < 2) return null;
        const selected = r.id === selRoomId;
        const d = r.points.map((p, i) => `${i ? 'L' : 'M'}${X(p)},${Y(p)}`).join(' ') + ' Z';
        // Name near the top of the room as shown on screen, whatever the orientation.
        const label = { sx: X(centroid(r.points)), sy: Math.min(...r.points.map(Y)) + 22 };
        return (
          <G key={r.id}>
            <Path
              d={d}
              fill={r.outdoor ? PLAN_COLORS.outdoorFill : PLAN_COLORS.roomFill}
              stroke={selected ? ACCENT : PLAN_COLORS.wall}
              strokeWidth={selected ? 3 : 2}
              strokeDasharray={r.outdoor ? '6 4' : undefined}
            />
            <SvgText x={label.sx} y={label.sy} fill={r.hueRoomId ? PLAN_COLORS.label : theme.danger} fontSize={13} textAnchor="middle">
              {r.hueRoomId ? r.name : `${r.name} (no Hue room)`}
            </SvgText>
            {selected &&
              r.points.map((p, i) => {
                const q = r.points[(i + 1) % r.points.length];
                const m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
                return (
                  <G key={i}>
                    <SvgText x={X(m)} y={Y(m) - 10} fill={theme.text} fontSize={11} textAnchor="middle">
                      {`${distance(p, q).toFixed(2)} m`}
                    </SvgText>
                    <Circle cx={X(m)} cy={Y(m)} r={6} fill={theme.bg} stroke={ACCENT} strokeWidth={1.5} />
                  </G>
                );
              })}
            {selected &&
              r.points.map((p, i) => (
                <Circle
                  key={`c${i}`}
                  cx={X(p)}
                  cy={Y(p)}
                  r={sel?.kind === 'corner' && sel.index === i ? 13 : 10}
                  fill={sel?.kind === 'corner' && sel.index === i ? ACCENT : theme.bg}
                  stroke={ACCENT}
                  strokeWidth={2.5}
                />
              ))}
          </G>
        );
      })}
      {guides.map((g, i) =>
        g.kind === 'point' ? (
          <Circle key={`g${i}`} cx={X(g.at)} cy={Y(g.at)} r={17} fill="none" stroke={ACCENT} strokeWidth={2} />
        ) : (
          <Line key={`g${i}`} x1={X(g.a)} y1={Y(g.a)} x2={X(g.b)} y2={Y(g.b)} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 4" />
        ),
      )}
      {/* What each light is on the floor first (a bar, a row of beads), under every marker. */}
      {doc.lights.map((l) => {
        const kind = directional(l.lightId, snapshot);
        const light = snapshot?.lights.find((x) => x.id === l.lightId);
        return kind && light ? <Footprint key={`f-${l.lightId}`} l={l} light={light} rooms={doc.rooms} kind={kind} view={view} /> : null;
      })}
      {doc.lights.map((l) => {
        const light = snapshot?.lights.find((x) => x.id === l.lightId);
        const selected = sel?.kind === 'light' && sel.lightId === l.lightId;
        const kind = directional(l.lightId, snapshot);
        return (
          <G key={l.lightId}>
            {selected && <Circle cx={X(l)} cy={Y(l)} r={22} fill="none" stroke={ACCENT} strokeWidth={2} />}
            {selected && light && kind && <Handle l={l} rooms={doc.rooms} kind={kind} view={view} />}
            {light ? (
              <MarkerG light={light} x={X(l)} y={Y(l)} angle={kind === 'bar' ? lightAngle(l, doc.rooms) + view.rot : undefined} />
            ) : (
              <Circle cx={X(l)} cy={Y(l)} r={11} fill={PLAN_COLORS.off} stroke={PLAN_COLORS.offStroke} strokeWidth={2} />
            )}
            <SvgText x={X(l)} y={Y(l) + 32} fill={selected ? ACCENT : theme.muted} fontSize={11} textAnchor="middle">
              {light?.name ?? '?'}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
