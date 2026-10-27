import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { Light } from '../lib/hue/client';
import { fitPlan, type Plan, type PlanView } from '../lib/map/map';
import {
  cloudShadowsSvg,
  darknessSvg,
  fireflies,
  fogSvg,
  groundSvg,
  houseGeom,
  glossSvg,
  houseSvg,
  mistSvg,
  outdoorAreas,
  particleLayers,
  puddlesSvg,
  ripples,
  sparklePoints,
  svg,
  svgBox,
  terraceFx,
  type Box as AreaBox,
  type HouseGeom,
  type ParticleLayer,
  type Pt,
} from '../lib/weather/scene';
import { rgba, type Sky } from '../lib/weather/sky';
import { color } from './theme';

// The outside around the map (the light of the hour and the weather in a band around the house,
// the dark beyond), drawn behind the Map tab. react-native-svg draws each SVG into a bitmap the size of its view,
// so SVG layers stay screen-sized and everything that moves is made of plain views, moved by
// Animated on the native driver.

type Box = { x: number; y: number; w: number; h: number };

type Props = {
  sky: Sky;
  /** The whole screen. */
  width: number;
  height: number;
  plan: Plan;
  lights: Light[];
  /** Where the map sits on screen, and how it is zoomed, panned and twisted right now. */
  mapBox: Box;
  view?: PlanView;
  twist?: number;
  /** Animations run only while the map is on screen. */
  active: boolean;
};

const PAD = 16;
const u = 1;
/** How far from the walls we still see, in dp. */
const REACH = 46;
/** Past the screen's edges, so panning and turning the map don't uncover it. */
const EXTEND = 200;
const FILL = { position: 'absolute' as const, left: 0, top: 0, right: 0, bottom: 0 };

