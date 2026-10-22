import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';

import { ArScan, ArScanView, type ArOverlay, type ArScanHandle, type ArStatus } from '../../modules/ar-scan';
import { identifyLight, type Light, type Snapshot } from '../lib/hue/client';
import { useSnapshot } from '../lib/hue/useSnapshot';
import { saveMap, type FloorPoint, type MapLight, type MapRoom } from '../lib/map/map';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { refreshAllWidgets } from '../widgets/task-handler';

type Step = 'corners' | 'name' | 'lights' | 'between';

export default function Scan() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'unsupported' | 'no-permission'>('checking');

  useEffect(() => {
    (async () => {
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

  if (ready === 'ok') return <Scanner />;
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
      <Text style={{ color: theme.text, fontSize: 16 }}>
        {ready === 'checking'
          ? 'Checking AR support…'
          : ready === 'unsupported'
            ? "This phone doesn't support AR. Manual drawing is coming next."
            : 'Camera access is needed to scan your home.'}
      </Text>
      {ready !== 'checking' && <Button title="Back" onPress={() => router.back()} />}
    </View>
  );
}

function Scanner() {
  const insets = useSafeAreaInsets();
  const ar = useRef<ArScanHandle>(null);
  const { snapshot } = useSnapshot(5000);
  const [status, setStatus] = useState<ArStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('corners');
  const [rooms, setRooms] = useState<MapRoom[]>([]);
  const [current, setCurrent] = useState<FloorPoint[]>([]);
  const [lights, setLights] = useState<MapLight[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showOthers, setShowOthers] = useState(false);

  const lightById = useMemo(() => new Map((snapshot?.lights ?? []).map((l) => [l.id, l])), [snapshot]);

  const overlay: ArOverlay = useMemo(
    () => ({
      polylines: [
        ...rooms.map((r) => ({ points: r.points, closed: true, color: '#c8c8d0' })),
        { points: current, closed: false, color: theme.accent },
      ],
      markers: lights.map((l) => ({ x: l.x, z: l.z, color: lightById.get(l.lightId)?.color ?? '#ffcc66', label: lightById.get(l.lightId)?.name })),
      activeIndex: step === 'corners' ? rooms.length : -1,
    }),
    [rooms, current, lights, step, lightById],
  );

  const lastRoom = rooms[rooms.length - 1];

  async function addCorner() {
    const p = await ar.current?.capture();
    if (!p) return;
    if (p.closesShape) return finishRoom();
    setCurrent((c) => [...c, { x: p.x, z: p.z }]);
  }

  function finishRoom() {
    if (current.length < 3) return;
    setRooms((r) => [...r, { id: `room-${Date.now()}`, name: '', hueRoomId: null, points: current }]);
    setCurrent([]);
    setStep('name');
  }

  function nameRoom(name: string, hueRoomId: string | null, outdoor = false) {
    setRooms((r) => r.map((room, i) => (i === r.length - 1 ? { ...room, name, hueRoomId, outdoor } : room)));
    setShowOthers(false);
    setStep('lights');
  }

  async function pick(light: Light) {
    setSelected(light.id);
    identifyLight(light.id).catch(() => null);
  }

  async function place() {
    if (!selected) return;
    const p = await ar.current?.capture();
    if (!p) return;
    // Lights are placed where the user aims, not snapped to walls.
    setLights((ls) => [...ls.filter((l) => l.lightId !== selected), { lightId: selected, x: p.rawX, z: p.rawZ }]);
    setSelected(null);
  }

  async function finish() {
    await saveMap({ version: 1, rooms, lights, updatedAt: Date.now() });
    refreshAllWidgets();
    router.replace('/map');
  }

  const instruction = instructionFor(status, step, current.length, selected ? lightById.get(selected)?.name : undefined);

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
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.close}>
          <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
        </Pressable>
        <Text style={styles.instruction}>{error ?? instruction}</Text>
      </View>

      <MiniMap rooms={rooms} current={current} lights={lights} status={status} top={insets.top + 70} />

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {step === 'corners' && (
          <>
            <View style={styles.row}>
              <Button title="Undo" style={{ flex: 1 }} disabled={!current.length} onPress={() => setCurrent((c) => c.slice(0, -1))} />
              <Button title={snap ? 'Right angles: on' : 'Right angles: off'} style={{ flex: 1.4 }} onPress={() => setSnap((s) => !s)} />
            </View>
            <View style={styles.row}>
              <Button
                title={status?.closesShape ? 'Close room' : 'Add corner'}
                primary
                style={{ flex: 2 }}
                disabled={!status?.aimingAtFloor}
                onPress={addCorner}
              />
              <Button title="Finish room" style={{ flex: 1 }} disabled={current.length < 3} onPress={finishRoom} />
            </View>
            {rooms.length > 0 && !current.length && <Button title="Finish scan" onPress={finish} />}
          </>
        )}

        {step === 'name' && snapshot && (
          <>
            <Text style={styles.sheetTitle}>Which room is this?</Text>
            <View style={styles.chips}>
              {snapshot.rooms.map((r) => (
                <Chip key={r.id} label={r.name} onPress={() => nameRoom(r.name, r.id, r.archetype === 'terrace' || r.name.toLowerCase().includes('terrasse'))} />
              ))}
              <Chip label="Other space" onPress={() => nameRoom('Other', null)} />
            </View>
          </>
        )}

        {step === 'lights' && snapshot && lastRoom && (
          <LightPicker
            snapshot={snapshot}
            room={lastRoom}
            placed={lights}
            selected={selected}
            showOthers={showOthers}
            onToggleOthers={() => setShowOthers((s) => !s)}
            onPick={pick}
            onPlace={place}
            canPlace={!!status?.aimingAtFloor}
            onDone={() => {
              setSelected(null);
              setStep('between');
            }}
          />
        )}

        {step === 'between' && (
          <View style={styles.row}>
            <Button title="Scan next room" primary style={{ flex: 1 }} onPress={() => setStep('corners')} />
            <Button title="Finish scan" style={{ flex: 1 }} onPress={finish} />
          </View>
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
  const inRoom = snapshot.lights.filter((l) => l.roomId === room.hueRoomId);
  // Lights of other Hue rooms that sit physically here (e.g. Table de nuit inside Chambre).
  const others = snapshot.lights.filter((l) => l.roomId !== room.hueRoomId && !placedIds.has(l.id));
  const list = props.showOthers ? [...inRoom, ...others] : inRoom;
  return (
    <>
      <Text style={styles.sheetTitle}>Place the lights in {room.name}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {list.map((l) => (
          <Chip
            key={l.id}
            label={`${placedIds.has(l.id) ? '✓ ' : ''}${l.name}`}
            active={selected === l.id}
            dot={l.on ? l.color : undefined}
            onPress={() => props.onPick(l)}
          />
        ))}
        <Chip label={props.showOthers ? 'Only this room' : 'Lights from other rooms'} onPress={props.onToggleOthers} />
      </ScrollView>
      <View style={styles.row}>
        <Button title="Place" primary style={{ flex: 2 }} disabled={!selected || !props.canPlace} onPress={props.onPlace} />
        <Button title="Done" style={{ flex: 1 }} onPress={props.onDone} />
      </View>
    </>
  );
}

function Chip({ label, onPress, active, dot }: { label: string; onPress: () => void; active?: boolean; dot?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: '#fff' }]}>
      {dot && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />}
      <Text style={{ color: active ? '#000' : '#fff', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

function instructionFor(status: ArStatus | null, step: Step, corners: number, lightName?: string) {
  if (!status) return 'Starting the camera…';
  if (status.tracking !== 'tracking') {
    if (status.reason === 'insufficient_light') return 'Too dark. Turn on more lights.';
    if (status.reason === 'excessive_motion') return 'Moving too fast. Slow down.';
    if (status.reason === 'insufficient_features') return 'Aim at something with more texture.';
    return 'Point back at a place you already scanned.';
  }
  if (!status.floorFound) return 'Move your phone slowly, pointing at the floor.';
  if (step === 'corners') {
    if (!status.aimingAtFloor) return 'Aim lower, at the floor.';
    if (status.closesShape) return 'Back at the first corner. Tap to close the room.';
    return corners === 0 ? 'Aim at a corner where the wall meets the floor, then tap Add corner.' : 'Aim at the next corner.';
  }
  if (step === 'name') return 'Room traced. Which room is it?';
  if (step === 'lights') return lightName ? `${lightName} is blinking. Aim at the floor right below it, then tap Place.` : 'Pick a light. It will blink so you can find it.';
  return 'Room done.';
}

/** Live 2D preview of the plan being built, with the user's position and direction. */
function MiniMap({ rooms, current, lights, status, top }: { rooms: MapRoom[]; current: FloorPoint[]; lights: MapLight[]; status: ArStatus | null; top: number }) {
  const S = 130;
  const pts = [...rooms.flatMap((r) => r.points), ...current, ...lights, ...(status?.camera ? [status.camera] : [])];
  if (!pts.length) return null;
  const minX = Math.min(...pts.map((p) => p.x)) - 0.5;
  const maxX = Math.max(...pts.map((p) => p.x)) + 0.5;
  const minZ = Math.min(...pts.map((p) => p.z)) - 0.5;
  const maxZ = Math.max(...pts.map((p) => p.z)) + 0.5;
  const scale = (S - 12) / Math.max(maxX - minX, maxZ - minZ, 3);
  const X = (x: number) => 6 + (x - minX) * scale;
  const Y = (z: number) => 6 + (z - minZ) * scale;
  const str = (ps: FloorPoint[]) => ps.map((p) => `${X(p.x)},${Y(p.z)}`).join(' ');
  const cam = status?.camera;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 12, top, width: S, height: S, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Svg width={S} height={S}>
        {rooms.map((r) => (
          <Polygon key={r.id} points={str(r.points)} fill="rgba(255,255,255,0.08)" stroke="#c8c8d0" strokeWidth={1.5} />
        ))}
        {current.length > 0 && <Polyline points={str(current)} fill="none" stroke={theme.accent} strokeWidth={2} />}
        {lights.map((l) => (
          <Circle key={l.lightId} cx={X(l.x)} cy={Y(l.z)} r={3.5} fill="#ffcc66" />
        ))}
        {cam && (
          <>
            {status?.heading !== undefined && (
              <Line
                x1={X(cam.x)}
                y1={Y(cam.z)}
                x2={X(cam.x) + Math.sin(status.heading) * 14}
                y2={Y(cam.z) - Math.cos(status.heading) * 14}
                stroke="#fff"
                strokeWidth={2}
              />
            )}
            <Circle cx={X(cam.x)} cy={Y(cam.z)} r={4} fill="#fff" />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  instruction: { flex: 1, color: '#fff', fontSize: 16, lineHeight: 22, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, padding: 12, overflow: 'hidden' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 10, backgroundColor: 'rgba(0,0,0,0.6)' },
  row: { flexDirection: 'row', gap: 10 },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)' },
});
