import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, Path, RadialGradient, Stop } from 'react-native-svg';

import type { Light, Room } from '../lib/hue/client';
import { lightLevel, lightTypeLabel } from '../lib/lights';
import { placeLights, walledRooms, type PlacedLight } from '../lib/map/glow';
import { fitPlan, type Plan } from '../lib/map/map';
import { Icon } from './icons';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

type Props = {
  plan: Plan;
  lights: Light[];
  rooms: Room[];
  width: number;
  height: number;
  selectedId: string | null;
  /** Tap on a light. */
  onLightPress: (id: string) => void;
  /** Drag up/down on a dimmable light: brightness 1–100, `done` on release. */
  onLightDrag: (id: string, brightness: number, done: boolean) => void;
  /** Tap inside a room, away from lights. */
  onRoomPress: (hueRoomId: string) => void;
  /** Long-press on a light, or "Open" in its label: the light screen. */
  onLightOpen: (id: string) => void;
};

const MARKER = 44;

/**
 * The Nocturne floor plan: rooms as free polygons with hairline walls, each light casting a glow
 * shaped by its type and clipped to its room's walls, jewel markers on top.
 */
export function FloorPlan({ plan, lights, rooms, width, height, selectedId, onLightPress, onLightDrag, onRoomPress, onLightOpen }: Props) {
  const f = useMemo(() => fitPlan(plan, width, height, 16), [plan, width, height]);
  const walled = useMemo(() => walledRooms(plan), [plan]);
  const placed = useMemo(() => placeLights(plan, lights), [plan, lights]);
  const roomName = (r: Plan['rooms'][number]) => rooms.find((x) => x.id === r.hueRoomId)?.name ?? r.name;
  const pathOf = (pts: { u: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${f.x(p.u).toFixed(1)},${f.y(p.v).toFixed(1)}`).join(' ') + ' Z';
  const px = (m: number) => m * f.scale;

  const zones = plan.rooms.filter((r) => r.pts.length >= 3 && !walled.includes(r));
  const lit = placed.filter((p) => p.light.on && p.light.reachable);

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} style={{ position: 'absolute' }}>
        <Defs>
          {walled.map((r) => (
            <ClipPath key={r.id} id={`clip-${r.id}`}>
              <Path d={pathOf(r.pts)} />
            </ClipPath>
          ))}
          {lit.map((p) => (
            <RadialGradient key={p.light.id} id={`glow-${p.light.id}`} cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={p.light.color} stopOpacity={1} />
              <Stop offset="0.22" stopColor={p.light.color} stopOpacity={0.42} />
              <Stop offset="0.55" stopColor={p.light.color} stopOpacity={0.14} />
              <Stop offset="1" stopColor={p.light.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>

        {walled.map((r) => (
          <Path key={r.id} d={pathOf(r.pts)} fill={r.outdoor ? color.floorOutdoor : color.floor} />
        ))}

        {lit.map((p) => (
          <G key={p.light.id} clipPath={p.room ? `url(#clip-${p.room.id})` : undefined} opacity={p.pools[0]?.alpha ?? 1}>
            {p.pools.map((pool, i) => (
              <Ellipse
                key={i}
                cx={f.x(pool.u)}
                cy={f.y(pool.v)}
                rx={Math.max(px(pool.rx), 10)}
                ry={Math.max(px(pool.ry), 10)}
                transform={pool.angle ? `rotate(${(pool.angle * 180) / Math.PI} ${f.x(pool.u)} ${f.y(pool.v)})` : undefined}
                fill={`url(#glow-${p.light.id})`}
              />
            ))}
          </G>
        ))}

        {walled.map((r) => (
          <Path
            key={r.id}
            d={pathOf(r.pts)}
            fill="none"
            stroke={hairline(r.outdoor ? 0.2 : 0.24)}
            strokeWidth={1}
            strokeDasharray={r.outdoor ? '3 4' : undefined}
          />
        ))}
        {zones.map((r) => (
          <Path key={r.id} d={pathOf(r.pts)} fill="none" stroke={hairline(0.2)} strokeWidth={1} strokeDasharray="2 3" />
        ))}

        {/* Tap targets last, so glows never swallow a tap. Zones after walls: the smaller one wins. */}
        {[...walled, ...zones].map((r) =>
          r.hueRoomId ? <Path key={r.id} d={pathOf(r.pts)} fill={color.ground} fillOpacity={0.001} onPress={() => onRoomPress(r.hueRoomId!)} /> : null,
        )}
      </Svg>

      {[...walled, ...zones].map((r) => {
        const xs = r.pts.map((p) => f.x(p.u));
        const ys = r.pts.map((p) => f.y(p.v));
        const w = Math.max(...xs) - Math.min(...xs);
        if (w < 56) return null;
        const zone = zones.includes(r);
        return (
          <View key={r.id} pointerEvents="none" style={{ position: 'absolute', left: Math.min(...xs) + (zone ? 8 : 12), top: Math.min(...ys) + (zone ? 6 : 11), maxWidth: w - 16 }}>
            <Label size={zone || !r.hueRoomId ? 8 : 9} numberOfLines={1} style={{ color: `rgba(242,232,216,${r.hueRoomId && !zone ? 0.82 : 0.6})` }}>
              {roomName(r)}
            </Label>
          </View>
        );
      })}

      {placed
        .filter((p) => p.shape === 'string')
        .flatMap((p) =>
          p.beads.map((b, i) => {
            const on = p.light.on && p.light.reachable;
            return (
              <View
                key={`${p.light.id}-${i}`}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: f.x(b.u) - 2,
                  top: f.y(b.v) - 2,
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: on ? '#FFE2B0' : '#4A4640',
                  boxShadow: on ? `0 0 6px 2px ${p.light.color}` : undefined,
                }}
              />
            );
          }),
        )}

      {placed.map((p) => (
        <Marker
          key={p.light.id}
          placed={p}
          x={f.x(p.u)}
          y={f.y(p.v)}
          selected={p.light.id === selectedId}
          onPress={() => onLightPress(p.light.id)}
          onDrag={(v, done) => onLightDrag(p.light.id, v, done)}
          onLongPress={() => onLightOpen(p.light.id)}
        />
      ))}

      {(() => {
        const p = placed.find((x) => x.light.id === selectedId);
        if (!p) return null;
        const x = f.x(p.u);
        const right = x > width / 2;
        return (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: f.y(p.v) + 22,
              ...(right ? { right: width - x - 14 } : { left: x - 14 }),
              // Stays inside the map: the name shrinks instead.
              maxWidth: right ? x + 14 : width - x + 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: 28,
              paddingHorizontal: 10,
              borderRadius: 14,
              backgroundColor: 'rgba(5,5,6,0.88)',
              borderWidth: 1,
              borderColor: 'rgba(233,207,159,0.32)',
            }}
          >
            {/* The name gives way first, so "Open" always fits. */}
            <Txt size={11} medium numberOfLines={1} style={{ lineHeight: 14, maxWidth: 150, flexShrink: 1 }}>
              {p.light.name}
            </Txt>
            <Txt size={11} tone="muted" style={{ lineHeight: 14 }}>
              {lightTypeLabel(p.light)}
            </Txt>
            <Txt size={11} tone="champagne" style={{ lineHeight: 14, fontVariant: ['tabular-nums'] }}>
              {lightLevel(p.light)}
            </Txt>
            <View style={{ width: 1, height: 14, backgroundColor: hairline(0.16) }} />
            <Pressable
              onPress={() => onLightOpen(p.light.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${p.light.name}`}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 10 }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, opacity: pressed ? 0.6 : 1 })}
            >
              <Txt size={11} medium style={{ lineHeight: 14 }}>
                Open
              </Txt>
              <Icon name="chevronRight" size={11} stroke={2} />
            </Pressable>
          </View>
        );
      })()}
    </View>
  );
}

/** A jewel light marker: color core, dark gap, ivory ring, glow. Plugs are diamonds, light bars capsules. */
export function Jewel({ light, shape, size = 9, ground = color.ground, angle = Math.PI / 2 }: { light: Light; shape: PlacedLight['shape']; size?: number; ground?: string; angle?: number }) {
  const on = light.on && light.reachable;
  const ring = size >= 8 ? 2 : 1.5;
  const look = on
    ? { backgroundColor: light.color, boxShadow: `0 0 0 ${ring}px ${ground}, 0 0 0 ${ring + 1}px ${color.jewelRing}, 0 0 ${size + 7}px ${Math.round(size / 3)}px ${light.color}` }
    : { borderWidth: 1, borderColor: hairline(0.55), backgroundColor: ground };
  if (light.kind === 'onoff') {
    const s = size - 1;
    return <View style={{ width: s, height: s, transform: [{ rotate: '45deg' }], ...look }} />;
  }
  if (shape === 'bar') {
    const deg = (angle * 180) / Math.PI;
    return <View style={{ width: Math.round(size * 0.66), height: Math.round(size * 1.8), borderRadius: 3, transform: [{ rotate: `${deg - 90}deg` }], ...look }} />;
  }
  const s = shape === 'portable' ? size - 2 : on ? size : size + 1;
  return <View style={{ width: s, height: s, borderRadius: s / 2, ...look }} />;
}

const LONG_PRESS_MS = 450;

function Marker({
  placed,
  x,
  y,
  selected,
  onPress,
  onDrag,
  onLongPress,
}: {
  placed: PlacedLight;
  x: number;
  y: number;
  selected: boolean;
  onPress: () => void;
  onDrag: (v: number, done: boolean) => void;
  onLongPress: () => void;
}) {
  const { light } = placed;
  const latest = useRef({ light, onPress, onDrag, onLongPress });
  useLayoutEffect(() => {
    latest.current = { light, onPress, onDrag, onLongPress };
  });
  const drag = useRef({ start: 0, moved: false, value: 0, long: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTimer, []);

  const responder = useMemo(
    () =>
      // The handlers only read refs when touched, never during render.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const l = latest.current.light;
          drag.current = { start: l.on ? (l.brightness ?? 100) : 1, moved: false, value: 0, long: false };
          // Held still: open the light instead of toggling it.
          timer.current = setTimeout(() => {
            timer.current = null;
            drag.current.long = true;
            latest.current.onLongPress();
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (_, g) => {
          const l = latest.current.light;
          if (drag.current.long) return;
          if (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8) stopTimer();
          if (l.brightness === null || !l.reachable) return;
          if (!drag.current.moved && Math.abs(g.dy) < 8) return;
          drag.current.moved = true;
          // 2 px per percent, up is brighter.
          const v = Math.max(1, Math.min(100, Math.round(drag.current.start - g.dy / 2)));
          if (v !== drag.current.value) {
            drag.current.value = v;
            latest.current.onDrag(v, false);
          }
        },
        onPanResponderRelease: () => {
          stopTimer();
          if (drag.current.long) return;
          if (drag.current.moved) latest.current.onDrag(drag.current.value, true);
          else latest.current.onPress();
        },
        onPanResponderTerminate: stopTimer,
      }),
    [],
  );

  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${light.name}, ${lightTypeLabel(light)}, ${lightLevel(light)}`}
      style={{ position: 'absolute', left: x - MARKER / 2, top: y - MARKER / 2, width: MARKER, height: MARKER, alignItems: 'center', justifyContent: 'center' }}
    >
      {selected && <View style={{ position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(233,207,159,0.9)' }} />}
      {!light.reachable && <View style={{ position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: color.warning }} />}
      <Jewel light={light} shape={placed.shape} angle={placed.wallAngle} />
    </View>
  );
}
