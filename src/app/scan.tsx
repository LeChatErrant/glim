import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';

import { ArScan, ArScanView, type ArOverlay, type ArScanHandle, type ArStatus } from '../../modules/ar-scan';
import { identifyLight, type Light, type Snapshot } from '../lib/hue/client';
import { useSnapshot } from '../lib/hue/useSnapshot';
import { apply, distance, fromTwoPoints, invert, normalizingTransform, type Transform } from '../lib/map/geometry';
import { loadMap, saveMap, type FloorPoint, type HomeMap, type MapLight, type MapRoom } from '../lib/map/map';
import { Body, Button, Chip } from '../ui/components';
import { offerMoveToRoom } from '../ui/offerMoveToRoom';
import { RoomAssign } from '../ui/RoomAssign';
import { theme } from '../ui/theme';
import { refreshAllWidgets } from '../widgets/task-handler';

type Step = 'align' | 'corners' | 'name' | 'lights' | 'between';

/**
 * Entry: checks AR support and camera access, then lets the user continue the saved map
 * or start a new one. Without AR, sends them to the manual editor.
 */
export default function Scan() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'unsupported' | 'no-permission'>('checking');
  const [existing, setExisting] = useState<HomeMap | null | undefined>(undefined);
  const [base, setBase] = useState<HomeMap | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      setExisting(await loadMap());
      const availability = await ArScan.availability();
      if (availability === 'unsupported') return setReady('unsupported');
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: 'Camera access',
        message: 'The camera is used to scan your rooms and place your lights on the map. Nothing is recorded.',
        buttonPositive: 'Allow',
      });
      setReady(granted === PermissionsAndroid.RESULTS.GRANTED ? 'ok' : 'no-permission');
    })();
  }, []);

  if (ready === 'ok' && existing !== undefined) {
    const hasMap = !!existing?.rooms.length;
    if (!hasMap || base !== undefined) return <Scanner base={hasMap ? (base ?? null) : null} />;
    return (
      <View style={styles.center}>
        <Text style={styles.title}>You already have a map</Text>
        <Body muted>
          {existing!.rooms.length} {existing!.rooms.length === 1 ? 'room' : 'rooms'} and {existing!.lights.length} {existing!.lights.length === 1 ? 'light' : 'lights'}. You can scan more rooms
          into it: you'll first match 2 corners you already scanned, so the new rooms line up.
        </Body>
        <Button title="Continue my map" primary onPress={() => setBase(existing!)} />
        <Button
          title="Start a new map"
          onPress={() =>
            Alert.alert('Start a new map?', 'Your current map is replaced as soon as you finish the first room.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Start new', style: 'destructive', onPress: () => setBase(null) },
            ])
          }
        />
        <Button title="Edit it by hand instead" onPress={() => router.replace('/editor')} />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Text style={{ color: theme.text, fontSize: 16 }}>
        {ready === 'checking' || existing === undefined
          ? 'Checking AR support…'
          : ready === 'unsupported'
            ? "This phone doesn't support AR scanning. You can draw your map by hand instead."
            : 'Camera access is needed to scan your home. You can also draw your map by hand.'}
      </Text>
      {ready !== 'checking' && <Button title="Draw my map" primary onPress={() => router.replace('/editor')} />}
      {ready !== 'checking' && <Button title="Back" onPress={() => router.back()} />}
    </View>
  );
}

/**
 * Everything the user builds during a scan. Each change is recorded so it can be undone.
 * New rooms and lights are kept in AR coordinates; `toMap` converts them to map coordinates.
 */
type ScanState = {
  step: Step;
  /** AR → map coordinates. Known after aligning (continue) or after the first room (new map). */
  toMap: Transform | null;
  /** First matched corner while aligning with a saved map. */
  alignFirst: { ar: FloorPoint; map: FloorPoint } | null;
  rooms: MapRoom[];
  current: FloorPoint[];
  lights: MapLight[];
};

/** If the last corner lands this close to the first one, Finish room treats it as a missed close. */
const MERGE_RADIUS_M = 0.6;
const START_COLOR = '#5fd39a';
const BASE_COLOR = '#8a8a93';