export function OutsideBack({ sky, width, height, plan, lights, mapBox, view, twist = 0, active }: Props) {
  // Screen geometry at the plain fit; the house layer then follows zoom, pan and twist.
  const geom = useMemo(() => offset(houseGeom(plan, fitPlan(plan, mapBox.w, mapBox.h, PAD), lights), mapBox.x, mapBox.y), [plan, mapBox, lights]);

  const ground = useMemo(
    () => svg(width, height, groundSvg(sky, width, height, geom, u) + cloudShadowsSvg(sky, width, height, u) + fogSvg(sky, width, height, u, 0)),
    [sky, width, height, geom],
  );
  const area = { x: -EXTEND, y: -EXTEND, w: width + 2 * EXTEND, h: height + 2 * EXTEND };
  const house = useMemo(
    () => svg(width, height, houseSvg(sky, width, geom, u, false) + darknessSvg(geom, REACH * u, 32, area, color.ground)),
    [sky, width, height, geom], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const fogHigh = useMemo(() => fogSvg(sky, width, height, u, 1), [sky, width, height]);
  const snowy = sky.weather === 'snow';
  const areas = useMemo(() => outdoorAreas(geom, u), [geom]);
  const fxKind = kindOf(sky);
  const fx = useMemo(() => terraceFx(sky, areas, u), [fxKind, areas]); // eslint-disable-line react-hooks/exhaustive-deps
  // Puddles and the wet gloss share one layer drawn in the area's own shape, pulsing gently.
  const puddles = useMemo(
    () => areas.map((a, i) => ({ box: grow(a.box, 30), body: puddlesSvg(sky, a, u, i) + (sky.wet ? glossSvg(a, a.box.x + a.box.w * 0.62, u, i) : '') })).filter((p) => p.body),
    [sky, areas],
  );
  const mist = useMemo(() => areas.map((a, i) => ({ box: grow(a.box, 50), body: mistSvg(sky, a, u, i) })).filter((p) => p.body), [sky, areas]);
  const glitter = useMemo(() => (snowy ? geom.outdoor.map((pts) => [sparklePoints(pts, u, 0), sparklePoints(pts, u, 1)]) : []), [snowy, geom]);

  // Particles and rings depend on the weather only, so the clock doesn't restart them.
  const kind = `${sky.weather}-${sky.warm * sky.day > 0.3 ? 'low' : 'high'}`;
  const layers = useMemo(() => particleLayers(sky, u), [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const rings = useMemo(() => ripples(sky, geom, u), [sky.wet, geom]); // eslint-disable-line react-hooks/exhaustive-deps
  const nightOut = sky.night > 0.6;
  const flies = useMemo(() => fireflies(sky, geom, u), [sky.weather, nightOut, geom]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ground and the house layer move like the map: about its center, twist, then pan, then
  // zoom. What they uncover at the screen's edges is the screen's black, like the dark beyond.
  const follow = {
    ...FILL,
    transformOrigin: `${mapBox.x + mapBox.w / 2}px ${mapBox.y + mapBox.h / 2}px 0px`,
    transform: [{ rotate: `${twist}deg` }, { translateX: view?.x ?? 0 }, { translateY: view?.y ?? 0 }, { scale: view?.zoom ?? 1 }],
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={follow}>
        <SvgXml xml={ground} width={width} height={height} style={StyleSheet.absoluteFill} />
      </View>
      {layers.map((l, i) => (
        <Particles key={`${kind}-${i}`} layer={l} width={width} height={height} active={active} />
      ))}
      {fogHigh !== '' && (
        <Drift active={active} range={-16} ms={26000} style={FILL}>
          <SvgXml xml={svg(width, height, fogHigh)} width={width} height={height} />
        </Drift>
      )}
      <View style={follow}>
        <SvgXml xml={house} width={width} height={height} style={StyleSheet.absoluteFill} />
        {glitter.map(([a, b], i) => (
          <View key={i} style={StyleSheet.absoluteFill}>
            <Dots points={a} />
            <Twinkle active={active} ms={1800}>
              <Dots points={b} />
            </Twinkle>
          </View>
        ))}
        {puddles.map((p, i) => (
          <Pulse key={`p${i}`} active={active} ms={2200} min={0.65} box={p.box}>
            <SvgXml xml={svgBox(p.box, p.body)} width={p.box.w} height={p.box.h} />
          </Pulse>
        ))}
        {mist.map((p, i) => (
          <Pulse key={`m${i}`} active={active} ms={9000} min={0.55} box={p.box}>
            <SvgXml xml={svgBox(p.box, p.body)} width={p.box.w} height={p.box.h} />
          </Pulse>
        ))}
        {fx.splashes.map((d, i) => (
          <Splash key={`s${i}`} x={d.x} y={d.y} ms={d.ms} phase={d.phase} active={active} />
        ))}
        {fx.drips.map((d, i) => (
          <Drip key={`d${i}`} x={d.x} y={d.y} nx={d.nx} ny={d.ny} ms={d.ms} phase={d.phase} active={active} />
        ))}
        {fx.settle.map((d, i) => (
          <Settle key={`f${i}`} x={d.x} y={d.y} ms={d.ms} phase={d.phase} active={active} />
        ))}
        {fx.leaves.map((d, i) => (
          <Leaf key={`l${i}`} x={d.x} y={d.y} span={d.span} color={d.color} ms={d.ms} phase={d.phase} active={active} />
        ))}
        {fx.moths.map((d, i) => (
          <Moth key={`o${i}`} x={d.x} y={d.y} r={d.r} dir={d.dir} ms={d.ms} phase={d.phase} active={active} />
        ))}
        {sky.wet && geom.outdoorLights.map((l, i) => <Glints key={i} x={l.x} y={l.y} r={l.r} color={l.color} storm={sky.weather === 'storm'} active={active} />)}
        {rings.map((r, i) => (
          <Ripple key={`${kind}-${i}`} x={r.x} y={r.y} ms={r.ms} phase={r.phase} active={active} />
        ))}
      </View>
      {flies.length > 0 && (
        <View style={follow}>
          {flies.map((f, i) => (
            <Firefly key={i} x={f.x} y={f.y} phase={f.phase} active={active} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Over the map: a fog veil crossing the house, and lightning lighting everything. */
export function OutsideFront({ sky, active }: { sky: Sky; active: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {sky.weather === 'fog' && <View style={[StyleSheet.absoluteFill, { backgroundColor: rgba(sky.fog, 0.1) }]} />}
      {sky.weather === 'storm' && <Lightning active={active} />}
    </View>
  );
}

const kindOf = (sky: Sky) => `${sky.weather}-${sky.night > 0.6 ? 'night' : 'day'}`;
const grow = (b: AreaBox, m: number): AreaBox => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });

/** Gently pulsing opacity (puddles holding the lights, mist breathing), placed at `box`. */
function Pulse({ active, ms, min, box, children }: { active: boolean; ms: number; min: number; box: AreaBox; children: ReactNode }) {
  const t = useLoop(
    active,
    (v) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: min, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    1,
  );
  return <Animated.View style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, opacity: t }}>{children}</Animated.View>;
}

/** A loop starting part-way through (`phase`), so neighbours don't move together. */
function usePhasedLoop(active: boolean, ms: number, phase: number, easing = Easing.linear) {
  return useLoop(active, (v) => Animated.sequence([Animated.delay(phase * ms), Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing, useNativeDriver: true }))]));
}

/** A drop landing on the paving: a bright point, then a crown opening. */
function Splash({ x, y, ms, phase, active }: { x: number; y: number; ms: number; phase: number; active: boolean }) {
  const t = usePhasedLoop(active, ms, phase);
  return (
    <>
      <Animated.View
        style={{
          position: 'absolute',
          left: x - 6,
          top: y - 3,
          width: 12,
          height: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: 'rgba(214,228,248,0.85)',
          opacity: t.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1.6] }) }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: x - 1,
          top: y - 1,
          width: 2,
          height: 2,
          borderRadius: 1,
          backgroundColor: 'rgba(236,244,255,0.95)',
          opacity: t.interpolate({ inputRange: [0, 0.22, 1], outputRange: [1, 0, 0] }),
        }}
      />
    </>
  );
}

