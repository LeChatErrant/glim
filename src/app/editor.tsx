import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { PanResponder, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { identifyLight, type Snapshot } from '../lib/hue/client';
import { useSnapshot } from '../lib/hue/useSnapshot';
import { centroid, distance, pointInPolygon, snapPoint } from '../lib/map/geometry';
import { loadMap, saveMap, type FloorPoint, type HomeMap, type MapLight, type MapRoom } from '../lib/map/map';
import { PLAN_COLORS } from '../lib/map/svg';
import { Body, Button, Chip } from '../ui/components';
import { offerMoveToRoom } from '../ui/offerMoveToRoom';
import { RoomAssign } from '../ui/RoomAssign';
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

/** Screen = meters × scale + offset. */
type ViewBox = { scale: number; ox: number; oy: number };

type Drag =
  | { kind: 'corner'; roomId: string; index: number }
  | { kind: 'room'; roomId: string }
  | { kind: 'light'; lightId: string }
  | { kind: 'pan'; start: ViewBox }
  | { kind: 'pinch'; start: ViewBox; dist: number; cx: number; cy: number };

const HIT_PX = 26;
const ACCENT = theme.accent;

export default function Editor() {
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => {
    loadMap().then((m) => setDoc(m ? { rooms: m.rooms, lights: m.lights } : { rooms: [], lights: [] }));
  }, []);
  if (!doc) return null;
  return <EditorCanvas initial={doc} />;
}

function EditorCanvas({ initial }: { initial: Doc }) {
  const insets = useSafeAreaInsets();
  const { snapshot, refresh } = useSnapshot(5000);
  const [doc, setDoc] = useState<Doc>(initial);
  const [draft, setDraft] = useState<Doc | null>(null);
  const [history, setHistory] = useState<Doc[]>([]);
  const [sel, setSel] = useState<Selection>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewBox | null>(null);

  const shown = draft ?? doc;

  // PanResponder is created once; it reads the latest values through this ref.
  const live = useRef({ doc, shown, sel, view, snapshot });
  live.current = { doc, shown, sel, view, snapshot };

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
    const map: HomeMap = { version: 2, rooms: next.rooms, lights: next.lights, updatedAt: Date.now() };
    await saveMap(map);
    refreshAllWidgets();
  }

  // Fit the whole plan on screen the first time we know the canvas size.
  useEffect(() => {
    if (!size.w || view) return;
    const pts = [...doc.rooms.flatMap((r) => r.points), ...doc.lights];
    const minX = pts.length ? Math.min(...pts.map((p) => p.x)) : -3;
    const maxX = pts.length ? Math.max(...pts.map((p) => p.x)) : 3;
    const minZ = pts.length ? Math.min(...pts.map((p) => p.z)) : -3;
    const maxZ = pts.length ? Math.max(...pts.map((p) => p.z)) : 3;
    const scale = Math.min((size.w - 60) / Math.max(maxX - minX, 2), (size.h - 60) / Math.max(maxZ - minZ, 2));
    setView({ scale, ox: (size.w - (maxX + minX) * scale) / 2, oy: (size.h - (maxZ + minZ) * scale) / 2 });
  }, [size, view, doc]);

  const toScreen = (p: FloorPoint, v: ViewBox) => ({ sx: p.x * v.scale + v.ox, sy: p.z * v.scale + v.oy });
  const toMeters = (sx: number, sy: number, v: ViewBox): FloorPoint => ({ x: (sx - v.ox) / v.scale, z: (sy - v.oy) / v.scale });

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
            if (drag.current?.kind !== 'pinch') {
              drag.current = { kind: 'pinch', start: v, dist, cx, cy };
              setDraft(null);
              return;
            }
            const p = drag.current;
            const scale = Math.max(10, Math.min(600, p.start.scale * (dist / p.dist)));
            // Keep the point between the fingers fixed while zooming.
            const mx = (p.cx - p.start.ox) / p.start.scale;
            const my = (p.cy - p.start.oy) / p.start.scale;
            setView({ scale, ox: cx - mx * scale, oy: cy - my * scale });
            return;
          }
          const d = drag.current;
          if (!d || d.kind === 'pinch') return;
          if (d.kind === 'pan') {
            setView({ ...d.start, ox: d.start.ox + g.dx, oy: d.start.oy + g.dy });
            return;
          }
          const dx = g.dx / v.scale;
          const dz = g.dy / v.scale;
          const from = dragBase.current ?? base;
          if (d.kind === 'corner') {
            setDraft({
              ...from,
              rooms: from.rooms.map((r) =>
                r.id === d.roomId ? { ...r, points: r.points.map((p, i) => (i === d.index ? { x: p.x + dx, z: p.z + dz } : p)) } : r,
              ),
            });
          } else if (d.kind === 'room') {
            setDraft({
              ...from,
              rooms: from.rooms.map((r) => (r.id === d.roomId ? { ...r, points: r.points.map((p) => ({ x: p.x + dx, z: p.z + dz })) } : r)),
            });
          } else if (d.kind === 'light') {
            setDraft({ ...from, lights: from.lights.map((l) => (l.lightId === d.lightId ? { ...l, x: l.x + dx, z: l.z + dz } : l)) });
          }
        },
        onPanResponderRelease: (e) => {
          const d = drag.current;
          drag.current = null;
          dragBase.current = null;
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
          const draftDoc = live.current.shown;
          if (!d || d.kind === 'pan' || d.kind === 'pinch' || draftDoc === live.current.doc) return;
          if (d.kind === 'corner') {
            const others = draftDoc.rooms.flatMap((r) => r.points.filter((_, i) => !(r.id === d.roomId && i === d.index)));
            const rooms = draftDoc.rooms.map((r) =>
              r.id === d.roomId ? { ...r, points: r.points.map((p, i) => (i === d.index ? snapPoint(p, others) : p)) } : r,
            );
            commit({ ...draftDoc, rooms });
            setSel({ kind: 'corner', roomId: d.roomId, index: d.index });
          } else if (d.kind === 'room') {
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
      id: `room-${Date.now()}`,
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
    const c = toMeters(size.w / 2, size.h / 2, view);
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

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: 'Edit map',
          headerRight: () => (
            <Pressable onPress={undo} disabled={!history.length} hitSlop={12} style={{ opacity: history.length ? 1 : 0.35, padding: 8 }}>
              <Text style={{ color: theme.text, fontSize: 16 }}>↶ Undo</Text>
            </Pressable>
          ),
        }}
      />
      <View style={{ flex: 1 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} {...responder.panHandlers}>
        {view && <Canvas doc={shown} view={view} sel={sel} snapshot={snapshot} width={size.w} height={size.h} />}
        {!doc.rooms.length && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 24, left: 24, right: 24 }}>
            <Body muted>Start with Add room, then drag the corners to the shape of your room. Tap a wall's middle dot to add a corner.</Body>
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
            <Body muted>Drag the room to move it, drag a corner to reshape it, tap a wall's middle dot to add a corner.</Body>
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
          </>
        )}
      </View>
    </View>
  );
}

