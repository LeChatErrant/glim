import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { Light } from '../lib/hue/client';
import { fitPlan, type Plan, type PlanView } from '../lib/map/map';
import {
  cloudShadowsSvg,
  fireflies,
  fogSvg,
  groundSvg,
  houseGeom,
  houseSvg,
  particleLayers,
  ripples,
  skyCloudsSvg,
  skySvg,
  sparklePoints,
  stars,
  svg,
  vignetteSvg,
  type HouseGeom,
  type ParticleLayer,
  type Pt,
} from '../lib/weather/scene';
import { rgba, type Sky } from '../lib/weather/sky';

// The outside around the map (sky at the top, weather around the house, the dark beyond),
// drawn behind the Map tab. react-native-svg draws each SVG into a bitmap the size of its view,
// so SVG layers stay screen-sized and everything that moves is made of plain views, moved by
// Animated on the native driver.

type Box = { x: number; y: number; w: number; h: number };

type Props = {
  sky: Sky;
  /** The whole screen. */
  width: number;
  height: number;
  /** Height of the sky band at the top. */
  skyH: number;
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
const FILL = { position: 'absolute' as const, left: 0, top: 0, right: 0, bottom: 0 };

export function OutsideBack({ sky, width, height, skyH, plan, lights, mapBox, view, twist = 0, active }: Props) {
  // Screen geometry at the plain fit; the house layer then follows zoom, pan and twist.
  const geom = useMemo(() => offset(houseGeom(plan, fitPlan(plan, mapBox.w, mapBox.h, PAD), lights), mapBox.x, mapBox.y), [plan, mapBox, lights]);

  const ground = useMemo(
    () => svg(width, height, groundSvg(sky, width, height, geom, skyH, u) + cloudShadowsSvg(sky, width, height, u) + fogSvg(sky, width, height, u, 0)),
    [sky, width, height, geom, skyH],
  );
  const house = useMemo(() => svg(width, height, houseSvg(sky, width, geom, skyH, u, false) + vignetteSvg(sky, width, height, geom, skyH, u, 200, 40)), [sky, width, height, geom, skyH]);
  // Taller than the band, so the sun's halo spills over the ground below instead of being cut.
  const skyBoxH = Math.min(height, skyH + 150 * u);
  const skyBand = useMemo(() => (skyH ? svg(width, skyBoxH, skySvg(sky, width, skyH, u)) : ''), [sky, width, skyH, skyBoxH]);
  const clouds = useMemo(() => skyCloudsSvg(sky, width + 60, skyH, u), [sky, width, skyH]);
  const fogHigh = useMemo(() => fogSvg(sky, width, height, u, 1), [sky, width, height]);
  const starry = useMemo(() => stars(sky, width, height, u), [sky, width, height]);
  const snowy = sky.weather === 'snow';
  const glitter = useMemo(() => (snowy ? geom.outdoor.map((pts) => [sparklePoints(pts, u, 0), sparklePoints(pts, u, 1)]) : []), [snowy, geom]);

  // Particles and rings depend on the weather only, so the clock doesn't restart them.
  const kind = `${sky.weather}-${sky.warm * sky.day > 0.3 ? 'low' : 'high'}`;
  const layers = useMemo(() => particleLayers(sky, u), [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const rings = useMemo(() => ripples(sky, geom, u), [sky.wet, geom]); // eslint-disable-line react-hooks/exhaustive-deps
  const nightOut = sky.night > 0.6;
  const flies = useMemo(() => fireflies(sky, geom, u), [sky.weather, nightOut, geom]); // eslint-disable-line react-hooks/exhaustive-deps

  // The house layer moves like the map: about the map's center, twist, then pan, then zoom.
  const follow = {
    ...FILL,
    transformOrigin: `${mapBox.x + mapBox.w / 2}px ${mapBox.y + mapBox.h / 2}px 0px`,
    transform: [{ rotate: `${twist}deg` }, { translateX: view?.x ?? 0 }, { translateY: view?.y ?? 0 }, { scale: view?.zoom ?? 1 }],
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <SvgXml xml={ground} width={width} height={height} style={StyleSheet.absoluteFill} />
      {layers.map((l, i) => (
        <Particles key={`${kind}-${i}`} layer={l} width={width} height={height} active={active} />
      ))}
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
        {sky.wet && geom.outdoorLights.map((l, i) => <Glints key={i} x={l.x} y={l.y} r={l.r} color={l.color} storm={sky.weather === 'storm'} active={active} />)}
        {rings.map((r, i) => (
          <Ripple key={`${kind}-${i}`} x={r.x} y={r.y} ms={r.ms} phase={r.phase} active={active} />
        ))}
      </View>
      {skyBand !== '' && <SvgXml xml={skyBand} width={width} height={skyBoxH} style={{ position: 'absolute', left: 0, top: 0 }} />}
      {clouds !== '' && (
        <Drift active={active} range={18} ms={22000} style={{ left: -30, width: width + 60, height: skyH }}>
          <SvgXml xml={svg(width + 60, skyH, clouds)} width={width + 60} height={skyH} />
        </Drift>
      )}
      {fogHigh !== '' && (
        <Drift active={active} range={-16} ms={26000} style={FILL}>
          <SvgXml xml={svg(width, height, fogHigh)} width={width} height={height} />
        </Drift>
      )}
      {starry.length > 0 && (
        <View style={StyleSheet.absoluteFill}>
          <Stars list={starry.filter((s) => s.group === 0)} />
          <Twinkle active={active} ms={2600}>
            <Stars list={starry.filter((s) => s.group === 1)} />
          </Twinkle>
        </View>
      )}
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

function Stars({ list }: { list: ReturnType<typeof stars> }) {
  return (
    <>
      {list.map((s, i) => {
        const d = s.big ? 2.2 : 1.2;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: s.x - d / 2,
              top: s.y - d / 2,
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: rgba([246, 240, 228], s.alpha),
              boxShadow: s.big ? `0 0 6px 1px ${rgba([200, 210, 255], s.alpha * 0.6)}` : undefined,
            }}
          />
        );
      })}
    </>
  );
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
