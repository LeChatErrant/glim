import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, Polygon, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { DiscoveredBridge } from '../lib/hue/bridge';
import type { Light, Room } from '../lib/hue/client';
import type { Plan } from '../lib/map/map';
import { IconButton } from './controls';
import { FloorPlan } from './FloorPlan';
import { Display, Label } from './text';
import { color, font, hairline } from './theme';

// Pieces of the onboarding flow (Nocturne canvas, "Onboarding" page).

/** Back button, STEP N OF M, and the segmented progress line. */
export function StepHeader({ step, of, onBack }: { step: number; of: number; onBack?: () => void }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 40 }}>
        {onBack ? <IconButton icon="back" label="Back" onPress={onBack} /> : <View style={{ width: 40 }} />}
        <Label tone="label">{`Step ${step} of ${of}`}</Label>
        <View style={{ width: 40 }} />
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Setup progress"
        accessibilityValue={{ min: 1, max: of, now: step }}
        style={{ flexDirection: 'row', gap: 4, marginTop: 14 }}
      >
        {Array.from({ length: of }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 2,
              borderRadius: 1,
              backgroundColor: i + 1 === step ? color.champagne : i + 1 < step ? 'rgba(233,207,159,0.5)' : hairline(0.12),
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** Small spaced-capitals status line with a dot, e.g. "2 FOUND". */
export function StatusLine({ children, dot = color.champagne, glow }: { children: ReactNode; dot?: string; glow?: boolean }) {
  return (
    <View accessibilityRole="text" style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dot, boxShadow: glow ? `0 0 6px 2px ${dot}80` : undefined }} />
      <Label size={9}>{children}</Label>
    </View>
  );
}

const RADAR_ANGLES = [35, 160, 250, 320, 100, 200];