/** Lights not on the map first, then the rest. */
function sortLightsForPlacing(s: Snapshot, placed: Set<string>) {
  return [...s.lights].sort((a, b) => Number(placed.has(a.id)) - Number(placed.has(b.id)));
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

function Canvas({ doc, view, sel, snapshot, width, height }: { doc: Doc; view: ViewBox; sel: Selection; snapshot: Snapshot | null; width: number; height: number }) {
  const X = (p: FloorPoint) => p.x * view.scale + view.ox;
  const Y = (p: FloorPoint) => p.z * view.scale + view.oy;
  const selRoomId = sel?.kind === 'room' || sel?.kind === 'corner' ? sel.roomId : null;

  // 1 m grid, so sizes are readable at a glance.
  const grid: JSX.Element[] = [];
  const x0 = Math.floor(-view.ox / view.scale);
  const x1 = Math.ceil((width - view.ox) / view.scale);
  const z0 = Math.floor(-view.oy / view.scale);
  const z1 = Math.ceil((height - view.oy) / view.scale);
  if (x1 - x0 < 80) {
    for (let x = x0; x <= x1; x++) grid.push(<Line key={`x${x}`} x1={X({ x, z: 0 })} x2={X({ x, z: 0 })} y1={0} y2={height} stroke="#ffffff" strokeOpacity={0.05} />);
    for (let z = z0; z <= z1; z++) grid.push(<Line key={`z${z}`} y1={Y({ x: 0, z })} y2={Y({ x: 0, z })} x1={0} x2={width} stroke="#ffffff" strokeOpacity={0.05} />);
  }

  const ordered = [...doc.rooms].sort((a, b) => Number(a.id === selRoomId) - Number(b.id === selRoomId));

  return (
    <Svg width={width} height={height} pointerEvents="none">
      {grid}
      {ordered.map((r) => {
        if (r.points.length < 2) return null;
        const selected = r.id === selRoomId;
        const d = r.points.map((p, i) => `${i ? 'L' : 'M'}${X(p)},${Y(p)}`).join(' ') + ' Z';
        const c = { x: centroid(r.points).x, z: Math.min(...r.points.map((p) => p.z)) + 22 / view.scale };
        return (
          <G key={r.id}>
            <Path
              d={d}
              fill={r.outdoor ? PLAN_COLORS.outdoorFill : PLAN_COLORS.roomFill}
              stroke={selected ? ACCENT : PLAN_COLORS.wall}
              strokeWidth={selected ? 3 : 2}
              strokeDasharray={r.outdoor ? '6 4' : undefined}
            />
            <SvgText x={X(c)} y={Y(c)} fill={r.hueRoomId ? PLAN_COLORS.label : theme.danger} fontSize={13} textAnchor="middle">
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
      {doc.lights.map((l) => {
        const light = snapshot?.lights.find((x) => x.id === l.lightId);
        const selected = sel?.kind === 'light' && sel.lightId === l.lightId;
        return (
          <G key={l.lightId}>
            {selected && <Circle cx={X(l)} cy={Y(l)} r={20} fill="none" stroke={ACCENT} strokeWidth={2.5} />}
            <Circle
              cx={X(l)}
              cy={Y(l)}
              r={11}
              fill={light?.on ? light.color : PLAN_COLORS.off}
              stroke={light?.on ? 'none' : PLAN_COLORS.offStroke}
              strokeWidth={2}
            />
            <SvgText x={X(l)} y={Y(l) + 28} fill={theme.muted} fontSize={11} textAnchor="middle">
              {light?.name ?? '?'}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
