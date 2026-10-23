import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArScan, ArScanView, type ArOverlay, type ArScanHandle, type ArStatus } from '../../modules/ar-scan';
import { identifyLight, type Light } from '../lib/hue/client';
import { useHome } from '../lib/hue/useHome';
import { lightShape } from '../lib/lights';
import { apply, distance, fromTwoPoints, invert, normalizingTransform, pointInPolygon, type Transform } from '../lib/map/geometry';
import { polygonArea } from '../lib/map/glow';
import { loadMap, saveMap, type FloorPoint, type HomeMap, type MapLight, type MapRoom } from '../lib/map/map';
import { PillButton } from '../ui/controls';
import { offerMoveToRoom } from '../ui/offerMoveToRoom';
import { AR_INK, CamButton, ChoiceRow, Choice, Fades, FindingFloor, MiniMap, ScanTitle, ScanTop, Sheet, Shutter, SideButton, TrackingLost, type MiniDot, type MiniOutline } from '../ui/scan/parts';
import { LightsSheet, NameSheet, type LightRowState } from '../ui/scan/sheets';
import { Display, Label, Txt } from '../ui/text';
import { color, hairline } from '../ui/theme';
import { refreshAllWidgets } from '../widgets/task-handler';

type Ready = 'checking' | 'intro' | 'unsupported' | 'no-permission' | 'scanning';

/**
 * Entry: explains the scan, checks AR support and camera access. With a saved map, the scan
 * edits it: line up with 2 known corners, then add rooms, redraw rooms or move lights.
 */