/** The search radar: rings around the phone, a sweeping beam while searching, one dot per bridge. */
export function Radar({ bridges, searching }: { bridges: DiscoveredBridge[]; searching: boolean }) {
  const [{ spin, rotate }] = useState(() => {
    const v = new Animated.Value(0);
    return { spin: v, rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) };
  });
  useEffect(() => {
    if (!searching) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [searching, spin]);

  const ready = bridges.filter((b) => b.reachable).length;
  const label = searching
    ? 'Searching for bridges'
    : `${bridges.length} found${bridges.length > ready ? `, ${bridges.length - ready} not responding` : ''}`;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ height: 200, alignItems: 'center' }}>
      <Animated.View style={{ position: 'absolute', top: 4, width: 192, height: 192, transform: [{ rotate }] }}>
        <Svg width={192} height={192}>
          {/* Beam pointing up-right, with a faint trailing fan. */}
          <Path d="M96 96 L96 0 A96 96 0 0 1 163.9 28.1 Z" fill={color.champagne} fillOpacity={0.07} />
          <Line x1={96} y1={96} x2={163.9} y2={28.1} stroke={color.champagne} strokeOpacity={0.45} strokeWidth={1} />
        </Svg>
      </Animated.View>
      <Svg width={240} height={200} style={{ position: 'absolute' }}>
        {[24, 48, 72, 96].map((r, i) => (
          <Circle key={r} cx={120} cy={100} r={r} fill="none" stroke={color.champagne} strokeOpacity={[0.55, 0.32, 0.18, 0.09][i]} strokeWidth={1} />
        ))}
        <Rect x={110} y={90} width={20} height={20} rx={5.5} fill={color.ground} stroke={color.ivory} strokeWidth={1.2} />
        <Circle cx={120} cy={100} r={4} fill="none" stroke={color.champagne} strokeWidth={1.2} />
        {bridges.map((b, i) => {
          const a = (RADAR_ANGLES[i % RADAR_ANGLES.length] * Math.PI) / 180;
          const r = b.reachable ? 72 : 96;
          const x = 120 + r * Math.cos(a);
          const y = 100 + r * Math.sin(a);
          const octet = `.${b.ip.split('.').pop()}`;
          const left = x > 120;
          return (
            <G key={b.id}>
              {b.reachable ? (
                <>
                  <Circle cx={x} cy={y} r={10} fill={color.champagne} opacity={0.18} />
                  <Circle cx={x} cy={y} r={6} fill="none" stroke={color.jewelRing} strokeWidth={1} />
                  <Circle cx={x} cy={y} r={3.5} fill={color.champagne} />
                </>
              ) : (
                <Circle cx={x} cy={y} r={5} fill="none" stroke={color.warning} strokeWidth={1} strokeDasharray="2 2" />
              )}
              <SvgText
                x={left ? x + 10 : x - 10}
                y={y + 16}
                textAnchor={left ? 'start' : 'end'}
                fill={b.reachable ? color.secondary : color.warning}
                fontSize={9}
                fontFamily={font.ui}
                letterSpacing={0.8}
              >
                {octet}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const DIAL = 290;
const RING = 140;
const RING_LEN = 2 * Math.PI * RING;

/**
 * The bridge seen from above, its round button lit, inside a countdown ring.
 * `left` is the fraction of the pairing window remaining (0–1).
 */
export function LinkDial({ left, seconds, phase }: { left: number; seconds: number; phase: 'waiting' | 'success' | 'timeout' | 'error' }) {
  const c = DIAL / 2;
  const frac = phase === 'success' ? 1 : Math.max(0, Math.min(1, left));
  const end = -Math.PI / 2 + frac * 2 * Math.PI;
  const lit = phase !== 'timeout' && phase !== 'error';
  const label =
    phase === 'success'
      ? 'Hue bridge connected.'
      : lit
        ? `Hue bridge seen from above with its round button lit. ${seconds} seconds left.`
        : 'Hue bridge seen from above. Time ran out.';
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: DIAL, height: DIAL, alignSelf: 'center' }}>
      <Svg width={DIAL} height={DIAL}>
        <Defs>
          <RadialGradient id="lkBtn" cx="50%" cy="42%" r="62%">
            <Stop offset="0" stopColor={lit ? '#FFF8EA' : '#6E675D'} />
            <Stop offset="0.55" stopColor={lit ? '#EFD8AC' : '#4A453E'} />
            <Stop offset="1" stopColor={lit ? '#D6B880' : '#34312C'} />
          </RadialGradient>
          <RadialGradient id="lkHalo" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color.champagne} stopOpacity={phase === 'success' ? 0.8 : 0.55} />
            <Stop offset="0.48" stopColor={color.champagne} stopOpacity={0.16} />
            <Stop offset="1" stopColor={color.champagne} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={131} fill="none" stroke={hairline(0.14)} strokeWidth={4} strokeDasharray="1 26.44" transform={`rotate(-90 ${c} ${c})`} />
        <Circle cx={c} cy={c} r={RING} fill="none" stroke={hairline(0.1)} strokeWidth={1.5} />
        {frac > 0 && (
          <>
            <Circle
              cx={c}
              cy={c}
              r={RING}
              fill="none"
              stroke={color.champagne}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={`${frac * RING_LEN} ${RING_LEN}`}
              transform={`rotate(-90 ${c} ${c})`}
            />
            {phase === 'waiting' && (
              <>
                <Circle cx={c + RING * Math.cos(end)} cy={c + RING * Math.sin(end)} r={8} fill={color.champagne} opacity={0.2} />
                <Circle cx={c + RING * Math.cos(end)} cy={c + RING * Math.sin(end)} r={3} fill={color.champagne} />
              </>
            )}
          </>
        )}
        <Rect x={59} y={59} width={172} height={172} rx={42} fill={color.card} stroke={hairline(0.26)} strokeWidth={1} />
        <Rect x={68} y={68} width={154} height={154} rx={35} fill="none" stroke={hairline(0.07)} strokeWidth={1} />
        {lit && <Circle cx={c} cy={c} r={76} fill="url(#lkHalo)" />}
        <Circle cx={c} cy={c} r={47} fill="none" stroke={lit ? color.champagne : hairline(0.2)} strokeOpacity={lit ? 0.45 : 1} strokeWidth={1} />
        <Circle cx={c} cy={c} r={36} fill="url(#lkBtn)" />
        <Circle cx={131} cy={208} r={1.8} fill={hairline(0.5)} />
        <Circle cx={145} cy={208} r={1.8} fill={hairline(0.5)} />
        <Circle cx={159} cy={208} r={1.8} fill={phase === 'success' ? color.connected : color.champagne} />
      </Svg>
    </View>
  );
}

