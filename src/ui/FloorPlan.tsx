import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, View } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, Line, Path, RadialGradient, Stop } from 'react-native-svg';

import { FLICKERS } from '../lib/effects';
import type { Light, Room } from '../lib/hue/client';
import { inkOn, LIGHT_ICON_PATHS } from '../lib/lightIcons';
import { lightLevel, lightType, lightTypeLabel } from '../lib/lights';
import { placeLights, walledRooms, type PlacedLight } from '../lib/map/glow';
import { capsWidth, labelSpot } from '../lib/map/labels';
import { fitPlan, type Plan, type PlanView } from '../lib/map/map';
import { useLightTween } from './useLightTween';
import { Label } from './text';
import { color, hairline } from './theme';

type Props = {
  plan: Plan;
  lights: Light[];
  rooms: Room[];
  width: number;
  height: number;
  /** Pinch zoom and pan; the whole plan fits when absent. */
  view?: PlanView;
  selectedId: string | null;
  /** Tap on a light. */
  onLightPress: (id: string) => void;
  /** Drag up/down on a dimmable light: brightness 1–100, `done` on release. */
  onLightDrag: (id: string, brightness: number, done: boolean) => void;
  /** Tap inside a room, away from lights. */
  onRoomPress: (hueRoomId: string) => void;
  /** Tap on the map away from rooms with lights (clears the selection). */
  onBackgroundPress?: () => void;
  /** Long-press on a light, or "Open" in its label: the light screen. */
  onLightOpen: (id: string) => void;
};

const MARKER = 44;
/** The visible marker inside the 44 px touch target. */
const MARKER_SIZE = 22;

/**
 * The Nocturne floor plan: rooms as free polygons with hairline walls, each light casting a glow
 * shaped by its type and clipped to its room's walls, jewel markers on top.
 */
