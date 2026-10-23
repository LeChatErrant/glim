import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { hsvHex, KELVIN_MAX, KELVIN_MIN, kelvinTint } from '../lib/hue/color';
import { formatKelvin } from '../lib/palette';
import { Glow, Slider } from './controls';
import { Icon } from './icons';
import { Display, Label } from './text';
import { color, font, hairline } from './theme';

/** Saturation of the colors picked on the hue ring (soft enough to look like light, not paint). */
export const RING_SAT = 0.72;
export const ringColor = (hue: number) => hsvHex(hue, RING_SAT, 1);

// The white dial is a 270° arc open at the bottom: warm at bottom left, cool at bottom right.
const ARC_START = 225;
const ARC_SPAN = 270;
const kelvinAngle = (k: number) => ARC_START + ((k - KELVIN_MIN) / (KELVIN_MAX - KELVIN_MIN)) * ARC_SPAN;

function polar(c: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: c + r * Math.sin(a), y: c - r * Math.cos(a) };
}

function arc(c: number, r: number, from: number, to: number) {
  const a = polar(c, r, from);
  const b = polar(c, r, to);
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 0 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

/**
 * The big round control of the light screen: a hue ring (value = hue in degrees) or a white
 * temperature dial (value = kelvin), with the orb in the middle. Drag anywhere on the ring.
 */
export function Dial({
  mode,
  size,
  value,
  on,
  tint,
  ticks = [],
  label,
  onChange,
  onCommit,
  children,
}: {
  mode: 'hue' | 'white';
  size: number;
  value: number;
  on: boolean;
  /** The color the light shows now: orb and knob. */
  tint: string;
  /** Kelvin presets marked on the white dial. */
  ticks?: number[];
  label: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  children: ReactNode;
}) {
  const k = size / 270;
  const c = size / 2;
  const band = 12 * k;
  const rMid = c - band / 2;
  const orbR = c - 34 * k;
  const [drag, setDrag] = useState<number | null>(null);
  const latest = useRef({ mode, c, orbR, onChange, onCommit });
  useLayoutEffect(() => {
    latest.current = { mode, c, orbR, onChange, onCommit };
  });
  const start = useRef({ x: 0, y: 0 });
  const current = useRef(value);

  // The handlers only read refs when touched, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const valueAt = (x: number, y: number) => {
      const { mode: m, c: mid } = latest.current;
      const deg = ((Math.atan2(x - mid, mid - y) * 180) / Math.PI + 360) % 360;
      if (m === 'hue') return Math.round(deg);
      let rel = (deg - ARC_START + 360) % 360;
      // In the gap at the bottom: snap to the nearest end.
      if (rel > ARC_SPAN) rel = rel - ARC_SPAN < (360 - ARC_SPAN) / 2 ? ARC_SPAN : 0;
      return Math.round((KELVIN_MIN + (rel / ARC_SPAN) * (KELVIN_MAX - KELVIN_MIN)) / 50) * 50;
    };
    const update = (v: number) => {
      if (v === current.current) return;
      current.current = v;
      setDrag(v);
      latest.current.onChange(v);
    };
    return PanResponder.create({
      // The orb itself isn't part of the ring.
      onStartShouldSetPanResponder: (e) => {
        const { c: mid, orbR: r } = latest.current;
        return Math.hypot(e.nativeEvent.locationX - mid, e.nativeEvent.locationY - mid) > r * 0.75;
      },
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        current.current = NaN;
        update(valueAt(start.current.x, start.current.y));
      },
      onPanResponderMove: (_, g) => update(valueAt(start.current.x + g.dx, start.current.y + g.dy)),
      onPanResponderRelease: () => {
        latest.current.onCommit(current.current);
        setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    });
  });

  const shown = drag ?? value;
  const knobAngle = mode === 'hue' ? shown : kelvinAngle(shown);
  const knob = polar(c, rMid, knobAngle);
  const knobTint = mode === 'hue' ? ringColor(shown) : kelvinTint(shown);
  const orbTint = drag === null ? tint : knobTint;
  const segments =
    mode === 'hue'
      ? Array.from({ length: 120 }, (_, i) => ({ from: i * 3, to: i * 3 + 3.6, tint: ringColor(i * 3 + 1.5) }))
      : Array.from({ length: 90 }, (_, i) => ({
          from: ARC_START + i * 3,
          to: ARC_START + Math.min(ARC_SPAN, i * 3 + 3.6),
          tint: kelvinTint(KELVIN_MIN + ((i * 3 + 1.5) / ARC_SPAN) * (KELVIN_MAX - KELVIN_MIN)),
        }));
  const ends = mode === 'white' ? [polar(c, rMid, ARC_START), polar(c, rMid, ARC_START + ARC_SPAN)] : [];

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const up = e.nativeEvent.actionName === 'increment';
        onCommit(mode === 'hue' ? (value + (up ? 15 : 345)) % 360 : Math.max(KELVIN_MIN, Math.min(KELVIN_MAX, value + (up ? 300 : -300))));
      }}
      style={{ width: size, height: size, alignSelf: 'center' }}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
        {on && <Glow tint={orbTint} cx={c} cy={c} rx={orbR * 1.7} alpha={0.32} />}
        <Svg width={size} height={size} style={{ position: 'absolute', opacity: on ? 1 : 0.35 }}>
          {segments.map((s, i) => (
            <Path key={i} d={arc(c, rMid, s.from, s.to)} stroke={s.tint} strokeWidth={band} fill="none" />
          ))}
          {ends.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={band / 2} fill={i ? kelvinTint(KELVIN_MAX) : kelvinTint(KELVIN_MIN)} />
          ))}
          {ticks.map((t) => {
            const p = polar(c, c - 20 * k, kelvinAngle(t));
            const sel = Math.abs(t - shown) < 60;
            return <Circle key={t} cx={p.x} cy={p.y} r={sel ? 2 : 1.5} fill={sel && on ? color.champagne : hairline(0.35)} />;
          })}
        </Svg>
        <Orb size={orbR * 2} left={c - orbR} on={on} tint={orbTint}>
          {children}
        </Orb>
        {mode === 'white' && (
          <>
            <Label size={9} style={{ position: 'absolute', left: 14 * k, top: 240 * k, width: 60 * k, textAlign: 'center' }}>
              {`${formatKelvin(KELVIN_MIN)} K`}
            </Label>
            <Label size={9} style={{ position: 'absolute', left: 196 * k, top: 240 * k, width: 60 * k, textAlign: 'center' }}>
              {`${formatKelvin(KELVIN_MAX)} K`}
            </Label>
          </>
        )}
        <View
          style={{
            position: 'absolute',
            left: knob.x - 13,
            top: knob.y - 13,
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: knobTint,
            borderWidth: 3,
            borderColor: color.thumb,
            boxShadow: '0 0 0 1px rgba(5,5,6,0.6), 0 4px 14px rgba(0,0,0,0.5)',
            opacity: on ? 1 : 0.4,
          }}
        />
      </View>
    </View>
  );
}