/** A drop gathering at the eave, falling, and landing with a ring. */
function Drip({ x, y, nx, ny, ms, phase, active }: { x: number; y: number; nx: number; ny: number; ms: number; phase: number; active: boolean }) {
  const t = usePhasedLoop(active, ms, phase, Easing.in(Easing.quad));
  const fall = (k: number) => t.interpolate({ inputRange: [0, 0.55, 0.64, 1], outputRange: [0, 0, 9 * k, 9 * k] });
  return (
    <>
      <Animated.View
        style={{
          position: 'absolute',
          left: x - 1.2,
          top: y - 1.6,
          width: 2.4,
          height: 3.2,
          borderRadius: 1.2,
          backgroundColor: 'rgba(214,230,250,0.95)',
          boxShadow: '0 0 3px 1px rgba(180,205,240,0.4)',
          opacity: t.interpolate({ inputRange: [0, 0.55, 0.64, 0.66, 1], outputRange: [0.3, 1, 1, 0, 0] }),
          transform: [{ translateX: fall(nx) }, { translateY: fall(ny) }, { scale: t.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.4, 1, 0.9] }) }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: x + 9 * nx - 6,
          top: y + 9 * ny - 3,
          width: 12,
          height: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: 'rgba(214,228,248,0.8)',
          opacity: t.interpolate({ inputRange: [0, 0.63, 0.66, 1], outputRange: [0, 0, 1, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 0.63, 0.66, 1], outputRange: [0.1, 0.1, 0.3, 1.5] }) }],
        }}
      />
    </>
  );
}

/** A flake reaching the snow-covered paving: it slows down, settles and melts in. */
function Settle({ x, y, ms, phase, active }: { x: number; y: number; ms: number; phase: number; active: boolean }) {
  const t = usePhasedLoop(active, ms, phase);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - 1.3,
        top: y - 1.3,
        width: 2.6,
        height: 2.6,
        borderRadius: 1.3,
        backgroundColor: 'rgba(250,250,255,0.95)',
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.62, 1], outputRange: [0, 0.95, 0.95, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 0.62, 1], outputRange: [5, 0, 0], easing: Easing.out(Easing.quad) }) },
          { translateY: t.interpolate({ inputRange: [0, 0.62, 1], outputRange: [-30, 0, 0], easing: Easing.out(Easing.quad) }) },
        ],
      }}
    />
  );
}