// A generic home outline for the widget preview when there's no map yet (not anyone's real home).
const SAMPLE_ROOMS = ['0,0 196,0 196,120 146,120 146,214 0,214', '150,124 196,124 196,214 150,214', '200,0 342,0 342,116 296,138 200,138', '200,142 297,142 342,121 342,214 200,214'];
const SAMPLE_LIGHTS = [
  { x: 84, y: 98, c: '#FFC27A' },
  { x: 40, y: 44, c: '#FFD9A0' },
  { x: 250, y: 66, c: '#FF9E6B' },
  { x: 320, y: 40, c: '#8B7BFF' },
  { x: 270, y: 180, c: '#FFE2B8' },
];

/**
 * A home screen with the map widget on it. Shows the real map when there is one, else a sample
 * outline; the caption counts the real lights.
 */
export function WidgetPreview({ plan, lights, rooms, on, total }: { plan: Plan | null; lights: Light[]; rooms: Room[]; on: number; total: number }) {
  const label = total ? `Home screen with the map widget placed, ${on} of ${total} lights on` : 'Home screen with the map widget placed';
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ height: 208, borderRadius: 28, backgroundColor: '#0C0B0A', borderWidth: 1, borderColor: hairline(0.08), overflow: 'hidden', flexDirection: 'row' }}
    >
      <View style={{ position: 'absolute', left: -50, top: -50, width: 300, height: 300 }}>
        <Svg width={300} height={300}>
          <Defs>
            <RadialGradient id="wpGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFB46B" stopOpacity={0.13} />
              <Stop offset="1" stopColor="#FFB46B" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={150} cy={150} r={150} fill="url(#wpGlow)" />
        </Svg>
      </View>
      <View style={{ margin: 14, width: 168, height: 178, padding: 11, borderRadius: 24, backgroundColor: '#070708', borderWidth: 1, borderColor: hairline(0.1) }}>
        <View pointerEvents="none" style={{ width: 144, height: 126 }}>
          {plan ? (
            <FloorPlan plan={plan} lights={lights} rooms={rooms} width={144} height={126} selectedId={null} onLightPress={noop} onLightDrag={noop} onRoomPress={noop} onLightOpen={noop} />
          ) : (
            <Svg width={144} height={126} viewBox="-10 -10 362 244">
              <G fill="none" stroke={hairline(0.26)} strokeWidth={2.2}>
                {SAMPLE_ROOMS.map((p) => (
                  <Polygon key={p} points={p} />
                ))}
              </G>
              {SAMPLE_LIGHTS.map((l) => (
                <G key={`${l.x},${l.y}`}>
                  <Circle cx={l.x} cy={l.y} r={30} fill={l.c} opacity={0.18} />
                  <Circle cx={l.x} cy={l.y} r={8} fill={l.c} />
                </G>
              ))}
            </Svg>
          )}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
          <Display size={15}>Home</Display>
          {total > 0 && <Label size={8.5}>{`${on} of ${total} on`}</Label>}
        </View>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 46 * 2 + 18, gap: 14, columnGap: 18 }}>
          {[0, 1, 2, 3, 4, 5].map((i) =>
            i === 4 ? (
              <View
                key={i}
                style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: color.ground, borderWidth: 1, borderColor: 'rgba(233,207,159,0.35)', alignItems: 'center', justifyContent: 'center' }}
              >
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFE2B8', boxShadow: '0 0 14px 5px rgba(255,194,122,0.55)' }} />
              </View>
            ) : (
              <View key={i} style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: '#171614' }} />
            ),
          )}
        </View>
      </View>
    </View>
  );
}

function noop() {}