/** The glowing ball in the middle of the dial (or alone, for lights without color). */
export function Orb({ size, left, top, on, tint, children }: { size: number; left?: number; top?: number; on: boolean; tint: string; children?: ReactNode }) {
  const r = size / 2;
  const id = 'orb' + tint.replace('#', '');
  return (
    <View
      style={{
        position: left === undefined ? 'relative' : 'absolute',
        left,
        top: top ?? left,
        width: size,
        height: size,
        borderRadius: r,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        ...(on ? null : { backgroundColor: '#121214', borderWidth: 1, borderColor: hairline(0.12) }),
      }}
    >
      {on && (
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Defs>
            <RadialGradient id={id} cx="50%" cy="42%" rx="50%" ry="58%" fx="50%" fy="42%">
              <Stop offset="0" stopColor="#FFF8EE" stopOpacity={1} />
              <Stop offset="0.38" stopColor={tint} stopOpacity={1} />
              <Stop offset="0.72" stopColor={tint} stopOpacity={0.75} />
              <Stop offset="1" stopColor={tint} stopOpacity={0.44} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
        </Svg>
      )}
      {children}
    </View>
  );
}

/** Text tones on the orb: dark on a lit orb, muted on a dark one. */
export const orbInk = (on: boolean) => ({ strong: on ? '#24160B' : color.secondary, soft: on ? '#4A3220' : color.muted });