/** An autumn leaf skittering across, tumbling as it goes. */
function Leaf({ x, y, span, color, ms, phase, active }: { x: number; y: number; span: number; color: string; ms: number; phase: number; active: boolean }) {
  const t = usePhasedLoop(active, ms, phase);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - 3.5,
        top: y - 2,
        width: 7,
        height: 4,
        borderTopLeftRadius: 5,
        borderBottomRightRadius: 5,
        backgroundColor: color,
        opacity: t.interpolate({ inputRange: [0, 0.08, 0.92, 1], outputRange: [0, 0.95, 0.95, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 0.45, 0.55, 1], outputRange: [0, span * 0.46, span * 0.54, span] }) },
          { translateY: t.interpolate({ inputRange: [0, 0.45, 0.55, 1], outputRange: [0, -7, -5, 5] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '420deg'] }) },
        ],
      }}
    />
  );
}

/** A moth circling a lit lamp. */
function Moth({ x, y, r, dir, ms, phase, active }: { x: number; y: number; r: number; dir: 1 | -1; ms: number; phase: number; active: boolean }) {
  const t = usePhasedLoop(active, ms, phase);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: 2 * r,
        height: 2 * r,
        transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${dir * 360}deg`] }) }],
      }}
    >
      <View style={{ position: 'absolute', left: 2 * r - 1.2, top: r - 1.2, width: 2.4, height: 2.4, borderRadius: 1.2, backgroundColor: 'rgba(250,240,220,0.9)', boxShadow: '0 0 4px 1px rgba(255,220,170,0.6)' }} />
    </Animated.View>
  );
}

function offset(g: HouseGeom, dx: number, dy: number): HouseGeom {
  const m = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...g,
    indoor: g.indoor.map((r) => r.map(m)),
    outdoor: g.outdoor.map((r) => r.map(m)),
    box: g.box && { ...g.box, x: g.box.x + dx, y: g.box.y + dy },
    outdoorLights: g.outdoorLights.map((l) => ({ ...l, ...m(l), beads: l.beads.map(m) })),
  };
}

/** Runs `make()` while active. */
function useLoop(active: boolean, make: (v: Animated.Value) => Animated.CompositeAnimation, initial = 0) {
  const [v] = useState(() => new Animated.Value(initial));
  useEffect(() => {
    if (!active) return;
    const a = make(v);
    a.start();
    return () => a.stop();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/**
 * A particle layer: its tile repeated over a sheet turned by the layer's slant and big enough to
 * cover the screen, sliding one tile along its own vertical per step. Seamless and cheap: the
 * views never change, only the sheet's transform.
 */
function Particles({ layer, width, height, active }: { layer: ParticleLayer; width: number; height: number; active: boolean }) {
  const step = layer.loopMs / Math.abs(layer.tilesPerLoop);
  const t = useLoop(active, (v) => Animated.loop(Animated.timing(v, { toValue: 1, duration: step, easing: Easing.linear, useNativeDriver: true })));
  const a = (Math.abs(layer.angle) * Math.PI) / 180;
  const sheetW = width * Math.cos(a) + height * Math.sin(a) + 2 * layer.tileW;
  const sheetH = width * Math.sin(a) + height * Math.cos(a) + 2 * layer.tileH;
  const cols = Math.ceil(sheetW / layer.tileW);
  const rows = Math.ceil(sheetH / layer.tileH) + 1;
  const dots = useMemo(() => {
    const out: ReactNode[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        layer.particles.forEach((p, i) => {
          out.push(
            <View
              key={`${r}-${c}-${i}`}
              style={{
                position: 'absolute',
                left: c * layer.tileW + p.x,
                top: (r - 1) * layer.tileH + p.y,
                width: p.w,
                height: p.h,
                borderRadius: p.w / 2,
                backgroundColor: p.color,
                boxShadow: p.glow ? `0 0 ${p.w * 3}px ${p.w}px ${p.glow}` : undefined,
              }}
            />,
          );
        });
      }
    }
    return out;
  }, [layer, rows, cols]);
  const dir = layer.tilesPerLoop > 0 ? 1 : -1;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: (width - sheetW) / 2,
        top: (height - sheetH) / 2,
        width: sheetW,
        height: sheetH,
        transform: [{ rotate: `${layer.angle}deg` }, { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, dir * layer.tileH] }) }],
      }}
    >
      {dots}
    </Animated.View>
  );
}

/** Slow back-and-forth drift (clouds, fog). */
function Drift({ active, range, ms, style, children }: { active: boolean; range: number; ms: number; style: object; children: ReactNode }) {
  const t = useLoop(active, (v) =>
    Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ),
  );
  return <Animated.View style={[{ position: 'absolute', top: 0 }, style, { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-range, range] }) }] }]}>{children}</Animated.View>;
}

/** Fades in and out (stars, glitter). */
function Twinkle({ active, ms, children }: { active: boolean; ms: number; children: ReactNode }) {
  const t = useLoop(
    active,
    (v) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 0.2, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    1,
  );
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity: t }]}>{children}</Animated.View>;
}

function Dots({ points }: { points: Pt[] }) {
  return (
    <>
      {points.map((p, i) => (
        <View
          key={i}
          style={{ position: 'absolute', left: p.x - 0.8, top: p.y - 0.8, width: 1.6, height: 1.6, borderRadius: 0.8, backgroundColor: 'rgba(255,255,255,0.95)', boxShadow: '0 0 3px 1px rgba(255,255,255,0.5)' }}
        />
      ))}
    </>
  );
}

/** A rain ring opening on the ground or an outdoor floor. */
function Ripple({ x, y, ms, phase, active }: { x: number; y: number; ms: number; phase: number; active: boolean }) {
  const t = useLoop(active, (v) =>
    Animated.sequence([Animated.delay(phase * ms), Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: true }))]),
  );
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - 7,
        top: y - 3.5,
        width: 14,
        height: 7,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: 'rgba(206,218,240,0.8)',
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.7] }) }],
      }}
    />
  );
}

/** Rain caught in an outdoor light's pool: bright streaks only inside the light. */
function Glints({ x, y, r, color, storm, active }: { x: number; y: number; r: number; color: string; storm: boolean; active: boolean }) {
  const layer = useMemo<ParticleLayer>(
    () => ({
      tileW: 24,
      tileH: 40,
      angle: storm ? 22 : 14,
      particles: [
        { x: 4, y: 2, w: 1, h: 11, color },
        { x: 15, y: 20, w: 1, h: 11, color },
      ],
      tilesPerLoop: 2,
      loopMs: storm ? 300 : 450,
    }),
    [color, storm],
  );
  return (
    <View style={{ position: 'absolute', left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: r, overflow: 'hidden', opacity: 0.8 }}>
      <Particles layer={layer} width={2 * r} height={2 * r} active={active} />
    </View>
  );
}

/** A firefly wandering on a small loop, glowing on and off. */
function Firefly({ x, y, phase, active }: { x: number; y: number; phase: number; active: boolean }) {
  const ms = 5000 + phase * 3000;
  const t = useLoop(active, (v) =>
    Animated.sequence([Animated.delay(phase * ms), Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }))]),
  );
  const at = [0, 0.25, 0.5, 0.75, 1];
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - 6,
        top: y - 6,
        width: 12,
        height: 12,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: t.interpolate({ inputRange: at, outputRange: [0.15, 1, 0.3, 0.9, 0.15] }),
        transform: [
          { translateX: t.interpolate({ inputRange: at, outputRange: [0, 10, -6, -12, 0] }) },
          { translateY: t.interpolate({ inputRange: at, outputRange: [0, -8, -15, -4, 0] }) },
        ],
      }}
    >
      <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(240,248,170,0.95)', boxShadow: '0 0 8px 3px rgba(226,240,140,0.55)' }} />
    </Animated.View>
  );
}

/** A double lightning flash every few seconds. */
function Lightning({ active }: { active: boolean }) {
  const t = useLoop(active, (v) =>
    Animated.loop(
      Animated.sequence([
        Animated.delay(5600),
        Animated.timing(v, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.2, duration: 90, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.85, duration: 90, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]),
    ),
  );
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(214,222,255,0.42)', opacity: t }]} />;
}
