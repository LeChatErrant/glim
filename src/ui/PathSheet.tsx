import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Polyline, RadialGradient, Stop } from 'react-native-svg';

import type { Snapshot } from '../lib/hue/client';
import { fitPlan, toPlan, type HomeMap } from '../lib/map/map';
import { findRoute, type Route } from '../lib/map/route';
import { PATH_OFF_AFTER, PATH_TONES, pathLights, type PathRecipe, type PathTone } from '../lib/moods';
import { PillButton, Slider } from './controls';
import { Field, ModalSheet } from './ModalSheet';
import { Choice } from './scan/parts';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

/** A map room's name: its Hue room's when it has one (renamed in Hue), else its own. */
export function mapRoomName(map: HomeMap, s: Snapshot | null, id: string) {
  const r = map.rooms.find((x) => x.id === id);
  if (!r) return 'Removed room';
  return (r.hueRoomId && s?.rooms.find((h) => h.id === r.hueRoomId)?.name) || r.name || 'Room';
}

const pathName = (map: HomeMap, s: Snapshot | null, p: Pick<PathRecipe, 'from' | 'to'>) => `${mapRoomName(map, s, p.from)} → ${mapRoomName(map, s, p.to)}`;

/** First guess for a new path: from a bedroom to a bathroom, by the Hue rooms' types. */
function defaultPath(map: HomeMap, s: Snapshot | null): PathRecipe {
  const rooms = map.rooms.filter((r) => r.points.length >= 3);
  const byType = (type: string) => rooms.find((r) => r.hueRoomId && s?.rooms.find((h) => h.id === r.hueRoomId)?.archetype === type)?.id;
  const from = byType('bedroom') ?? rooms[0]?.id ?? '';
  const to = byType('bathroom') ?? rooms.find((r) => r.id !== from)?.id ?? from;
  return { from, to, brightness: 12, tone: 'warm', others: 'leave' };
}

/**
 * Creates or edits a path (night path): from a room to another, how bright, which light, and
 * whether every other light turns off. The route and its lights show on a small map as you go;
 * "Try it" lights it for real.
 */
export function PathSheet({
  map,
  snapshot,
  initial,
  onTry,
  onSave,
  onDelete,
  onClose,
}: {
  map: HomeMap;
  snapshot: Snapshot | null;
  /** The path being edited, or none for a new one. */
  initial?: { name: string; path: PathRecipe };
  onTry: (p: PathRecipe) => void;
  onSave: (name: string, p: PathRecipe) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState<PathRecipe>(() => initial?.path ?? defaultPath(map, snapshot));
  const [name, setName] = useState<string | null>(initial && initial.name !== pathName(map, snapshot, initial.path) ? initial.name : null);
  const rooms = map.rooms.filter((r) => r.points.length >= 3);
  const set = (change: Partial<PathRecipe>) => setPath((p) => ({ ...p, ...change }));
  const lit = useMemo(() => (snapshot ? (pathLights(snapshot, path, map) ?? []).filter((m) => m.on) : []), [snapshot, path, map]);
  const names = lit.map((m) => snapshot?.lights.find((l) => l.id === m.lightId)?.name).filter(Boolean);
  const tone = PATH_TONES.find((t) => t.id === path.tone) ?? PATH_TONES[0];

  const roomChoices = (pick: string, onPick: (id: string) => void, label: string) => (
    <Choices label={label}>
      {rooms.map((r) => (
        <Choice key={r.id} label={mapRoomName(map, snapshot, r.id)} chosen={pick === r.id} onPress={() => onPick(r.id)} />
      ))}
    </Choices>
  );

  return (
    <ModalSheet visible title={initial ? 'Edit path' : 'New night path'} onClose={onClose}>
      <Txt size={13} tone="secondary">
        A dim trail from one room to another, along the lights on the way. It follows your map, so moving a light changes the path.
      </Txt>
      <PathPreview map={map} path={path} lit={lit.map((m) => m.lightId)} tint={tone.hex} height={150} />
      <Txt size={12} tone="muted">
        {names.length ? `${names.length} ${names.length === 1 ? 'light' : 'lights'}: ${names.join(', ')}` : 'No light on this way yet: place some on the map.'}
      </Txt>
      {roomChoices(path.from, (from) => set({ from }), 'From')}
      {roomChoices(path.to, (to) => set({ to }), 'To')}
      <Choices label="Light">
        {PATH_TONES.map((t) => (
          <Choice key={t.id} label={t.label} dot={t.hex} chosen={path.tone === t.id} onPress={() => set({ tone: t.id as PathTone })} />
        ))}
      </Choices>
      <View style={{ gap: 8 }}>
        <Label>Brightness · {path.brightness}%</Label>
        <Slider value={path.brightness} min={1} max={60} tint={tone.hex} ground={color.sheet} label="Path brightness" onChange={(brightness) => set({ brightness })} onCommit={(brightness) => set({ brightness })} />
      </View>
      <Choices label="Other lights">
        <Choice label="Leave as they are" chosen={path.others === 'leave'} onPress={() => set({ others: 'leave' })} />
        <Choice label="Turn off" chosen={path.others === 'off'} onPress={() => set({ others: 'off' })} />
      </Choices>
      <Choices label="Turn off after">
        {PATH_OFF_AFTER.map((min) => (
          <Choice key={min} label={min ? `${min} min` : 'Never'} chosen={(path.offAfter ?? 0) === min} onPress={() => set({ offAfter: min || undefined })} />
        ))}
      </Choices>
      <Field label="Name" value={name ?? pathName(map, snapshot, path)} onChange={setName} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PillButton title="Try it" onPress={() => onTry(path)} disabled={!lit.length} style={{ flex: 1 }} />
        <PillButton title="Save" kind="primary" onPress={() => onSave(name?.trim() || pathName(map, snapshot, path), path)} style={{ flex: 1 }} />
      </View>
      {onDelete && <PillButton title="Delete path" kind="text" height={40} onPress={onDelete} style={{ alignSelf: 'flex-start' }} />}
    </ModalSheet>
  );
}

function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {children}
      </ScrollView>
    </View>
  );
}