/** A round color swatch with a soft highlight. */
export function ColorDot({ hex, size = 40, selected, ground = color.ground }: { hex: string; size?: number; selected?: boolean; ground?: string }) {
  const id = 'dot' + hex.replace('#', '');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hex,
        boxShadow: selected ? `0 0 0 3px ${ground}, 0 0 0 4px ${color.champagne}` : undefined,
      }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="40%" rx="50%" ry="50%" fx="50%" fy="40%">
            <Stop offset="0" stopColor="#FFF6E8" stopOpacity={1} />
            <Stop offset="0.45" stopColor={hex} stopOpacity={1} />
            <Stop offset="1" stopColor={hex} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Round power button: champagne when on. */
export function PowerButton({ on, size = 64, onPress, label, glow }: { on: boolean; size?: number; onPress: () => void; label: string; glow?: string }) {
  const ring = size > 70 ? 8 : 6;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
        ...(on
          ? {
              backgroundColor: color.champagne,
              boxShadow: `0 0 0 ${ring}px ${color.ground}, 0 0 0 ${ring + 1}px rgba(233,207,159,0.4)${glow ? `, 0 0 48px 14px ${glow}38` : ''}`,
            }
          : { borderWidth: 1, borderColor: hairline(0.3) }),
      })}
    >
      <Icon name="power" size={size > 70 ? 28 : 22} tint={on ? color.onChampagne : color.ivory} stroke={size > 70 ? 1.6 : 1.8} />
    </Pressable>
  );
}

/** Underlined spaced-capital tabs (COLOR · WHITE). */
export function ModeTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; title: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
      {tabs.map((t) => {
        const sel = t.id === value;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: sel }}
            onPress={() => onChange(t.id)}
            hitSlop={{ top: 4, bottom: 4, left: 10, right: 10 }}
            style={{ height: 36, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: sel ? color.champagne : 'transparent' }}
          >
            <Label tone={sel ? 'ivory' : 'muted'}>{t.title}</Label>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Big Jost number with a hairline slider under it. Off shows 0. */
export function Brightness({
  value,
  on,
  tint,
  title = 'Brightness',
  big = 60,
  ground = color.ground,
  onChange,
  onCommit,
}: {
  value: number;
  on: boolean;
  tint: string;
  title?: string;
  big?: number;
  ground?: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (on ? value : 0);
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
          <Display size={big} weight={200} style={{ lineHeight: Math.round(big * 1.02), letterSpacing: -0.03 * big, fontVariant: ['tabular-nums'] }}>
            {shown}
          </Display>
          <Display size={big > 50 ? 18 : 16} style={{ color: color.muted, fontFamily: font.display }}>
            %
          </Display>
        </View>
        <Label style={{ paddingBottom: big * 0.16 }}>{title}</Label>
      </View>
      <Slider
        value={drag ?? (on ? value : 1)}
        tint={on || drag !== null ? tint : '#5A5650'}
        thumb={22}
        ground={ground}
        label={title}
        onChange={(v) => {
          setDrag(v);
          onChange(v);
        }}
        onCommit={(v) => {
          setDrag(null);
          onCommit(v);
        }}
      />
    </View>
  );
}

/** Runs at most one call every `ms` (live preview on the real lights without flooding the bridge). */
export function useThrottle(ms = 150) {
  const last = useRef(0);
  return (fn: () => void) => {
    const now = Date.now();
    if (now - last.current > ms) {
      last.current = now;
      fn();
    }
  };
}