export function FloorPlan({ plan, lights, rooms, width, height, view, selectedId, onLightPress, onLightDrag, onRoomPress, onBackgroundPress, onLightOpen }: Props) {
  const f = useMemo(() => fitPlan(plan, width, height, 16, view), [plan, width, height, view]);
  const walled = useMemo(() => walledRooms(plan), [plan]);
  const tween = useLightTween(lights);
  const breath = useBreath();
  const flicker = useFlicker();
  const placed = useMemo(() => placeLights(plan, tween.lights), [plan, tween.lights]);
  const fade = (id: string) => tween.fade.get(id) ?? 1;
  const roomName = (r: Plan['rooms'][number]) => rooms.find((x) => x.id === r.hueRoomId)?.name ?? r.name;
  const pathOf = (pts: { u: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${f.x(p.u).toFixed(1)},${f.y(p.v).toFixed(1)}`).join(' ') + ' Z';
  const px = (m: number) => m * f.scale;

  // react-native-svg keeps a clip path or gradient by id and ignores later changes to it: ids that
  // change with the layout (zoom, pan, turn) make it redraw them instead of clipping to old walls.
  const layout = useMemo(() => hash(walled.map((r) => pathOf(r.pts)).join('')), [walled, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const zones = plan.rooms.filter((r) => r.pts.length >= 3 && !walled.includes(r));
  const markers = placed.map((p) => ({ x: f.x(p.u), y: f.y(p.v) }));
  const lit = placed.filter((p) => p.light.on && p.light.reachable && fade(p.light.id) > 0.01);

  return (
    // A tap nothing else takes (outside rooms with lights) reaches the map itself.
    <View style={{ width, height }} onStartShouldSetResponder={() => !!onBackgroundPress} onResponderRelease={onBackgroundPress}>
      <Svg width={width} height={height} style={{ position: 'absolute' }}>
        <Defs>
          {walled.map((r) => (
            <ClipPath key={`${r.id}-${layout}`} id={`clip-${r.id}-${layout}`}>
              <Path d={pathOf(r.pts)} />
            </ClipPath>
          ))}
          {lit.map((p) => (
            <RadialGradient key={p.light.id} id={`glow-${p.light.id}-${p.light.color.slice(1)}`} cx="50%" cy="50%" rx="50%" ry="50%">
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

        {lit.map((p, i) => (
          <AnimatedG
            key={p.light.id}
            clipPath={p.room ? `url(#clip-${p.room.id}-${layout})` : undefined}
            opacity={Animated.multiply(FLICKERS.includes(p.light.effect ?? '') ? flicker : breath[i % breath.length], (p.pools[0]?.alpha ?? 1) * fade(p.light.id))}
          >
            {p.pools.map((pool, i) => (
              <Ellipse
                key={i}
                cx={f.x(pool.u)}
                cy={f.y(pool.v)}
                rx={Math.max(px(pool.rx), 10)}
                ry={Math.max(px(pool.ry), 10)}
                transform={pool.angle ? `rotate(${(pool.angle * 180) / Math.PI} ${f.x(pool.u)} ${f.y(pool.v)})` : undefined}
                fill={`url(#glow-${p.light.id}-${p.light.color.slice(1)})`}
              />
            ))}
          </AnimatedG>
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

        {/* Lightstrips: the strip itself, a warm core in a halo of its color. */}
        {placed.map((p) => {
          if (!p.ends) return null;
          const [a, b] = p.ends;
          const on = p.light.on && p.light.reachable;
          const line = { x1: f.x(a.u), y1: f.y(a.v), x2: f.x(b.u), y2: f.y(b.v), strokeLinecap: 'round' as const };
          return (
            <G key={`strip-${p.light.id}`} pointerEvents="none">
              {on && <Line {...line} stroke={p.light.color} strokeOpacity={0.45} strokeWidth={6} />}
              <Line {...line} stroke={on ? '#FFE2B0' : '#4A4640'} strokeWidth={2} />
            </G>
          );
        })}

        {/* Tap targets last, so glows never swallow a tap. Zones after walls: the smaller one wins. */}
        {[...walled, ...zones].map((r) =>
          r.hueRoomId ? <Path key={r.id} d={pathOf(r.pts)} fill={color.ground} fillOpacity={0.001} onPress={() => onRoomPress(r.hueRoomId!)} /> : null,
        )}
      </Svg>

      {[...walled, ...zones].map((r) => {
        const xs = r.pts.map((p) => f.x(p.u));
        const w = Math.max(...xs) - Math.min(...xs);
        if (w < 56) return null;
        const zone = zones.includes(r);
        const size = zone || !r.hueRoomId ? 8 : 9;
        const name = roomName(r);
        const spot = labelSpot(
          r.pts.map((p) => ({ x: f.x(p.u), y: f.y(p.v) })),
          markers,
          Math.min(capsWidth(name, size), w - 16),
          size + 4,
          zone ? 6 : 10,
        );
        return (
          <View key={r.id} pointerEvents="none" style={{ position: 'absolute', left: spot.x, top: spot.y, maxWidth: w - 16 }}>
            <Label size={size} numberOfLines={1} style={{ color: `rgba(242,232,216,${r.hueRoomId && !zone ? 0.82 : 0.6})` }}>
              {name}
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

/**
 * A light on the map and in lists: a jewel big enough to hold the icon of what the light is.
 * On: filled with its color, dark gap, ivory ring, glow. Off: hollow, ivory icon. Unreachable:
 * dashed amber ring, faded icon and a strike-through, so it never looks like a lit light.
 * `glow` is off in lists: scroll views would cut it into a hard-edged block.
 */
export function LightMarker({ light, size = 24, ground = color.ground, glow = true }: { light: Light; size?: number; ground?: string; glow?: boolean }) {
  const on = light.on && light.reachable;
  const icon = Math.round(size * 0.6);
  const ink = on ? inkOn(light.color) : light.reachable ? hairline(0.78) : hairline(0.32);
  const look = on
    ? { backgroundColor: light.color, boxShadow: `0 0 0 2px ${ground}, 0 0 0 3px ${color.jewelRing}` + (glow ? `, 0 0 ${size}px ${Math.round(size / 4)}px ${light.color}` : '') }
    : light.reachable
      ? { backgroundColor: ground, borderWidth: 1, borderColor: hairline(0.55) }
      : { backgroundColor: ground, borderWidth: 1, borderStyle: 'dashed' as const, borderColor: color.warning };
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', ...look }}>
      <Svg width={icon} height={icon} viewBox="0 0 24 24" fill="none">
        <Path d={LIGHT_ICON_PATHS[lightType(light.archetype)]} stroke={ink} strokeWidth={size >= 22 ? 1.9 : 2.2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      {!light.reachable && (
        <View style={{ position: 'absolute', width: size * 1.15, height: 1.5, borderRadius: 1, backgroundColor: color.warning, transform: [{ rotate: '-45deg' }] }} />
      )}
    </View>
  );
}

const AnimatedG = Animated.createAnimatedComponent(G);

/**
 * Lit glows breathe slowly (a few percent of their strength), in three phases so neighbors don't
 * pulse together. Runs only while the map is on screen; widgets stay still.
 */
function useBreath() {
  const [values] = useState(() => [0, 1, 2].map(() => new Animated.Value(1)));
  useFocusEffect(
    useCallback(() => {
      const loops = values.map((v, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(i * 1400),
            Animated.timing(v, { toValue: 0.82, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
            Animated.timing(v, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          ]),
        ),
      );
      loops.forEach((l) => l.start());
      return () => loops.forEach((l) => l.stop());
    }, [values]),
  );
  return values;
}

/** A candle-like flicker for lights running the Candle or Fireplace effect (map only). */
function useFlicker() {
  const [value] = useState(() => new Animated.Value(1));
  useFocusEffect(
    useCallback(() => {
      // A fixed irregular pattern reads as a flame; true randomness isn't needed.
      const steps = [0.78, 0.95, 0.84, 1, 0.72, 0.9, 0.97, 0.8, 0.93, 0.86, 1, 0.75];
      const loop = Animated.loop(
        Animated.sequence(steps.map((v, i) => Animated.timing(value, { toValue: v, duration: 90 + ((i * 37) % 110), easing: Easing.inOut(Easing.quad), useNativeDriver: false }))),
      );
      loop.start();
      return () => loop.stop();
    }, [value]),
  );
  return value;
}

/** Short string hash (djb2), for SVG ids that follow content. */
function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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
        // A second finger means pinch or twist on the map: let it go.
        onPanResponderTerminationRequest: (e) => e.nativeEvent.touches.length > 1,
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
        onPanResponderTerminate: () => {
          stopTimer();
          // Taken over by a pinch mid-drag: keep the brightness reached so far.
          if (drag.current.moved && !drag.current.long) latest.current.onDrag(drag.current.value, true);
        },
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
      {selected && <View style={{ position: 'absolute', width: MARKER_SIZE + 12, height: MARKER_SIZE + 12, borderRadius: (MARKER_SIZE + 12) / 2, borderWidth: 1, borderColor: 'rgba(233,207,159,0.9)' }} />}
      <LightMarker light={light} size={MARKER_SIZE} />
    </View>
  );
}