const ROUTE_ID = '__route';

/**
 * A path on a tiny map: room outlines as hairlines, the rooms walked through a shade lighter, the
 * route as a dashed champagne line, and a glowing dot at each light it turns on (the night path
 * "constellation").
 */
export function PathPreview({
  map,
  path,
  lit,
  tint,
  height,
  width,
  focus,
}: {
  map: HomeMap;
  path: Pick<PathRecipe, 'from' | 'to'>;
  lit: string[];
  tint: string;
  height: number;
  width?: number;
  /** Frame the rooms walked through instead of the whole home (small previews). */
  focus?: boolean;
}) {
  const [box, setBox] = useState(width ?? 0);
  const route: Route | null = useMemo(() => findRoute(map, path.from, path.to), [map, path.from, path.to]);
  const plan = useMemo(
    () => toPlan({ ...map, rooms: [...map.rooms, ...(route ? [{ id: ROUTE_ID, name: '', hueRoomId: null, points: route.points }] : [])] }),
    [map, route],
  );
  const w = width ?? box;
  const walked = new Set(route?.rooms ?? []);
  const f = useMemo(() => {
    if (!w) return null;
    const framed = focus ? plan.rooms.filter((r) => walked.has(r.id)).flatMap((r) => r.pts) : [];
    if (!framed.length) return fitPlan(plan, w, height, height * 0.07);
    // Fit the walked rooms; the rest of the home runs off the edges.
    const u0 = Math.min(...framed.map((p) => p.u));
    const v0 = Math.min(...framed.map((p) => p.v));
    const frame = { ...plan, width: Math.max(...framed.map((p) => p.u)) - u0 || 1, height: Math.max(...framed.map((p) => p.v)) - v0 || 1 };
    const fit = fitPlan(frame, w, height, height * 0.1);
    return { ...fit, x: (u: number) => fit.x(u - u0), y: (v: number) => fit.y(v - v0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, height, plan, focus, route]);
  const glow = Math.max(5, height * 0.075);
  const core = Math.max(1.8, height * 0.017);
  const line = plan.rooms.find((r) => r.id === ROUTE_ID);
  const litSet = new Set(lit);
  const gid = `pathglow-${tint.slice(1)}`;
  return (
    <View style={{ height, width }} onLayout={width ? undefined : (e) => setBox(e.nativeEvent.layout.width)}>
      {f && (
        <Svg width={w} height={height}>
          <Defs>
            <RadialGradient id={gid}>
              <Stop offset="0" stopColor={tint} stopOpacity={0.75} />
              <Stop offset="1" stopColor={tint} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {plan.rooms
            .filter((r) => r.id !== ROUTE_ID && r.pts.length >= 3)
            .map((r) => (
              <Path
                key={r.id}
                d={`M${r.pts.map((p) => `${f.x(p.u).toFixed(1)},${f.y(p.v).toFixed(1)}`).join('L')}Z`}
                fill={walked.has(r.id) ? 'rgba(242,232,216,0.05)' : 'none'}
                stroke={hairline(walked.has(r.id) ? 0.3 : 0.14)}
                strokeWidth={1}
              />
            ))}
          {line && line.pts.length > 1 && (
            <Polyline
              points={line.pts.map((p) => `${f.x(p.u).toFixed(1)},${f.y(p.v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={color.champagne}
              strokeOpacity={0.7}
              strokeWidth={1.2}
              strokeDasharray="3 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {plan.lights.map((l) =>
            litSet.has(l.lightId) ? (
              <G key={l.lightId}>
                <Circle cx={f.x(l.u)} cy={f.y(l.v)} r={glow} fill={`url(#${gid})`} />
                <Circle cx={f.x(l.u)} cy={f.y(l.v)} r={core} fill={tint} />
              </G>
            ) : (
              <Circle key={l.lightId} cx={f.x(l.u)} cy={f.y(l.v)} r={core * 0.7} fill="none" stroke={hairline(0.3)} strokeWidth={1} />
            ),
          )}
        </Svg>
      )}
    </View>
  );
}
