import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { PanResponder, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { Icon, type IconName } from './icons';
import { Label } from './text';
import { color, font, hairline } from './theme';

/** Primary = champagne fill, ghost = hairline outline, text = no frame. */
export function PillButton({
  title,
  onPress,
  kind = 'ghost',
  icon,
  height = 52,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'text';
  icon?: IconName;
  height?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = kind === 'primary' ? color.onChampagne : kind === 'text' ? color.secondary : color.ivory;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          height,
          borderRadius: height / 2,
          paddingHorizontal: kind === 'text' ? 12 : height > 44 ? 26 : 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: kind === 'primary' ? color.champagne : 'transparent',
          borderWidth: kind === 'ghost' ? 1 : 0,
          borderColor: hairline(0.16),
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={14} tint={fg} stroke={1.7} />}
      <Text style={{ color: fg, fontFamily: kind === 'text' ? font.ui : font.uiMedium, fontSize: height > 44 ? 15 : 13 }}>{title}</Text>
    </Pressable>
  );
}

/** Round hairline button with one icon (40px, 48px touch target). */
export function IconButton({ icon, onPress, label, size = 40 }: { icon: IconName; onPress: () => void; label: string; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: hairline(0.16),
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={16} />
    </Pressable>
  );
}

/** Small hairline pill with spaced capitals, e.g. EDIT MAP. */
export function TagButton({ title, icon, onPress }: { title: string; icon?: IconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ height: 44, justifyContent: 'center' }}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            height: 30,
            paddingLeft: icon ? 11 : 13,
            paddingRight: 13,
            borderRadius: 15,
            borderWidth: 1,
            borderColor: hairline(0.16),
            opacity: pressed ? 0.6 : 1,
          }}
        >
          {icon && <Icon name={icon} size={12} tint={color.secondary} stroke={1.6} />}
          <Label size={9} tone="secondary">
            {title}
          </Label>
        </View>
      )}
    </Pressable>
  );
}

export function Switch({ on, onToggle, label, big }: { on: boolean; onToggle: () => void; label: string; big?: boolean }) {
  const W = big ? 52 : 40;
  const H = big ? 30 : 24;
  const K = big ? 22 : 16;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={{ height: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}
    >
      <View style={{ width: W, height: H, borderRadius: H / 2, backgroundColor: on ? color.champagne : color.track }}>
        <View
          style={{
            position: 'absolute',
            top: (H - K) / 2,
            left: on ? W - K - (H - K) / 2 : (H - K) / 2,
            width: K,
            height: K,
            borderRadius: K / 2,
            backgroundColor: on ? color.onChampagne : color.muted,
          }}
        />
      </View>
    </Pressable>
  );
}

/**
 * Hairline slider: 2px track filled with the light's color, ivory thumb.
 * `onChange` fires while dragging, `onCommit` once on release.
 */
export function Slider({
  value,
  tint,
  onChange,
  onCommit,
  label,
  min = 1,
  max = 100,
  thumb = 16,
  ground = color.card,
}: {
  value: number;
  tint: string;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  thumb?: number;
  ground?: string;
}) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const latest = useRef({ width, onChange, onCommit, min, max });
  useLayoutEffect(() => {
    latest.current = { width, onChange, onCommit, min, max };
  });
  const startX = useRef(0);
  const current = useRef(value);

  // The handlers only read refs when touched, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const at = (x: number) => {
      const { width: w, min: lo, max: hi } = latest.current;
      if (!w) return lo;
      return Math.round(lo + Math.max(0, Math.min(1, x / w)) * (hi - lo));
    };
    const update = (v: number) => {
      current.current = v;
      setDrag(v);
      latest.current.onChange?.(v);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        update(at(startX.current));
      },
      onPanResponderMove: (_, g) => update(at(startX.current + g.dx)),
      onPanResponderRelease: () => {
        latest.current.onCommit(current.current);
        setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    });
  });

  const shown = drag ?? value;
  const fill = width ? ((shown - min) / (max - min)) * width : 0;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: shown }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onCommit(Math.max(min, Math.min(max, value + (e.nativeEvent.actionName === 'increment' ? 10 : -10))))}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: 36, justifyContent: 'center' }}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={{ height: 2, borderRadius: 1, backgroundColor: hairline(0.16) }}>
        <View style={{ width: fill, height: 2, borderRadius: 1, backgroundColor: tint }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: fill - thumb / 2,
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          backgroundColor: color.thumb,
          borderWidth: thumb > 18 ? 4 : 3,
          borderColor: ground,
          boxShadow: `0 0 0 1px ${hairline(0.55)}`,
        }}
      />
    </View>
  );
}

export type Connection = 'home' | 'cloud' | 'offline';

/** AT HOME (green dot) / AWAY · VIA CLOUD / OFFLINE. Quiet unless offline. Opens "Control from anywhere". */
export function ConnectionBadge({ state }: { state: Connection }) {
  const dot = state === 'home' ? color.connected : state === 'cloud' ? color.champagne : color.error;
  const text = state === 'home' ? 'At home' : state === 'cloud' ? 'Away · via cloud' : 'Offline';
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/away')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Connection: ${text}. Control from anywhere`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: dot }} />
      <Label tone={state === 'offline' ? 'ivory' : 'secondary'}>{text}</Label>
    </Pressable>
  );
}

/**
 * A soft radial glow (the design's ambient light and card tints). Drawn with SVG so it renders the
 * same everywhere. `alpha` is the center opacity, 0–1.
 */
export function Glow({ tint, cx, cy, rx, ry = rx, alpha, style }: { tint: string; cx: number; cy: number; rx: number; ry?: number; alpha: number; style?: StyleProp<ViewStyle> }) {
  const id = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', left: cx - rx, top: cy - ry, width: rx * 2, height: ry * 2 }, style]}>
      <Svg width={rx * 2} height={ry * 2}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={tint} stopOpacity={alpha} />
            <Stop offset="1" stopColor={tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={rx} cy={ry} rx={rx} ry={ry} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A full-width hairline row separator. */
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: hairline(0.1) }, style]} />;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Label tone="label">{title}</Label>
        {right}
      </View>
      {children}
    </View>
  );
}