function Scanner({ base }: { base: HomeMap | null }) {
  const insets = useSafeAreaInsets();
  const ar = useRef<ArScanHandle>(null);
  const { snapshot, refresh } = useSnapshot(5000);
  const [status, setStatus] = useState<ArStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState>({
    step: base ? 'align' : 'corners',
    toMap: null,
    alignFirst: null,
    rooms: [],
    current: [],
    lights: [],
  });
  const [history, setHistory] = useState<ScanState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showOthers, setShowOthers] = useState(false);
  const [outdoor, setOutdoor] = useState(false);
  const [anchorRoomId, setAnchorRoomId] = useState<string | null>(base?.rooms[0]?.id ?? null);
  const [anchorCorner, setAnchorCorner] = useState(0);
  const { step, rooms, current, lights, toMap } = scan;

  function commit(next: ScanState) {
    setHistory((h) => [...h, scan]);
    setScan(next);
  }

  function undo() {
    if (!history.length) return;
    setScan(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setSelected(null);
  }

  // Save after every change once we know where things go, so a scan can stop at any time.
  useEffect(() => {
    if (!toMap) return;
    const newLights = lights.map((l) => ({ ...l, ...apply(toMap, l) }));
    const map: HomeMap = {
      version: 2,
      rooms: [...(base?.rooms ?? []), ...rooms.map((r) => ({ ...r, points: r.points.map((p) => apply(toMap, p)) }))],
      lights: [...(base?.lights ?? []).filter((l) => !newLights.some((n) => n.lightId === l.lightId)), ...newLights],
      updatedAt: Date.now(),
    };
    saveMap(map).then(() => refreshAllWidgets());
  }, [rooms, lights, toMap, base]);

  const lightById = useMemo(() => new Map((snapshot?.lights ?? []).map((l) => [l.id, l])), [snapshot]);

  // The saved map, brought into this AR session once aligned.
  const fromMap = toMap ? invert(toMap) : null;
  const baseRoomsAr = base && fromMap ? base.rooms.map((r) => ({ ...r, points: r.points.map((p) => apply(fromMap, p)) })) : [];
  const baseLightsAr =
    base && fromMap ? base.lights.filter((l) => !lights.some((n) => n.lightId === l.lightId)).map((l) => ({ ...l, ...apply(fromMap, l) })) : [];

  const overlay: ArOverlay = useMemo(
    () => ({
      polylines: [
        ...baseRoomsAr.map((r) => ({ points: r.points, closed: true, color: BASE_COLOR })),
        ...rooms.map((r) => ({ points: r.points, closed: true, color: '#c8c8d0' })),
        { points: current, closed: false, color: theme.accent },
      ],
      markers: [
        // Numbered corners of the room being traced; the first one is the target to close it.
        ...current.map((p, i) => ({
          ...p,
          color: i === 0 ? START_COLOR : theme.accent,
          label: i === 0 ? 'Start' : String(i + 1),
          edge: i === 0 && current.length >= 2,
        })),
        ...[...baseLightsAr, ...lights].map((l) => ({
          x: l.x,
          z: l.z,
          color: lightById.get(l.lightId)?.color ?? '#ffcc66',
          label: lightById.get(l.lightId)?.name,
        })),
      ],
      activeIndex: step === 'corners' ? baseRoomsAr.length + rooms.length : -1,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rooms, current, lights, step, lightById, toMap],
  );

  const lastRoom = rooms[rooms.length - 1];

  // ---- Aligning with a saved map ---------------------------------------------

  const anchorRoom = base?.rooms.find((r) => r.id === anchorRoomId);
  const anchorTarget = anchorRoom
    ? anchorRoom.points[(anchorCorner + (scan.alignFirst ? 1 : 0)) % anchorRoom.points.length]
    : undefined;

  async function matchCorner() {
    const p = await ar.current?.capture();
    if (!p || !anchorTarget) return;
    const here = { x: p.rawX, z: p.rawZ };
    if (!scan.alignFirst) return commit({ ...scan, alignFirst: { ar: here, map: anchorTarget } });
    const first = scan.alignFirst;
    const dAr = distance(first.ar, here);
    const dMap = distance(first.map, anchorTarget);
    if (Math.abs(dAr - dMap) > Math.max(0.4, dMap * 0.25)) {
      Alert.alert(
        "Those corners don't match",
        `They're ${dAr.toFixed(1)} m apart here, but ${dMap.toFixed(1)} m on your map. Check you aimed at the highlighted corners, then try again.`,
      );
      return commit({ ...scan, alignFirst: null });
    }
    commit({ ...scan, alignFirst: null, toMap: fromTwoPoints(first.ar, here, first.map, anchorTarget), step: 'between' });
  }

  // ---- Tracing rooms and placing lights --------------------------------------

  async function addCorner() {
    const p = await ar.current?.capture();
    if (!p) return;
    if (p.closesShape) return finishRoom();
    commit({ ...scan, current: [...current, { x: p.x, z: p.z }] });
  }

  function finishRoom() {
    let points = current;
    // A last corner right next to the first one is almost always a missed close.
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length >= 4 && distance(first, last) < MERGE_RADIUS_M) points = points.slice(0, -1);
    if (points.length < 3) return;
    setOutdoor(false);
    commit({
      ...scan,
      step: 'name',
      current: [],
      // A new map is laid out from its first room: first wall along +x, first corner at 0.
      toMap: scan.toMap ?? normalizingTransform(points),
      rooms: [...rooms, { id: `room-${Date.now()}`, name: '', hueRoomId: null, points }],
    });
  }

  function nameRoom(name: string, hueRoomId: string | null) {
    setShowOthers(false);
    commit({
      ...scan,
      step: 'lights',
      rooms: rooms.map((room, i) => (i === rooms.length - 1 ? { ...room, name, hueRoomId, outdoor } : room)),
    });
  }

  function pick(light: Light) {
    setSelected(light.id);
    identifyLight(light.id).catch(() => null);
  }

  async function place() {
    if (!selected || !lastRoom) return;
    const p = await ar.current?.capture();
    if (!p) return;
    // Lights are placed where the user aims, not snapped to walls.
    commit({ ...scan, lights: [...lights.filter((l) => l.lightId !== selected), { lightId: selected, x: p.rawX, z: p.rawZ }] });
    offerMoveToRoom(snapshot, selected, lastRoom, refresh);
    setSelected(null);
  }

  function exit() {
    if (!current.length) return router.back();
    Alert.alert('Leave the scan?', 'Finished rooms are saved. The room you are tracing now will be lost.', [
      { text: 'Keep scanning', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);
  }

  const instruction = instructionFor(status, step, current.length, !!scan.alignFirst, selected ? lightById.get(selected)?.name : undefined);

  // Mini-map: in map coordinates while aligning (we don't know where the user is yet),
  // in AR coordinates afterwards (with the user's position).
  const mini =
    step === 'align' && base
      ? {
          outlines: base.rooms.map((r) => ({ points: r.points, color: r.id === anchorRoomId ? '#ffffff' : BASE_COLOR })),
          dots: [
            ...(scan.alignFirst ? [{ p: scan.alignFirst.map, color: START_COLOR, r: 4 }] : []),
            ...(anchorTarget ? [{ p: anchorTarget, color: '#ffcc66', r: 6 }] : []),
          ],
          camera: undefined,
        }
      : {
          outlines: [
            ...baseRoomsAr.map((r) => ({ points: r.points, color: BASE_COLOR })),
            ...rooms.map((r) => ({ points: r.points, color: '#c8c8d0' })),
            ...(current.length ? [{ points: current, color: theme.accent, open: true }] : []),
          ],
          dots: [
            ...current.map((p, i) => ({ p, color: i === 0 ? START_COLOR : theme.accent, r: i === 0 ? 4.5 : 2.5 })),
            ...[...baseLightsAr, ...lights].map((l) => ({ p: l, color: '#ffcc66', r: 3.5 })),
          ],
          camera: status?.camera ? { p: status.camera, heading: status.heading } : undefined,
        };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <ArScanView
        ref={ar}
        style={StyleSheet.absoluteFill}
        overlay={overlay}
        snapEnabled={snap}
        onStatus={setStatus}
        onError={(e) => setError(e.message)}
      />

      {/* Center crosshair, so the user knows where the reticle is cast from. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={exit} hitSlop={12} style={styles.round} accessibilityLabel="Leave the scan">
          <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
        </Pressable>
        <Text style={styles.instruction}>{error ?? instruction}</Text>
        <Pressable
          onPress={undo}
          disabled={!history.length}
          hitSlop={12}
          style={[styles.round, !history.length && { opacity: 0.35 }]}
          accessibilityLabel="Undo"
        >
          <Text style={{ color: '#fff', fontSize: 20 }}>↶</Text>
        </Pressable>
      </View>

      <MiniMap {...mini} top={insets.top + 70} />

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {step === 'align' && base && (
          <>
            <Text style={styles.sheetTitle}>Line up with your map</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {base.rooms.map((r) => (
                <Chip
                  key={r.id}
                  label={r.name || 'Room'}
                  active={r.id === anchorRoomId}
                  onPress={() => {
                    setAnchorRoomId(r.id);
                    setAnchorCorner(0);
                    if (scan.alignFirst) commit({ ...scan, alignFirst: null });
                  }}
                />
              ))}
            </ScrollView>
            <View style={styles.row}>
              <Button
                title="Other corner"
                style={{ flex: 1 }}
                disabled={!!scan.alignFirst}
                onPress={() => setAnchorCorner((c) => (c + 1) % (anchorRoom?.points.length || 1))}
              />
              <Button
                title={scan.alignFirst ? 'Match 2nd corner' : 'Match 1st corner'}
                primary
                style={{ flex: 1.4 }}
                disabled={!status?.aimingAtFloor || !anchorTarget}
                onPress={matchCorner}
              />
            </View>
          </>
        )}

        {step === 'corners' && (
          <>
            <View style={styles.row}>
              <Button title={snap ? 'Right angles: on' : 'Right angles: off'} style={{ flex: 1 }} onPress={() => setSnap((s) => !s)} />
              <Button title="Finish room" style={{ flex: 1 }} disabled={current.length < 3} onPress={finishRoom} />
            </View>
            <Button
              title={status?.closesShape ? 'Close room' : current.length ? `Add corner ${current.length + 1}` : 'Add first corner'}
              primary
              disabled={!status?.aimingAtFloor}
              onPress={addCorner}
            />
          </>
        )}

        {step === 'name' && snapshot && (
          <>
            <Text style={styles.sheetTitle}>Which room is this?</Text>
            <RoomAssign rooms={snapshot.rooms} onAssign={(c) => nameRoom(c.name, c.hueRoomId)} onRoomCreated={refresh} />
            <View style={{ flexDirection: 'row' }}>
              <Chip label={outdoor ? '✓ Outdoor' : 'Outdoor'} active={outdoor} onPress={() => setOutdoor((o) => !o)} />
            </View>
          </>
        )}

        {step === 'lights' && snapshot && lastRoom && (
          <LightPicker
            snapshot={snapshot}
            room={lastRoom}
            placed={[...(base?.lights ?? []), ...lights]}
            selected={selected}
            showOthers={showOthers}
            onToggleOthers={() => setShowOthers((s) => !s)}
            onPick={pick}
            onPlace={place}
            canPlace={!!status?.aimingAtFloor}
            onDone={() => {
              setSelected(null);
              commit({ ...scan, step: 'between' });
            }}
          />
        )}

        {step === 'between' && (
          <>
            {base && rooms.length === 0 && <Body>Lined up with your map. Your saved rooms show in gray.</Body>}
            <View style={styles.row}>
              <Button title="Scan a room" primary style={{ flex: 1 }} onPress={() => commit({ ...scan, step: 'corners' })} />
              <Button title="Place lights" style={{ flex: 1 }} disabled={!rooms.length} onPress={() => commit({ ...scan, step: 'lights' })} />
            </View>
            <Button title="Finish" onPress={() => router.replace('/')} />
          </>
        )}
      </View>
    </View>
  );
}

function LightPicker(props: {
  snapshot: Snapshot;
  room: MapRoom;
  placed: MapLight[];
  selected: string | null;
  showOthers: boolean;
  onToggleOthers: () => void;
  onPick: (l: Light) => void;
  onPlace: () => void;
  canPlace: boolean;
  onDone: () => void;
}) {
  const { snapshot, room, placed, selected } = props;
  const placedIds = new Set(placed.map((p) => p.lightId));
  const inRoom = room.hueRoomId ? snapshot.lights.filter((l) => l.roomId === room.hueRoomId) : [];
  // On a new setup, lights start in no room: always offer them.
  const unassigned = snapshot.lights.filter((l) => !l.roomId);
  // Lights of other Hue rooms that sit physically here (e.g. a bedside lamp with its own room).
  const others = snapshot.lights.filter((l) => l.roomId && l.roomId !== room.hueRoomId);
  const list = [...inRoom, ...unassigned, ...(props.showOthers ? others : [])];
  return (
    <>
      <Text style={styles.sheetTitle}>Place the lights in {room.name}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {list.map((l) => (
          <Chip
            key={l.id}
            label={`${placedIds.has(l.id) ? '✓ ' : ''}${l.name}${!l.roomId ? ' (no room)' : ''}`}
            active={selected === l.id}
            dot={l.on ? l.color : undefined}
            onPress={() => props.onPick(l)}
          />
        ))}
        {others.length > 0 && <Chip label={props.showOthers ? 'Hide other rooms' : 'Lights from other rooms'} onPress={props.onToggleOthers} />}
      </ScrollView>
      <View style={styles.row}>
        <Button title="Place" primary style={{ flex: 2 }} disabled={!selected || !props.canPlace} onPress={props.onPlace} />
        <Button title="Done" style={{ flex: 1 }} onPress={props.onDone} />
      </View>
    </>
  );
}

function instructionFor(status: ArStatus | null, step: Step, corners: number, aligningSecond: boolean, lightName?: string) {
  if (!status) return 'Starting the camera…';
  if (status.tracking !== 'tracking') {
    if (status.reason === 'insufficient_light') return 'Too dark. Turn on more lights.';
    if (status.reason === 'excessive_motion') return 'Moving too fast. Slow down.';
    if (status.reason === 'insufficient_features') return 'Aim at something with more texture.';
    return 'Point back at a place you already scanned.';
  }
  if (!status.floorFound) return 'Move your phone slowly, pointing at the floor.';
  if (step === 'align') {
    if (!status.aimingAtFloor) return 'Aim lower, at the floor.';
    return aligningSecond
      ? 'Now aim at the next highlighted corner, then tap Match.'
      : 'Aim at the corner highlighted on the mini-map, where the walls meet the floor, then tap Match.';
  }
  if (step === 'corners') {
    if (!status.aimingAtFloor) return 'Aim lower, at the floor.';
    if (status.closesShape) return 'Back at the first corner. Tap to close the room.';
    return corners === 0 ? 'Aim at a corner where the wall meets the floor, then tap Add first corner.' : 'Aim at the next corner.';
  }
  if (step === 'name') return 'Room traced. Which room is it?';
  if (step === 'lights') return lightName ? `${lightName} is blinking. Aim at the floor right below it, then tap Place.` : 'Pick a light. It will blink so you can find it.';
  return 'Saved. Scan another room, or finish.';
}

type MiniOutline = { points: FloorPoint[]; color: string; open?: boolean };
type MiniDot = { p: FloorPoint; color: string; r: number };

/** Live 2D preview of the plan, with the user's position and direction when known. */
function MiniMap({ outlines, dots, camera, top }: { outlines: MiniOutline[]; dots: MiniDot[]; camera?: { p: FloorPoint; heading?: number }; top: number }) {
  const S = 130;
  const pts = [...outlines.flatMap((o) => o.points), ...dots.map((d) => d.p), ...(camera ? [camera.p] : [])];
  if (!pts.length) return null;
  const minX = Math.min(...pts.map((p) => p.x)) - 0.5;
  const maxX = Math.max(...pts.map((p) => p.x)) + 0.5;
  const minZ = Math.min(...pts.map((p) => p.z)) - 0.5;
  const maxZ = Math.max(...pts.map((p) => p.z)) + 0.5;
  const scale = (S - 12) / Math.max(maxX - minX, maxZ - minZ, 3);
  const X = (x: number) => 6 + (x - minX) * scale;
  const Y = (z: number) => 6 + (z - minZ) * scale;
  const str = (ps: FloorPoint[]) => ps.map((p) => `${X(p.x)},${Y(p.z)}`).join(' ');
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 12, top, width: S, height: S, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Svg width={S} height={S}>
        {outlines.map((o, i) =>
          o.open ? (
            <Polyline key={i} points={str(o.points)} fill="none" stroke={o.color} strokeWidth={2} />
          ) : (
            <Polygon key={i} points={str(o.points)} fill="rgba(255,255,255,0.08)" stroke={o.color} strokeWidth={1.5} />
          ),
        )}
        {dots.map((d, i) => (
          <Circle key={i} cx={X(d.p.x)} cy={Y(d.p.z)} r={d.r} fill={d.color} />
        ))}
        {camera && (
          <>
            {camera.heading !== undefined && (
              <Line
                x1={X(camera.p.x)}
                y1={Y(camera.p.z)}
                x2={X(camera.p.x) + Math.sin(camera.heading) * 14}
                y2={Y(camera.p.z) - Math.cos(camera.heading) * 14}
                stroke="#fff"
                strokeWidth={2}
              />
            )}
            <Circle cx={X(camera.p.x)} cy={Y(camera.p.z)} r={4} fill="#fff" />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 24, justifyContent: 'center', gap: 14 },
  title: { color: theme.text, fontSize: 22, fontWeight: '600' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  instruction: { flex: 1, color: '#fff', fontSize: 16, lineHeight: 22, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, padding: 12, overflow: 'hidden' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 10, backgroundColor: 'rgba(0,0,0,0.6)' },
  row: { flexDirection: 'row', gap: 10 },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