export default function Scan() {
  const insets = useSafeAreaInsets();
  const { snapshot } = useHome(10_000);
  const [ready, setReady] = useState<Ready>('checking');
  const [existing, setExisting] = useState<HomeMap | null>(null);
  const [base, setBase] = useState<HomeMap | null>(null);

  useEffect(() => {
    (async () => {
      setExisting(await loadMap());
      setReady((await ArScan.availability()) === 'unsupported' ? 'unsupported' : 'intro');
    })();
  }, []);

  async function start(from: HomeMap | null) {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
      title: 'Camera access',
      message: 'The camera is used only during the scan, to find your floor and corners. Nothing is recorded.',
      buttonPositive: 'Allow',
    });
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return setReady('no-permission');
    setBase(from);
    setReady('scanning');
  }

  if (ready === 'scanning') return <Scanner base={base} />;
  if (ready === 'checking') return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  const hasMap = !!existing?.rooms.length;
  const firstRoom = snapshot?.rooms[0]?.name;
  const steps = hasMap
    ? [
        ['Stand in a room you already scanned', 'You match 2 of its corners so everything lines up'],
        ['Add rooms, redraw one, or move lights', 'Each change is saved right away'],
        ['Walk slowly, phone toward the floor', 'Corners are where the walls meet the floor'],
      ]
    : [
        ['Turn your lights on', "Each one blinks when it's time to place it"],
        [firstRoom ? `Start in ${firstRoom}` : 'Start in your main room', 'The scan follows you from room to room'],
        ['Walk slowly, phone toward the floor', 'Corners are where the walls meet the floor'],
      ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }} contentContainerStyle={{ paddingTop: insets.top + 22, paddingHorizontal: 24, paddingBottom: insets.bottom + 28, flexGrow: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <CamButton icon="close" label="Back" onPress={() => router.back()} />
        <Label tone="label">{hasMap ? 'Edit in AR' : 'Map scan'}</Label>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ marginTop: 40, gap: 12 }}>
        <Display size={36} style={{ lineHeight: 40 }}>
          {hasMap ? 'Walk through\n' : 'Map your home\n'}
          <Display size={36} style={{ color: color.champagne, lineHeight: 40 }}>
            {hasMap ? 'your map' : 'in 3 minutes'}
          </Display>
        </Display>
        <Txt tone="secondary">
          {hasMap
            ? `${existing!.rooms.length} ${existing!.rooms.length === 1 ? 'room' : 'rooms'} and ${existing!.lights.length} ${existing!.lights.length === 1 ? 'light' : 'lights'} on your map. Fix them where they really are.`
            : 'One slow walk through every room. You can fix anything afterwards.'}
        </Txt>
      </View>

      <View style={{ marginTop: 30 }}>
        {steps.map(([title, sub], i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: hairline(0.08) }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(233,207,159,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Display size={14} weight={400} style={{ color: color.champagne, lineHeight: 18 }}>
                {i + 1}
              </Display>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt>{title}</Txt>
              <Txt size={12} tone="muted">
                {sub}
              </Txt>
            </View>
          </View>
        ))}
      </View>

      <View style={{ flex: 1, minHeight: 24 }} />
      {ready === 'unsupported' ? (
        <View style={{ gap: 12 }}>
          <Txt tone="secondary">{"This phone can't scan in AR. You can draw your map on screen instead."}</Txt>
          <PillButton title="Draw it myself" kind="primary" icon="edit" onPress={() => router.replace('/editor')} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {ready === 'no-permission' && (
            <Txt size={13} style={{ color: color.warning }}>
              The scan needs the camera. Allow it, or draw your map on screen.
            </Txt>
          )}
          <Txt size={12} tone="muted" style={{ textAlign: 'center', marginBottom: 6 }}>
            We use the camera only during the scan. Nothing is recorded.
          </Txt>
          {hasMap ? (
            <>
              <PillButton title="Continue my map" kind="primary" icon="scan" onPress={() => start(existing)} />
              <PillButton
                title="Start a new map"
                onPress={() =>
                  Alert.alert('Start a new map?', 'Your current map is replaced as soon as you finish the first room.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Start new', style: 'destructive', onPress: () => start(null) },
                  ])
                }
              />
              <PillButton title="Edit on screen instead" kind="text" onPress={() => router.replace('/editor')} />
            </>
          ) : (
            <>
              <PillButton title="Start scan" kind="primary" icon="scan" onPress={() => start(null)} />
              <PillButton title="Draw it myself instead" kind="text" onPress={() => router.replace('/editor')} />
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

type Step = 'align' | 'hub' | 'pickRoom' | 'corners' | 'name' | 'lights';

/**
 * Everything the user builds during a scan. Each change is recorded so it can be undone.
 * Rooms and lights of this session are kept in AR coordinates; `toMap` converts them.
 */
type ScanState = {
  step: Step;
  /** AR → map coordinates. Known after aligning (continue) or after the first room (new map). */
  toMap: Transform | null;
  /** First matched corner while aligning with a saved map. */
  alignFirst: { ar: FloorPoint; map: FloorPoint } | null;
  /** Rooms traced this session. A redrawn saved room keeps its ID and replaces it. */
  rooms: MapRoom[];
  current: FloorPoint[];
  /** Lights placed this session (they replace their saved position). */
  lights: MapLight[];
  /** ID of the room being redrawn; null when tracing a new room. */
  retracing: string | null;
  /** Room whose lights the lights step lists; null = every light. */
  lightsRoomId: string | null;
  skipped: string[];
};

/** If the last corner lands this close to the first one, Finish room treats it as a missed close. */
const MERGE_RADIUS_M = 0.6;

const newRoomId = () => `room-${Date.now()}`;
// The native overlay reads #AARRGGBB; the mini-map (SVG) wants rgba().
const BASE_INK_AR = '#73F3E3C3';
const BASE_INK = 'rgba(243,227,195,0.45)';
const REDRAW_INK = '#E9CF9F';

function Scanner({ base }: { base: HomeMap | null }) {
  const insets = useSafeAreaInsets();
  const ar = useRef<ArScanHandle>(null);
  const { snapshot, refresh } = useHome(5000);
  const [status, setStatus] = useState<ArStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState>({
    step: base ? 'align' : 'corners',
    toMap: null,
    alignFirst: null,
    rooms: [],
    current: [],
    lights: [],
    retracing: null,
    lightsRoomId: null,
    skipped: [],
  });
  const [history, setHistory] = useState<ScanState[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showOthers, setShowOthers] = useState(false);
  const [anchorRoomId, setAnchorRoomId] = useState<string | null>(base?.rooms[0]?.id ?? null);
  const [anchorCorner, setAnchorCorner] = useState(0);
  const { step, rooms, current, lights, toMap } = scan;
  const floor = useFloorFlash(!!status?.floorFound);
  const lost = useLost(status);

  function commit(next: ScanState) {
    setHistory((h) => [...h, scan]);
    setScan(next);
  }

  function undo() {
    if (!history.length) return;
    setScan(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setActive(null);
  }

  // Save after every change once we know where things go, so a scan can stop at any time.
  useEffect(() => {
    if (!toMap) return;
    const newRooms = rooms.map((r) => ({ ...r, points: r.points.map((p) => apply(toMap, p)) }));
    const newLights = lights.map((l) => ({ ...l, ...apply(toMap, l) }));
    const map: HomeMap = {
      version: 2,
      rooms: [...(base?.rooms ?? []).filter((r) => !newRooms.some((n) => n.id === r.id)), ...newRooms],
      lights: [...(base?.lights ?? []).filter((l) => !newLights.some((n) => n.lightId === l.lightId)), ...newLights],
      updatedAt: Date.now(),
    };
    saveMap(map).then(() => refreshAllWidgets());
  }, [rooms, lights, toMap, base]);

  const lightById = useMemo(() => new Map((snapshot?.lights ?? []).map((l) => [l.id, l])), [snapshot]);

  // The saved map, brought into this AR session once aligned.
  const fromMap = toMap ? invert(toMap) : null;
  const baseRoomsAr: MapRoom[] =
    base && fromMap ? base.rooms.filter((r) => !rooms.some((n) => n.id === r.id)).map((r) => ({ ...r, points: r.points.map((p) => apply(fromMap, p)) })) : [];
  const baseLightsAr: MapLight[] =
    base && fromMap ? base.lights.filter((l) => !lights.some((n) => n.lightId === l.lightId)).map((l) => ({ ...l, ...apply(fromMap, l) })) : [];
  const allRooms = [...baseRoomsAr, ...rooms];
  const allLights = [...baseLightsAr, ...lights];
  const placedIds = new Set([...(base?.lights ?? []).map((l) => l.lightId), ...lights.map((l) => l.lightId)]);
  const redrawn = scan.retracing ? allRooms.find((r) => r.id === scan.retracing) : undefined;
  const lightsRoom = scan.lightsRoomId ? allRooms.find((r) => r.id === scan.lightsRoomId) : undefined;

  /** The room a floor point falls in (the smallest outline holding it). */
  function roomAt(p: FloorPoint) {
    const hits = allRooms.filter((r) => r.points.length >= 3 && pointInPolygon(p, r.points));
    const area = (r: MapRoom) => polygonArea(r.points.map((q) => ({ u: q.x, v: q.z })));
    return hits.length ? hits.reduce((a, b) => (area(a) <= area(b) ? a : b)) : undefined;
  }

  // ---- Lights list -------------------------------------------------------------

  const lightRows = useMemo(() => {
    const all = snapshot?.lights ?? [];
    let list: Light[];
    if (lightsRoom) {
      const inRoom = lightsRoom.hueRoomId ? all.filter((l) => l.roomId === lightsRoom.hueRoomId) : [];
      // On a new setup, lights start in no room: always offer them.
      const loose = all.filter((l) => !l.roomId);
      const others = showOthers ? all.filter((l) => l.roomId && l.roomId !== lightsRoom.hueRoomId) : [];
      list = [...inRoom, ...loose, ...others];
    } else {
      list = [...all].sort((a, b) => Number(placedIds.has(a.id)) - Number(placedIds.has(b.id)));
    }
    return list.map((light) => {
      const placed = placedIds.has(light.id);
      const state: LightRowState =
        light.id === active ? (placed ? 'activePlaced' : 'active') : placed ? 'placed' : scan.skipped.includes(light.id) ? 'skipped' : 'idle';
      return { light, state };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, lightsRoom?.id, lightsRoom?.hueRoomId, showOthers, active, scan.skipped, lights, base]);

  const otherRoomsCount = lightsRoom ? (snapshot?.lights ?? []).filter((l) => l.roomId && l.roomId !== lightsRoom.hueRoomId).length : 0;

  function pick(light: Light) {
    setActive(light.id);
    identifyLight(light.id).catch(() => null);
  }

  /** After placing or skipping, the next light waiting in the list starts blinking. */
  function advance(after: string, placed: Set<string>, skipped: string[]) {
    const idx = lightRows.findIndex((r) => r.light.id === after);
    const next = [...lightRows.slice(idx + 1), ...lightRows.slice(0, Math.max(idx, 0))].find(
      (r) => r.light.id !== after && !placed.has(r.light.id) && !skipped.includes(r.light.id),
    );
    if (next) pick(next.light);
    else setActive(null);
  }

  async function place() {
    if (!active) return;
    const p = await ar.current?.capture();
    if (!p) return;
    // Lights are placed where the user aims, not snapped to walls.
    const at = { x: p.rawX, z: p.rawZ };
    commit({ ...scan, lights: [...lights.filter((l) => l.lightId !== active), { lightId: active, ...at }], skipped: scan.skipped.filter((id) => id !== active) });
    const room = lightsRoom ?? roomAt(at);
    if (room) offerMoveToRoom(snapshot, active, room, refresh);
    advance(active, new Set([...placedIds, active]), scan.skipped);
  }

  function skip() {
    if (!active) return;
    const skipped = [...scan.skipped.filter((id) => id !== active), active];
    setScan({ ...scan, skipped });
    advance(active, placedIds, skipped);
  }

  function openLights(roomId: string | null) {
    setShowOthers(false);
    commit({ ...scan, step: 'lights', lightsRoomId: roomId });
    const first = (snapshot?.lights ?? []).find((l) => {
      const room = roomId ? allRooms.find((r) => r.id === roomId) : null;
      return !placedIds.has(l.id) && (!room || l.roomId === room.hueRoomId || !l.roomId);
    });
    if (first) pick(first);
    else setActive(null);
  }

  // ---- Aligning with a saved map ---------------------------------------------

  const anchorRoom = base?.rooms.find((r) => r.id === anchorRoomId);
  const anchorTarget = anchorRoom ? anchorRoom.points[(anchorCorner + (scan.alignFirst ? 1 : 0)) % anchorRoom.points.length] : undefined;

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
    commit({ ...scan, alignFirst: null, toMap: fromTwoPoints(first.ar, here, first.map, anchorTarget), step: 'hub' });
  }

  // ---- Tracing rooms ------------------------------------------------------------

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
    // A new map is laid out from its first room: first wall along +x, first corner at 0.
    const nextToMap = scan.toMap ?? normalizingTransform(points);
    if (redrawn) {
      // Same room, new walls: keeps its name, Hue room and lights.
      const room = { ...redrawn, points };
      commit({ ...scan, step: 'hub', current: [], retracing: null, toMap: nextToMap, rooms: [...rooms.filter((r) => r.id !== room.id), room] });
      return;
    }
    commit({
      ...scan,
      step: 'name',
      current: [],
      toMap: nextToMap,
      rooms: [...rooms, { id: newRoomId(), name: '', hueRoomId: null, points }],
    });
  }

  function nameRoom(name: string, hueRoomId: string | null, outdoor: boolean) {
    const last = rooms[rooms.length - 1];
    const named = rooms.map((r) => (r === last ? { ...r, name, hueRoomId, outdoor } : r));
    setShowOthers(false);
    const next = { ...scan, rooms: named, step: 'lights' as Step, lightsRoomId: last.id };
    commit(next);
    const first = (snapshot?.lights ?? []).find((l) => !placedIds.has(l.id) && (hueRoomId ? l.roomId === hueRoomId : !l.roomId));
    if (first) pick(first);
    else setActive(null);
  }

  function finish() {
    router.replace('/editor');
  }

  function exit() {
    if (!current.length) return router.back();
    Alert.alert('Leave the scan?', 'Everything else is saved. The room you are tracing now will be lost.', [
      { text: 'Keep scanning', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);
  }

  // ---- What the camera view shows ------------------------------------------------

  const overlay: ArOverlay = useMemo(
    () => ({
      polylines: [
        ...baseRoomsAr.map((r) => ({ points: r.points, closed: true, color: r.id === scan.retracing ? REDRAW_INK : BASE_INK_AR })),
        ...rooms.map((r) => ({ points: r.points, closed: true, color: r.id === scan.retracing ? REDRAW_INK : AR_INK })),
        { points: current, closed: false, color: AR_INK },
      ],
      markers: [
        // Numbered corners of the room being traced; the first one is the target to close it.
        ...current.map((p, i) => ({ ...p, kind: 'corner' as const, color: AR_INK, label: i === 0 ? 'Start' : String(i + 1), edge: i === 0 && current.length >= 2 })),
        ...allLights.map((l) => {
          const light = lightById.get(l.lightId);
          return { x: l.x, z: l.z, kind: 'light' as const, color: light?.on ? light.color : '#8F887D', label: light?.name, edge: l.lightId === active };
        }),
      ],
      activeIndex: step === 'corners' ? baseRoomsAr.length + rooms.length : -1,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rooms, current, lights, step, lightById, toMap, active, scan.retracing],
  );

  const mini: { outlines: MiniOutline[]; dots: MiniDot[]; camera?: { p: FloorPoint; heading?: number } } =
    step === 'align' && base
      ? {
          outlines: base.rooms.map((r) => ({ points: r.points, ink: r.id === anchorRoomId ? AR_INK : BASE_INK })),
          dots: [
            ...(scan.alignFirst ? [{ p: scan.alignFirst.map, ink: color.connected, kind: 'corner' as const }] : []),
            ...(anchorTarget ? [{ p: anchorTarget, ink: color.champagne, kind: 'target' as const }] : []),
          ],
        }
      : {
          outlines: [
            ...allRooms.map((r) => ({ points: r.points, ink: r.id === scan.retracing ? REDRAW_INK : rooms.includes(r) ? AR_INK : BASE_INK, dashed: r.outdoor })),
            ...(current.length ? [{ points: current, ink: AR_INK, open: true }] : []),
          ],
          dots: [
            ...current.map((p) => ({ p, ink: AR_INK, kind: 'corner' as const })),
            ...allLights.map((l) => ({ p: l as FloorPoint, ink: lightById.get(l.lightId)?.color ?? AR_INK, kind: 'light' as const })),
          ],
          camera: status?.camera ? { p: status.camera, heading: status.heading } : undefined,
        };

  const lastRoom = rooms[rooms.length - 1];
  const roomNumber = rooms.filter((r) => !base?.rooms.some((b) => b.id === r.id)).length;
  const keptSummary = (() => {
    const n = allRooms.length;
    const named = allRooms.map((r) => r.name).filter(Boolean);
    const roomsText = n === 0 ? 'Nothing traced yet' : n === 1 ? (named[0] ?? '1 room') : `${n} rooms`;
    return `${roomsText} and ${allLights.length} ${allLights.length === 1 ? 'light are' : 'lights are'} kept`;
  })();

  const needsFloor = step === 'align' || step === 'corners' || step === 'lights';
  const tracking = status?.tracking === 'tracking';

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <ArScanView ref={ar} style={StyleSheet.absoluteFill} overlay={overlay} snapEnabled={snap && step === 'corners'} onStatus={setStatus} onError={(e) => setError(e.message)} />
      <Fades bottom={step === 'corners' ? 300 : 0} />

      {step === 'align' && (
        <ScanTitle first="Line up with" accent="your map" sub={scan.alignFirst ? 'NOW THE NEXT CORNER' : 'AIM AT THE CORNER ON THE MAP'} />
      )}
      {step === 'corners' && tracking && status?.floorFound && <CornerTitle status={status} corners={current.length} />}
      {step === 'lights' && active && <LightHint light={lightById.get(active)} />}
      {step === 'hub' && <ScanTitle first={rooms.length || lights.length ? 'Saved.' : 'Lined up.'} accent="What next?" />}
      {step === 'pickRoom' && <ScanTitle first="Which room" accent="to redraw?" sub="ITS NAME AND LIGHTS STAY" />}

      <MiniMap {...mini} />

      <ScanTop
        label={
          error ??
          (step === 'align'
            ? `Line up · corner ${scan.alignFirst ? 2 : 1} of 2`
            : step === 'corners'
              ? `${redrawn ? redrawn.name || 'Room' : `Room ${roomNumber + 1}`} · corner ${current.length + 1}`
              : step === 'name'
                ? `Room ${roomNumber} · closed`
                : step === 'lights'
                  ? lightsRoom
                    ? `${lightsRoom.name} · lights`
                    : 'Place or move lights'
                  : step === 'pickRoom'
                    ? 'Redraw a room'
                    : 'Your map')
        }
        onExit={exit}
        right={step === 'corners' ? undefined : <CamButton icon="undo" label="Undo" onPress={undo} disabled={!history.length} />}
      />

      {step === 'align' && base && (
        <Sheet>
          <Label tone="label" style={{ marginTop: 6 }}>
            Which room are you in?
          </Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginTop: 12, flexGrow: 0 }}>
            {base.rooms.map((r) => (
              <Choice
                key={r.id}
                label={r.name || 'Room'}
                chosen={r.id === anchorRoomId}
                onPress={() => {
                  setAnchorRoomId(r.id);
                  setAnchorCorner(0);
                  if (scan.alignFirst) commit({ ...scan, alignFirst: null });
                }}
              />
            ))}
          </ScrollView>
          <Txt size={13} tone="secondary" style={{ marginTop: 14 }}>
            Aim at the corner circled on the map, where the walls meet the floor, then tap the button.
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <SideButton
              title="Other corner"
              disabled={!!scan.alignFirst}
              onPress={() => setAnchorCorner((c) => (c + 1) % (anchorRoom?.points.length || 1))}
            />
            <Shutter icon="target" label={scan.alignFirst ? 'Match the second corner' : 'Match the first corner'} disabled={!status?.aimingAtFloor || !anchorTarget} onPress={matchCorner} />
            <View style={{ width: 104 }} />
          </View>
        </Sheet>
      )}

      {step === 'corners' && (
        <View style={{ position: 'absolute', left: 24, right: 24, bottom: insets.bottom + 26, gap: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label tone="ivory">{redrawn ? `Redrawing ${redrawn.name || 'room'}` : `Room ${roomNumber + 1}`}</Label>
            <Choice label={snap ? 'Right angles · on' : 'Right angles · off'} chosen={false} onPress={() => setSnap((s) => !s)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <SideButton title="Undo" icon="undo" onPress={undo} disabled={!history.length} />
            <Shutter
              icon={status?.closesShape ? 'target' : 'add'}
              label={status?.closesShape ? 'Close the room' : current.length ? `Add corner ${current.length + 1}` : 'Add the first corner'}
              disabled={!status?.aimingAtFloor}
              onPress={addCorner}
            />
            <SideButton title="Finish room" align="right" disabled={current.length < 3} onPress={finishRoom} />
          </View>
        </View>
      )}

      {step === 'name' && lastRoom && (
        <NameSheet
          rooms={snapshot?.rooms ?? []}
          lights={snapshot?.lights ?? []}
          title="Name this room"
          meta={`Room ${roomNumber} · ${lastRoom.points.length} corners · ${Math.round(polygonArea(lastRoom.points.map((p) => ({ u: p.x, v: p.z }))))} m²`}
          onDone={(n) => nameRoom(n.name, n.hueRoomId, n.outdoor)}
          onRoomCreated={refresh}
        />
      )}

      {step === 'lights' && (
        <LightsSheet
          title={lightsRoom ? `Lights in ${lightsRoom.name || 'this room'}` : 'Your lights'}
          rows={lightRows}
          placedCount={lightRows.filter((r) => r.state === 'placed' || r.state === 'activePlaced').length}
          canPlace={!!status?.aimingAtFloor}
          onPick={pick}
          onSkip={skip}
          onPlace={place}
          onDone={() => {
            setActive(null);
            commit({ ...scan, step: 'hub', lightsRoomId: null });
          }}
          doneLabel={lightsRoom ? `Done with ${lightsRoom.name || 'this room'}` : 'Done'}
          moreLabel={lightsRoom && otherRoomsCount ? (showOthers ? 'Hide lights from other rooms' : `Lights from other rooms (${otherRoomsCount})`) : undefined}
          onMore={() => setShowOthers((s) => !s)}
        />
      )}

      {step === 'hub' && (
        <Sheet>
          <Txt size={13} tone="secondary" style={{ marginTop: 6, marginBottom: 10 }}>
            {base && !rooms.length && !lights.length ? 'Your saved rooms show in the camera view. Everything you change is saved right away.' : 'Everything is saved. Keep going, or finish and review the map.'}
          </Txt>
          <ChoiceRow icon="add" title="Scan a new room" sub="Trace its corners on the floor" onPress={() => commit({ ...scan, step: 'corners', retracing: null })} />
          <ChoiceRow icon="edit" title="Redraw a room" sub="Trace its walls again, keep its name and lights" disabled={!allRooms.length} onPress={() => commit({ ...scan, step: 'pickRoom' })} />
          <ChoiceRow icon="light" title="Place or move lights" sub="Each light blinks, aim below it" disabled={!snapshot?.lights.length} onPress={() => openLights(null)} />
          <PillButton title="Finish and review" kind="primary" onPress={finish} style={{ marginTop: 14 }} />
        </Sheet>
      )}

      {step === 'pickRoom' && (
        <Sheet>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {allRooms.map((r) => (
              <Choice key={r.id} label={r.name || 'Room'} onPress={() => commit({ ...scan, step: 'corners', retracing: r.id, current: [] })} />
            ))}
          </View>
          <PillButton title="Back" kind="text" onPress={() => commit({ ...scan, step: 'hub' })} style={{ marginTop: 14 }} />
        </Sheet>
      )}

      {needsFloor && floor !== 'done' && !lost.show && <FindingFloor found={floor === 'found'} overSheet={step !== 'corners'} />}
      {lost.show && <TrackingLost reason={status?.reason ?? ''} kept={keptSummary} onKeep={lost.dismiss} onSave={finish} />}
    </View>
  );
}

function CornerTitle({ status, corners }: { status: ArStatus; corners: number }) {
  if (!status.aimingAtFloor) return <ScanTitle first="Aim lower," accent="at the floor" sub="THE RETICLE SITS ON THE FLOOR" />;
  if (status.closesShape) return <ScanTitle first="Back at the" accent="first corner" sub="TAP TO CLOSE THE ROOM" />;
  if (corners === 0) return <ScanTitle first="Aim at a" accent="first corner" sub="WHERE THE WALL MEETS THE FLOOR" />;
  return <ScanTitle first="Find the" accent="next corner" sub="WHERE THE WALL MEETS THE FLOOR" />;
}

/** "Lumière du salon is blinking · aim at the floor right below it." */
function LightHint({ light }: { light?: Light }) {
  const insets = useSafeAreaInsets();
  if (!light) return null;
  const shape = lightShape(light.archetype);
  const aim =
    shape === 'portable' ? 'Aim at its base, on the floor below the table.' : shape === 'string' ? 'Aim at the floor below its middle.' : shape === 'bar' || shape === 'lantern' ? 'Aim at the floor at the foot of the wall below it.' : 'Aim at the floor right below it.';
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 24, top: insets.top + 76, width: 236, padding: 14, borderRadius: 18, backgroundColor: 'rgba(5,5,6,0.84)', borderWidth: 1, borderColor: hairline(0.14), gap: 3 }}
    >
      <Txt size={14} numberOfLines={2}>
        {light.name} is blinking
      </Txt>
      <Txt size={12} tone="secondary">
        {light.reachable ? aim : "It doesn't answer, so it can't blink. Place it from memory."}
      </Txt>
    </View>
  );
}

/** Floor state for the UI: 'searching', then 'found' for a moment, then 'done' (it stays found). */
function useFloorFlash(found: boolean) {
  const [phase, setPhase] = useState<'searching' | 'found' | 'done'>('searching');
  if (found && phase === 'searching') setPhase('found');
  useEffect(() => {
    if (phase !== 'found') return;
    const t = setTimeout(() => setPhase('done'), 1400);
    return () => clearTimeout(t);
  }, [phase]);
  return phase;
}

/** Tracking lost for more than a moment, after it had worked: show the pause screen. */
function useLost(status: ArStatus | null) {
  const tracking = status?.tracking === 'tracking';
  const [hadTracking, setHadTracking] = useState(false);
  const [lostLong, setLostLong] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (tracking && !hadTracking) setHadTracking(true);
  if (tracking && (lostLong || dismissed)) {
    setLostLong(false);
    setDismissed(false);
  }
  useEffect(() => {
    if (tracking || !hadTracking) return;
    const t = setTimeout(() => setLostLong(true), 1500);
    return () => clearTimeout(t);
  }, [tracking, hadTracking]);
  return { show: lostLong && !dismissed && !tracking, dismiss: () => setDismissed(true) };
}
