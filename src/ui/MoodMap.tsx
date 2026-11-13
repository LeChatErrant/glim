import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';

import { fitPlan, mapToPlan, planToMap, toPlan, type FloorPoint, type HomeMap } from '../lib/map/map';
import { roomsWithin, sweepArrow } from '../lib/map/spread';
import { moodLightColor, type MapRecipe, type MoodLight } from '../lib/moods';
import { tintHex } from '../lib/tints';
import { color, hairline } from './theme';

export type MapTouch = { p: FloorPoint; phase: 'start' | 'move' | 'end'; moved: boolean };

/**
 * A sweep, spotlight or room glow on the map: room outlines as hairlines, the lights as the mood
 * would set them (a glowing dot in their color, bigger when brighter; hollow when left alone or
 * off), and the recipe's own marks: the sweep's arrow over a wash of its colors, the spotlight's
 * circle, each room filled with its color. With `onTouch` it's the editing surface: touches come
 * back in map coordinates.
 */
export function MoodMap({
  map,
  recipe,
  lights,
  height,
  width,
  selectedRoom,
  frame,
  onTouch,
}: {
  map: HomeMap;
  recipe: MapRecipe;
  /** The lights as the mood sets them now. */
  lights: MoodLight[];
  height: number;
  width?: number;
  /** A room drawn with a champagne edge (the one being colored). */
  selectedRoom?: string | null;
  /** Map points to frame instead of the whole home (small previews). */
  frame?: FloorPoint[];
  onTouch?: (t: MapTouch) => void;
}) {
  const [box, setBox] = useState(width ?? 0);
  const w = width ?? box;
  const plan = useMemo(() => toPlan(map), [map]);
  const f = useMemo(() => {
    if (!w) return null;
    const framed = (frame ?? []).map((p) => mapToPlan(plan, p));
    if (!framed.length) return fitPlan(plan, w, height, height * 0.07);
    const u0 = Math.min(...framed.map((p) => p.u));
    const v0 = Math.min(...framed.map((p) => p.v));
    const sub = { ...plan, width: Math.max(...framed.map((p) => p.u)) - u0 || 1, height: Math.max(...framed.map((p) => p.v)) - v0 || 1 };
    const fit = fitPlan(sub, w, height, height * 0.1);
    return { ...fit, x: (u: number) => fit.x(u - u0), y: (v: number) => fit.y(v - v0) };
  }, [w, height, plan, frame]);

  const latest = useRef({ f, plan, onTouch });
  useLayoutEffect(() => {
    latest.current = { f, plan, onTouch };
  });
  const start = useRef({ x: 0, y: 0 });
  // The handlers only read refs when touched, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const at = (x: number, y: number): FloorPoint | null => {
      const { f: fit, plan: pl } = latest.current;
      if (!fit) return null;
      return planToMap(pl, (x - fit.x(0)) / fit.scale, (y - fit.y(0)) / fit.scale);
    };
    const send = (x: number, y: number, phase: MapTouch['phase'], moved: boolean) => {
      const p = at(x, y);
      if (p) latest.current.onTouch?.({ p, phase, moved });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !!latest.current.onTouch,
      onMoveShouldSetPanResponder: () => !!latest.current.onTouch,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        send(start.current.x, start.current.y, 'start', false);
      },
      onPanResponderMove: (_, g) => send(start.current.x + g.dx, start.current.y + g.dy, 'move', Math.hypot(g.dx, g.dy) > 8),
      onPanResponderRelease: (_, g) => send(start.current.x + g.dx, start.current.y + g.dy, 'end', Math.hypot(g.dx, g.dy) > 8),
    });
  });

  const byId = new Map(lights.map((m) => [m.lightId, m]));
  const pt = (p: FloorPoint) => {
    const q = mapToPlan(plan, p);
    return { x: f!.x(q.u), y: f!.y(q.v) };
  };
  const glow = Math.max(6, height * 0.09);
  const core = Math.max(1.8, height * 0.016);
  const rooms = plan.rooms.filter((r) => r.pts.length >= 3);
  const d = (r: (typeof rooms)[number]) => `M${r.pts.map((p) => `${f!.x(p.u).toFixed(1)},${f!.y(p.v).toFixed(1)}`).join('L')}Z`;

  // Recipe marks.
  const swept = recipe.kind === 'sweep' && recipe.rooms ? roomsWithin(map, recipe.rooms) : null;
  const tints = recipe.kind === 'glow' ? new Map(recipe.rooms.map((r) => [r.id, tintHex(r.tint)])) : null;
  const arrow = f && recipe.kind === 'sweep' ? sweepArrow(map, recipe.angle, recipe.rooms) : null;
  const small = height < 100;

  return (
    <View style={{ height, width }} onLayout={width ? undefined : (e) => setBox(e.nativeEvent.layout.width)} {...(onTouch ? responder.panHandlers : {})}>
      {f && (
        <View pointerEvents="none">
          <Svg width={w} height={height}>
            <Defs>
              {arrow && recipe.kind === 'sweep' && (
                <LinearGradient id="sweep" gradientUnits="userSpaceOnUse" x1={pt(arrow.from).x} y1={pt(arrow.from).y} x2={pt(arrow.to).x} y2={pt(arrow.to).y}>
                  {recipe.tints.map((t, i) => (
                    <Stop key={i} offset={recipe.tints.length > 1 ? i / (recipe.tints.length - 1) : 0} stopColor={tintHex(t)} stopOpacity={0.2} />
                  ))}
                </LinearGradient>
              )}
              {recipe.kind === 'spot' && (
                <RadialGradient id="spot">
                  <Stop offset="0" stopColor={tintHex(recipe.tint)} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={tintHex(recipe.tint)} stopOpacity={0} />
                </RadialGradient>
              )}
              {lights
                .filter((m) => m.on)
                .map((m) => (
                  <RadialGradient key={m.lightId} id={`g-${m.lightId}`}>
                    <Stop offset="0" stopColor={moodLightColor(m) ?? color.champagne} stopOpacity={0.75} />
                    <Stop offset="1" stopColor={moodLightColor(m) ?? color.champagne} stopOpacity={0} />
                  </RadialGradient>
                ))}
            </Defs>
            {rooms.map((r) => {
              const fill =
                recipe.kind === 'sweep' ? (!swept || swept.has(r.id) ? 'url(#sweep)' : 'none') : tints?.get(r.id) ? tints.get(r.id)! : 'none';
              const picked = selectedRoom === r.id || (recipe.kind === 'sweep' && !!swept?.has(r.id));
              return (
                <Path
                  key={r.id}
                  d={d(r)}
                  fill={fill}
                  fillOpacity={recipe.kind === 'glow' ? 0.16 : 1}
                  stroke={selectedRoom === r.id ? color.champagne : hairline(picked ? 0.34 : 0.16)}
                  strokeWidth={selectedRoom === r.id ? 1.5 : 1}
                />
              );
            })}
            {recipe.kind === 'spot' && (
              <G>
                <Circle cx={pt(recipe.at).x} cy={pt(recipe.at).y} r={recipe.radius * f.scale} fill="url(#spot)" />
                <Circle
                  cx={pt(recipe.at).x}
                  cy={pt(recipe.at).y}
                  r={recipe.radius * f.scale}
                  fill="none"
                  stroke={color.champagne}
                  strokeOpacity={0.55}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
                {!small && <Circle cx={pt(recipe.at).x} cy={pt(recipe.at).y} r={7} fill="none" stroke={color.champagne} strokeWidth={1.2} />}
                <Circle cx={pt(recipe.at).x} cy={pt(recipe.at).y} r={small ? 1.5 : 2} fill={color.champagne} />
              </G>
            )}
            {arrow && <Arrow from={pt(arrow.from)} to={pt(arrow.to)} small={small} />}
            {plan.lights.map((l) => {
              const m = byId.get(l.lightId);
              const x = f.x(l.u);
              const y = f.y(l.v);
              if (!m?.on) return <Circle key={l.lightId} cx={x} cy={y} r={core * 0.8} fill="none" stroke={hairline(m ? 0.18 : 0.32)} strokeWidth={1} />;
              const k = 0.45 + 0.55 * ((m.brightness ?? 100) / 100);
              return (
                <G key={l.lightId}>
                  <Circle cx={x} cy={y} r={glow * k} fill={`url(#g-${l.lightId})`} />
                  <Circle cx={x} cy={y} r={core} fill={moodLightColor(m) ?? color.champagne} />
                </G>
              );
            })}
          </Svg>
        </View>
      )}
    </View>
  );
}

/** The sweep's arrow: a champagne line with a head, and a handle to drag on the editing map. */
function Arrow({ from, to, small }: { from: { x: number; y: number }; to: { x: number; y: number }; small: boolean }) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const h = small ? 4 : 9;
  const head = [
    [to.x, to.y],
    [to.x - h * Math.cos(a - 0.45), to.y - h * Math.sin(a - 0.45)],
    [to.x - h * Math.cos(a + 0.45), to.y - h * Math.sin(a + 0.45)],
  ]
    .map((p) => p.map((v) => v.toFixed(1)).join(','))
    .join(' ');
  return (
    <G>
      <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color.champagne} strokeOpacity={0.8} strokeWidth={small ? 1 : 1.4} strokeLinecap="round" />
      <Polygon points={head} fill={color.champagne} />
      {!small && <Circle cx={from.x} cy={from.y} r={3} fill="none" stroke={color.champagne} strokeWidth={1.2} />}
    </G>
  );
}
