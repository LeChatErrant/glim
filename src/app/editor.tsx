import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { PanResponder, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { identifyLight, type Light, type Snapshot } from '../lib/hue/client';
import { DEFAULT_LENGTH, lightShape, lightTypeLabel } from '../lib/lights';
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
import { roomForPoint } from '../lib/map/glow';
import { loadMap, saveMap, saveMapRotation, type FloorPoint, type HomeMap, type MapLight, type MapRoom, type Plan } from '../lib/map/map';
import { PLAN_COLORS } from '../lib/map/svg';
import { locate, pointAt, runPath, runSamples, wallRun, wrapStep, type WallRun } from '../lib/map/wallPath';
import { PillButton } from '../ui/controls';
import { EditorSheet, EditorTop, LightRow, RoomPicker, SheetTitle } from '../ui/editor/parts';
import { LightMarker } from '../ui/FloorPlan';
import { iconPath } from '../ui/icons';
import { offerMoveToRoom } from '../ui/offerMoveToRoom';
import { turnTo } from '../ui/MapGestures';
import { Display, Label, Txt } from '../ui/text';
import { color, font, hairline } from '../ui/theme';
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
const ACCENT = color.champagne;
/** Size of a light marker on the plan, as on the Map tab. */
const MARKER_SIZE = 22;

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
        const run = runOf(selLight, d.rooms, live.current.snapshot, kind);
        const { sx: x, sy: y } = toScreen(handleAt(selLight, d.rooms, kind, v.scale, end, run), v);
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
  /** Stretching a string or strip along the walls: where it starts and how long it is, around the outline. */
  const wallDrag = useRef<{ from: number; len: number } | null>(null);

  const responder = useMemo(
    () =>
      // The handlers only read refs when touched, never during render.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          moved.current = false;
          wallDrag.current = null;
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
            const run = runOf(light, from.rooms, live.current.snapshot, kind);
            if (run) {
              // Along the walls: the end follows the finger around the room, corners included. The
              // light moves to the middle of the run, so the run is still found from it.
              const w = (wallDrag.current ??= { from: run.from, len: run.len });
              const end = d.end === 1 ? w.from + w.len : w.from;
              const knob = pointAt(run, end);
              const step = wrapStep(end, locate(run.pts, { u: knob.u + dx, v: knob.v + dz }).s, run.total);
              const len = Math.max(0.3, Math.min(run.total, w.len + (d.end === 1 ? step : -step)));
              if (d.end === -1) w.from += w.len - len;
              w.len = len;
              const mid = pointAt(run, w.from + w.len / 2);
              setGuides([]);
              setDraft({ ...from, lights: from.lights.map((l) => (l.lightId === d.lightId ? { ...l, x: mid.u, z: mid.v, length: Math.round(len * 10) / 10 } : l)) });
              return;
            }
            // The handle follows the finger: its direction turns the light, its reach sets a string's or strip's length.
            const knob = handleAt(light, from.rooms, kind, v.scale, d.end, null);
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
  const selKind = selPlaced ? directional(selPlaced.lightId, snapshot) : null;
  const selRun = selPlaced && selKind ? runOf(selPlaced, doc.rooms, snapshot, selKind) : null;

  const unplaced = snapshot ? snapshot.lights.filter((l) => !placedIds.has(l.id)).length : 0;
  const hint =
    selKind &&
    (selRun
      ? `Drag an end to stretch the ${selKind === 'strip' ? 'strip' : 'string'} along the walls, around corners. Drag the light to slide it.`
      : selKind === 'string'
        ? 'Drag an end to turn the string and stretch it to its real length.'
        : selKind === 'strip'
          ? 'Drag an end to turn the strip and stretch it to its real length. It snaps to walls.'
          : selKind === 'lantern'
            ? 'Drag the handle to turn it along the wall it hangs on. It snaps to walls.'
            : 'Drag the handle to turn the bar the way it really stands. It snaps to walls.');

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <EditorTop onBack={() => router.back()} onTurn={turnRight} onUndo={undo} canUndo={history.length > 0} />
      <View
        style={{ flex: 1, overflow: 'hidden' }}
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
          <View pointerEvents="none" style={{ position: 'absolute', top: 18, left: 24, right: 24, gap: 6 }}>
            <Display size={28}>
              Draw <Display size={28} style={{ color: color.champagne }}>your home</Display>
            </Display>
            <Txt size={13} tone="secondary" style={{ lineHeight: 18 }}>
              {"Start with Add room, then drag the corners to the shape of your room. Tap a wall's middle dot to add a corner."}
            </Txt>
          </View>
        )}
      </View>

      <EditorSheet>
        {sel === null && (
          <>
            <Txt size={13} tone="secondary" style={{ lineHeight: 18 }}>
              {doc.rooms.length ? 'Tap a room or a light to change it. Pinch to zoom, twist to turn.' : 'Close enough is fine: you can fine-tune it any time.'}
            </Txt>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PillButton title="Add room" icon="add" kind="primary" height={48} style={{ flex: 1 }} onPress={addRoom} />
              <PillButton title="Add light" icon="light" height={48} style={{ flex: 1 }} onPress={() => setSel({ kind: 'add-light' })} />
            </View>
          </>
        )}

        {sel?.kind === 'add-light' && (
          <>
            <SheetTitle title="Place a light" sub={unplaced ? `${unplaced} not on the map yet · it blinks when placed` : 'All your lights are on the map · tap one to move it here'} onClose={() => setSel(null)} />
            {snapshot ? (
              <LightRow lights={sortLightsForPlacing(snapshot, placedIds)} placed={placedIds} onPick={addLight} />
            ) : (
              <Txt size={13} tone="muted">
                Finding your lights…
              </Txt>
            )}
          </>
        )}

        {selRoom && sel?.kind === 'room' && (
          <>
            <SheetTitle title={selRoom.name} sub={`${area(selRoom.points).toFixed(1)} m²${selRoom.outdoor ? ' · outdoor' : ''}${selRoom.hueRoomId ? '' : ' · no Hue room'}`} onClose={() => setSel(null)} />
            {snapshot && (
              <View style={{ gap: 8 }}>
                <Label tone="label">Which room is it</Label>
                <RoomPicker
                  rooms={snapshot.rooms}
                  // A room just drawn isn't "Other space" yet: highlight nothing until the user picks.
                  current={selRoom.hueRoomId ?? (selRoom.name === 'Other' ? null : undefined)}
                  onAssign={(c) => updateRoom(selRoom.id, { name: c.name, hueRoomId: c.hueRoomId })}
                  onRoomCreated={refresh}
                />
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <PillButton
                title="Outdoor"
                icon={selRoom.outdoor ? 'check' : undefined}
                height={44}
                onPress={() => updateRoom(selRoom.id, { outdoor: !selRoom.outdoor })}
                style={selRoom.outdoor ? { borderColor: 'rgba(233,207,159,0.55)' } : undefined}
              />
              <PillButton
                title="Delete room"
                kind="text"
                height={44}
                onPress={() => {
                  commit({ ...doc, rooms: doc.rooms.filter((r) => r.id !== selRoom.id) });
                  setSel(null);
                }}
              />
            </View>
            <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
              {"Drag the room to move it, drag a corner to reshape it, tap a wall's middle dot to add a corner."}
            </Txt>
          </>
        )}

        {selRoom && sel?.kind === 'corner' && (
          <>
            <SheetTitle title={`Corner ${sel.index + 1} of ${selRoom.points.length}`} sub={`${selRoom.name} · drag it to reshape the room`} onClose={() => setSel({ kind: 'room', roomId: selRoom.id })} />
            <View style={{ flexDirection: 'row' }}>
              <PillButton
                title="Delete corner"
                height={44}
                disabled={selRoom.points.length <= 3}
                onPress={() => {
                  updateRoom(selRoom.id, { points: selRoom.points.filter((_, i) => i !== sel.index) });
                  setSel({ kind: 'room', roomId: selRoom.id });
                }}
              />
            </View>
          </>
        )}

        {sel?.kind === 'light' && (
          <>
            <SheetTitle
              mark={selLight ? <LightMarker light={selLight} size={30} ground={color.sheet} glow={false} /> : undefined}
              title={selLight?.name ?? 'Light'}
              sub={selLight ? lightTypeLabel(selLight) : undefined}
              onClose={() => setSel(null)}
            />
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <PillButton title="Blink" icon="blink" height={44} onPress={() => identifyLight(sel.lightId).catch(() => null)} />
              {selPlaced && selKind && selRun && (
                <PillButton
                  title="Straight"
                  height={44}
                  onPress={() => commit({ ...doc, lights: doc.lights.map((l) => (l.lightId === sel.lightId ? { ...l, angle: lightAngle(l, doc.rooms) } : l)) })}
                />
              )}
              {selPlaced && selKind && !selRun && selPlaced.angle !== undefined && (
                <PillButton
                  title="Along the wall"
                  height={44}
                  onPress={() =>
                    commit({
                      ...doc,
                      // Strings and strips keep their length: by a wall, they now follow it around corners.
                      lights: doc.lights.map((l) => (l.lightId === sel.lightId ? { ...l, angle: undefined, length: stretchy(selKind) ? l.length : undefined } : l)),
                    })
                  }
                />
              )}
              <PillButton
                title="Remove from map"
                kind="text"
                height={44}
                onPress={() => {
                  commit({ ...doc, lights: doc.lights.filter((l) => l.lightId !== sel.lightId) });
                  setSel(null);
                }}
              />
            </View>
            <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
              {hint || 'Drag the light to where it really is.'}
            </Txt>
          </>
        )}
      </EditorSheet>
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

const uv = (p: FloorPoint) => ({ u: p.x, v: p.z });
const xz = (p: { u: number; v: number }): FloorPoint => ({ x: p.u, z: p.v });

/**
 * A string or strip that runs along the walls of its room, around corners (it sits by a wall and
 * wasn't turned by hand); null when it's a straight line. Same rule as the Map tab draws.
 */
function runOf(l: MapLight, rooms: MapRoom[], s: Snapshot | null, kind: Directional): WallRun | null {
  if (!stretchy(kind) || l.angle !== undefined) return null;
  const plan: Plan = { width: 0, height: 0, rooms: rooms.map((r) => ({ ...r, pts: r.points.map(uv) })), lights: [] };
  const hueRoomId = s?.lights.find((x) => x.id === l.lightId)?.roomId ?? null;
  const room = roomForPoint(plan, uv(l), hueRoomId);
  return room ? wallRun(room.pts, uv(l), lengthOf(l, kind)) : null;
}

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

/** Where a light's handle sits: the ends of a string or strip (its length, around corners along the walls), or a fixed reach for the others. */
function handleAt(l: MapLight, rooms: MapRoom[], kind: Directional, scale: number, end: 1 | -1, run: WallRun | null): FloorPoint {
  if (run) return xz(pointAt(run, end === 1 ? run.from + run.len : run.from));
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

/**
 * The selected light's handle: a knob with a turn icon at the end of a dashed arm, labeled with
 * what dragging it does. String lights and strips get a knob at each end, and their length in the middle.
 */
function Handle({ l, rooms, kind, view, run }: { l: MapLight; rooms: MapRoom[]; kind: Directional; view: ViewBox; run: WallRun | null }) {
  const X = (p: FloorPoint) => screenOf(p, view).sx;
  const Y = (p: FloorPoint) => screenOf(p, view).sy;
  const a = handleAt(l, rooms, kind, view.scale, 1, run);
  const b = stretchy(kind) ? handleAt(l, rooms, kind, view.scale, -1, run) : l;
  const knob = (p: FloorPoint, key: string) => (
    <G key={key}>
      <Circle cx={X(p)} cy={Y(p)} r={19} fill={ACCENT} fillOpacity={0.1} />
      <Circle cx={X(p)} cy={Y(p)} r={14} fill={color.ground} stroke={ACCENT} strokeOpacity={0.9} strokeWidth={1.2} />
      <Path d={iconPath('rotate')} fill="none" stroke={ACCENT} strokeWidth={1.6 * (24 / 15)} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${X(p) - 7.5} ${Y(p) - 7.5}) scale(${15 / 24})`} />
    </G>
  );
  const length = stretchy(kind) ? `${lengthOf(l, kind).toFixed(1)} m` : null;
  return (
    <G>
      {!run && <Line x1={X(b)} y1={Y(b)} x2={X(a)} y2={Y(a)} stroke={ACCENT} strokeOpacity={0.7} strokeWidth={1} strokeDasharray="4 4" />}
      {knob(a, 'a')}
      {stretchy(kind) && knob(b, 'b')}
      {/* Along the walls the middle of the knobs can be anywhere (on the light, outside the room): the length goes with the label. */}
      <PlanChip x={X(a)} y={Y(a) - 31} text={run ? `STRETCH · ${length}` : stretchy(kind) ? 'TURN · STRETCH' : 'TURN'} />
      {length && !run && <PlanChip x={(X(a) + X(b)) / 2} y={(Y(a) + Y(b)) / 2 - 26} text={length} />}
    </G>
  );
}

/** How far out from a wall's middle a length chip sits so it clears the wall's add-corner dot: further on upright walls (the chip is wide). */
const chipOut = (w: { nx: number; ny: number; text: string }) => 12 + Math.abs(w.nx) * ((w.text.length * 6.4 + 16) / 2) + Math.abs(w.ny) * 10;

/** A small dark pill with champagne capitals, centered on (x, y): wall lengths, handle labels. */
function PlanChip({ x: at, y, text, within }: { x: number; y: number; text: string; within?: number }) {
  const w = text.length * 6.4 + 16;
  // Kept on screen when a width is given (a wall by the screen's edge).
  const x = within ? Math.min(Math.max(at, w / 2 + 6), within - w / 2 - 6) : at;
  return (
    <G>
      <Rect x={x - w / 2} y={y - 10} width={w} height={20} rx={10} fill={color.ground} fillOpacity={0.92} stroke={ACCENT} strokeOpacity={0.55} strokeWidth={1} />
      <SvgText x={x} y={y + 3.5} fill={ACCENT} fontFamily={font.uiMedium} fontSize={10} letterSpacing={0.8} textAnchor="middle">
        {text}
      </SvgText>
    </G>
  );
}

/**
 * What the light physically is, on the floor: a light bar's length, a string's row of beads or a
 * strip (their real length), a lantern's wall plate. Turning the handle turns this, so its effect shows.
 * Drawn like the Map tab: a warm core in a halo of the light's color, dark when off.
 */
function Footprint({ l, light, rooms, kind, view, run }: { l: MapLight; light: Light; rooms: MapRoom[]; kind: Directional; view: ViewBox; run: WallRun | null }) {
  const on = light.on && light.reachable;
  const tint = on ? light.color : hairline(0.45);
  const core = on ? '#FFE2B0' : '#4A4640';
  const bead = (key: number, x: number, y: number) => (
    <G key={key}>
      {on && <Circle cx={x} cy={y} r={5} fill={light.color} fillOpacity={0.35} />}
      <Circle cx={x} cy={y} r={2} fill={core} />
    </G>
  );
  if (run) {
    // Along the walls, turning at corners: the strip itself, or the string's line and its beads.
    const pts = runPath(run)
      .map((p) => screenOf(xz(p), view))
      .map((p) => `${p.sx},${p.sy}`)
      .join(' ');
    if (kind === 'strip') {
      return (
        <G>
          {on && <Polyline points={pts} fill="none" stroke={tint} strokeOpacity={0.45} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />}
          <Polyline points={pts} fill="none" stroke={core} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </G>
      );
    }
    const beads = runSamples(run, Math.max(3, Math.round(run.len / 0.3)) + 1).map((p) => screenOf(xz(p), view));
    return (
      <G>
        <Polyline points={pts} fill="none" stroke={tint} strokeOpacity={0.4} strokeWidth={1} />
        {beads.map((b, i) => bead(i, b.sx, b.sy))}
      </G>
    );
  }
  const a = (lightAngle(l, rooms) * Math.PI) / 180;
  const half = stretchy(kind) ? lengthOf(l, kind) / 2 : kind === 'bar' ? 0.3 : 0.25;
  const at = (t: number) => screenOf({ x: l.x + Math.cos(a) * t, z: l.z + Math.sin(a) * t }, view);
  const p = at(-half);
  const q = at(half);
  if (kind === 'string') {
    const n = Math.max(3, Math.round((half * 2) / 0.3));
    return (
      <G>
        <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={tint} strokeOpacity={0.4} strokeWidth={1} />
        {Array.from({ length: n + 1 }, (_, i) => {
          const b = at(-half + (i * half * 2) / n);
          return bead(i, b.sx, b.sy);
        })}
      </G>
    );
  }
  if (kind === 'strip') {
    return (
      <G>
        {on && <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={tint} strokeOpacity={0.45} strokeWidth={6} strokeLinecap="round" />}
        <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={core} strokeWidth={2} strokeLinecap="round" />
      </G>
    );
  }
  // Bars and lanterns: a soft wash along the wall, the fitting as a thin line.
  return (
    <G>
      {on && <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={tint} strokeOpacity={0.3} strokeWidth={kind === 'bar' ? 12 : 8} strokeLinecap="round" />}
      <Line x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy} stroke={on ? tint : hairline(0.45)} strokeOpacity={on ? 0.85 : 1} strokeWidth={kind === 'bar' ? 4 : 2.5} strokeLinecap="round" />
    </G>
  );
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

/**
 * The plan as the editor draws it, Nocturne style: dark floors, hairline walls, the selected room in
 * champagne with its corners, wall lengths and add-a-corner dots, and lights as the Map tab's
 * markers (views, so they glow the same). Touches go to the editor's responder, never here.
 */
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
  const selRoom = doc.rooms.find((r) => r.id === selRoomId && r.points.length >= 2);
  const pathOf = (pts: FloorPoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p)},${Y(p)}`).join(' ') + ' Z';

  // 1 m grid in map coordinates (it turns with the map), so sizes are readable at a glance.
  const grid: JSX.Element[] = [];
  const ends = [metersOf(0, 0, view), metersOf(width, 0, view), metersOf(0, height, view), metersOf(width, height, view)];
  const x0 = Math.floor(Math.min(...ends.map((p) => p.x)));
  const x1 = Math.ceil(Math.max(...ends.map((p) => p.x)));
  const z0 = Math.floor(Math.min(...ends.map((p) => p.z)));
  const z1 = Math.ceil(Math.max(...ends.map((p) => p.z)));
  if (x1 - x0 < 80 && z1 - z0 < 80) {
    for (let x = x0; x <= x1; x++) grid.push(<Line key={`x${x}`} x1={X({ x, z: z0 })} y1={Y({ x, z: z0 })} x2={X({ x, z: z1 })} y2={Y({ x, z: z1 })} stroke={hairline(0.04)} strokeWidth={1} />);
    for (let z = z0; z <= z1; z++) grid.push(<Line key={`z${z}`} x1={X({ x: x0, z })} y1={Y({ x: x0, z })} x2={X({ x: x1, z })} y2={Y({ x: x1, z })} stroke={hairline(0.04)} strokeWidth={1} />);
  }

  // The selected room's walls: their length in a chip just outside the wall, a dot in the middle to add a corner.
  const walls = selRoom
    ? selRoom.points.map((p, i) => {
        const q = selRoom.points[(i + 1) % selRoom.points.length];
        const m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
        const c = centroid(selRoom.points);
        const dx = X(q) - X(p);
        const dy = Y(q) - Y(p);
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        if ((X(m) - X(c)) * nx + (Y(m) - Y(c)) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        return { i, m, nx, ny, text: `${distance(p, q).toFixed(2)} m`, long: len > 70 };
      })
    : [];

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      <Svg width={width} height={height}>
        {grid}
        {doc.rooms.map((r) =>
          r.points.length < 2 ? null : (
            <Path
              key={r.id}
              d={pathOf(r.points)}
              fill={r.outdoor ? PLAN_COLORS.outdoorFill : PLAN_COLORS.roomFill}
              stroke={hairline(r.outdoor ? 0.2 : 0.24)}
              strokeWidth={1}
              strokeDasharray={r.outdoor ? '3 4' : undefined}
            />
          ),
        )}
        {selRoom && <Path d={pathOf(selRoom.points)} fill={ACCENT} fillOpacity={0.07} />}
        {doc.rooms.map((r) => {
          if (r.points.length < 3) return null;
          // Name near the top of the room as shown on screen, whatever the orientation.
          const x = X(centroid(r.points));
          const y = Math.min(...r.points.map(Y)) + 20;
          const selected = r.id === selRoomId;
          return (
            <G key={`n-${r.id}`}>
              <SvgText x={x} y={y} fill={selected ? ACCENT : hairline(0.82)} fontFamily={font.uiMedium} fontSize={9} letterSpacing={1.44} textAnchor="middle">
                {r.name.toUpperCase()}
              </SvgText>
              {!r.hueRoomId && r.name !== 'Other' && (
                <SvgText x={x} y={y + 13} fill={color.warning} fontFamily={font.uiMedium} fontSize={8} letterSpacing={1.28} textAnchor="middle">
                  NO HUE ROOM
                </SvgText>
              )}
            </G>
          );
        })}
        {/* What each light is on the floor first (a bar, a row of beads), under every marker. */}
        {doc.lights.map((l) => {
          const kind = directional(l.lightId, snapshot);
          const light = snapshot?.lights.find((x) => x.id === l.lightId);
          return kind && light ? <Footprint key={`f-${l.lightId}`} l={l} light={light} rooms={doc.rooms} kind={kind} view={view} run={runOf(l, doc.rooms, snapshot, kind)} /> : null;
        })}
      </Svg>

      {doc.lights.map((l) => {
        const light = snapshot?.lights.find((x) => x.id === l.lightId);
        const selected = sel?.kind === 'light' && sel.lightId === l.lightId;
        const ring = MARKER_SIZE + 12;
        return (
          <View key={l.lightId} style={{ position: 'absolute', left: X(l) - 22, top: Y(l) - 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            {selected && <View style={{ position: 'absolute', width: ring, height: ring, borderRadius: ring / 2, borderWidth: 1, borderColor: 'rgba(233,207,159,0.9)', boxShadow: '0 0 14px rgba(233,207,159,0.45)' }} />}
            {light ? (
              <LightMarker light={light} size={MARKER_SIZE} />
            ) : (
              <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: hairline(0.55), backgroundColor: color.ground }} />
            )}
          </View>
        );
      })}

      <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
        {selRoom && (
          <G>
            <Path d={pathOf(selRoom.points)} fill="none" stroke={ACCENT} strokeOpacity={0.18} strokeWidth={6} strokeLinejoin="round" />
            <Path d={pathOf(selRoom.points)} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeLinejoin="round" />
          </G>
        )}
        {walls.map((w) => (
          <G key={`w${w.i}`}>
            {w.long && <PlanChip x={X(w.m) + w.nx * chipOut(w)} y={Y(w.m) + w.ny * chipOut(w)} text={w.text} within={width} />}
            <Circle cx={X(w.m)} cy={Y(w.m)} r={6} fill={color.ground} stroke={ACCENT} strokeOpacity={0.8} strokeWidth={1} />
            <Path d={`M${X(w.m) - 2.5},${Y(w.m)} h5 M${X(w.m)},${Y(w.m) - 2.5} v5`} stroke={ACCENT} strokeWidth={1.1} strokeLinecap="round" />
          </G>
        ))}
        {selRoom &&
          selRoom.points.map((p, i) => {
            const on = sel?.kind === 'corner' && sel.index === i;
            return on ? (
              <G key={`c${i}`}>
                <Circle cx={X(p)} cy={Y(p)} r={16} fill={ACCENT} fillOpacity={0.12} />
                <Circle cx={X(p)} cy={Y(p)} r={12} fill="none" stroke={ACCENT} strokeOpacity={0.9} strokeWidth={1} />
                <Rect x={X(p) - 7} y={Y(p) - 7} width={14} height={14} fill={color.ground} />
                <Rect x={X(p) - 5} y={Y(p) - 5} width={10} height={10} fill={ACCENT} />
              </G>
            ) : (
              <G key={`c${i}`}>
                <Rect x={X(p) - 6} y={Y(p) - 6} width={12} height={12} fill={color.ground} />
                <Rect x={X(p) - 4} y={Y(p) - 4} width={8} height={8} fill={color.ivory} />
              </G>
            );
          })}
        {guides.map((g, i) =>
          g.kind === 'point' ? (
            <Circle key={`g${i}`} cx={X(g.at)} cy={Y(g.at)} r={16} fill="none" stroke={ACCENT} strokeWidth={1.2} />
          ) : (
            <Line key={`g${i}`} x1={X(g.a)} y1={Y(g.a)} x2={X(g.b)} y2={Y(g.b)} stroke={ACCENT} strokeOpacity={0.85} strokeWidth={1.2} strokeDasharray="5 4" />
          ),
        )}
        {doc.lights.map((l) => {
          const light = snapshot?.lights.find((x) => x.id === l.lightId);
          const selected = sel?.kind === 'light' && sel.lightId === l.lightId;
          const kind = directional(l.lightId, snapshot);
          return (
            <G key={l.lightId}>
              {selected && light && kind && <Handle l={l} rooms={doc.rooms} kind={kind} view={view} run={runOf(l, doc.rooms, snapshot, kind)} />}
              <SvgText x={X(l)} y={Y(l) + 28} fill={selected ? ACCENT : hairline(0.55)} fontFamily={selected ? font.uiMedium : font.ui} fontSize={10} textAnchor="middle">
                {light?.name ?? '?'}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
