import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polygon, Polyline, Rect } from 'react-native-svg';

import type { FloorPoint } from '../../lib/map/map';
import { PillButton } from '../controls';
import { Icon, type IconName } from '../icons';
import { Display, Label, Txt } from '../text';
import { color, hairline } from '../theme';

/** Ivory drawn on the camera feed (a touch warmer than the UI ivory, as in the design). */
export const AR_INK = '#F3E3C3';

/** Dark fades behind the top and bottom UI, so text stays readable over any room. */
export function Fades({ top = 230, bottom = 0 }: { top?: number; bottom?: number }) {
  return (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: top, experimental_backgroundImage: 'linear-gradient(rgba(5,5,6,0.9), rgba(5,5,6,0))' }} />
      {bottom > 0 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: bottom, experimental_backgroundImage: 'linear-gradient(rgba(5,5,6,0), rgba(5,5,6,0.94) 55%)' }} />
      )}
    </>
  );
}

/** Round button over the camera. */
export function CamButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: hairline(0.22),
        backgroundColor: 'rgba(5,5,6,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={15} stroke={1.7} />
    </Pressable>
  );
}

/** Top bar: exit, a step label, and an optional right button. */
export function ScanTop({ label, onExit, right }: { label: string; onExit: () => void; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: 'absolute', top: insets.top + 14, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <CamButton icon="close" label="Leave the scan" onPress={onExit} />
      <Label tone="label" numberOfLines={1} style={{ flexShrink: 1, marginHorizontal: 12 }}>
        {label}
      </Label>
      {right ?? <View style={{ width: 40 }} />}
    </View>
  );
}

/** The big instruction at the top left: "Find the / next corner". */
export function ScanTitle({ first, accent, sub, width = 230 }: { first: string; accent: string; sub?: string; width?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 76, left: 24, width, gap: 10 }}>
      <Display size={32} style={{ lineHeight: 35 }}>
        {first}
        {'\n'}
        <Display size={32} style={{ color: color.champagne, lineHeight: 35 }}>
          {accent}
        </Display>
      </Display>
      {sub && (
        <Label tone="secondary" style={{ letterSpacing: 2 }}>
          {sub}
        </Label>
      )}
    </View>
  );
}

/** Bottom sheet over the camera (name the room, place the lights, what next). */
export function Sheet({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: color.sheet,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderTopWidth: 1,
        borderColor: hairline(0.1),
        paddingTop: 20,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 22,
      }}
    >
      <View style={{ position: 'absolute', top: 10, alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: hairline(0.2) }} />
      {children}
    </View>
  );
}

/** The round shutter-like button: add a corner, place a light, match a corner. */
export function Shutter({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 84,
        height: 84,
        borderRadius: 42,
        borderWidth: 1,
        borderColor: 'rgba(233,207,159,0.7)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: AR_INK, alignItems: 'center', justifyContent: 'center', boxShadow: disabled ? undefined : '0 0 30px rgba(243,227,195,0.35)' }}>
        <Icon name={icon} size={22} tint={color.onChampagne} stroke={1.4} />
      </View>
    </Pressable>
  );
}

/** Plain text button for the sides of the shutter ("Undo", "Finish room"). */
export function SideButton({ title, icon, onPress, disabled, align = 'left' }: { title: string; icon?: IconName; onPress: () => void; disabled?: boolean; align?: 'left' | 'right' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({ width: 104, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : 'flex-end', gap: 8, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}
    >
      {icon && <Icon name={icon} size={16} stroke={1.6} />}
      <Txt size={14}>{title}</Txt>
    </Pressable>
  );
}

export type MiniOutline = { points: FloorPoint[]; ink: string; open?: boolean; dashed?: boolean };
export type MiniDot = { p: FloorPoint; ink: string; kind: 'corner' | 'light' | 'target' };

/** Live 2D plan in a dark circle, with the user's position and direction when known. */
export function MiniMap({ outlines, dots, camera, size = 100 }: { outlines: MiniOutline[]; dots: MiniDot[]; camera?: { p: FloorPoint; heading?: number }; size?: number }) {
  const insets = useSafeAreaInsets();
  const pts = [...outlines.flatMap((o) => o.points), ...dots.map((d) => d.p), ...(camera ? [camera.p] : [])];
  if (!pts.length) return null;
  const S = size * 0.62;
  const minX = Math.min(...pts.map((p) => p.x)) - 0.3;
  const maxX = Math.max(...pts.map((p) => p.x)) + 0.3;
  const minZ = Math.min(...pts.map((p) => p.z)) - 0.3;
  const maxZ = Math.max(...pts.map((p) => p.z)) + 0.3;
  const span = Math.max(maxX - minX, maxZ - minZ, 3);
  const scale = S / span;
  const ox = (size - (maxX - minX) * scale) / 2;
  const oz = (size - (maxZ - minZ) * scale) / 2;
  const X = (x: number) => ox + (x - minX) * scale;
  const Y = (z: number) => oz + (z - minZ) * scale;
  const str = (ps: FloorPoint[]) => ps.map((p) => `${X(p.x).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ');
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', right: 20, top: insets.top + 72, width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(5,5,6,0.82)', borderWidth: 1, borderColor: hairline(0.18), overflow: 'hidden' }}
    >
      <Svg width={size} height={size}>
        {outlines.map((o, i) =>
          o.open ? (
            <Polyline key={i} points={str(o.points)} fill="none" stroke={o.ink} strokeWidth={1.5} strokeLinejoin="round" />
          ) : (
            <Polygon key={i} points={str(o.points)} fill="rgba(243,227,195,0.05)" stroke={o.ink} strokeWidth={1.2} strokeDasharray={o.dashed ? '2 3' : undefined} strokeLinejoin="round" />
          ),
        )}
        {dots.map((d, i) =>
          d.kind === 'corner' ? (
            <Rect key={i} x={X(d.p.x) - 2.5} y={Y(d.p.z) - 2.5} width={5} height={5} fill={d.ink} transform={`rotate(45 ${X(d.p.x)} ${Y(d.p.z)})`} />
          ) : d.kind === 'target' ? (
            <Circle key={i} cx={X(d.p.x)} cy={Y(d.p.z)} r={5} fill="none" stroke={d.ink} strokeWidth={1.5} />
          ) : (
            <Circle key={i} cx={X(d.p.x)} cy={Y(d.p.z)} r={2.5} fill={d.ink} />
          ),
        )}
        {camera && (
          <>
            {camera.heading !== undefined && (
              <Line
                x1={X(camera.p.x)}
                y1={Y(camera.p.z)}
                x2={X(camera.p.x) + Math.sin(camera.heading) * 11}
                y2={Y(camera.p.z) - Math.cos(camera.heading) * 11}
                stroke={color.champagne}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            )}
            <Circle cx={X(camera.p.x)} cy={Y(camera.p.z)} r={3} fill={color.champagne} />
          </>
        )}
      </Svg>
    </View>
  );
}

/** Before the floor is found: what to do, and tips if it takes a while. */
/** `overSheet`: a sheet covers the bottom, so sit in the middle of the camera view. */
export function FindingFloor({ found, overSheet }: { found: boolean; overSheet?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (found) return;
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [found]);
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 14 }, overSheet ? { top: '36%' } : { bottom: insets.bottom + 48 }]}
    >
      {found ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(5,5,6,0.8)', borderWidth: 1, borderColor: 'rgba(233,207,159,0.45)' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.connected }} />
          <Label tone="champagne">Floor found</Label>
        </View>
      ) : (
        <>
          <Display size={26} style={{ textAlign: 'center', lineHeight: 30 }}>
            Move your phone slowly{'\n'}over the floor
          </Display>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ActivityIndicator size="small" color={color.champagne} />
            <Label tone="secondary">Finding the floor</Label>
          </View>
          {slow && (
            <View style={{ marginTop: 6, padding: 14, borderRadius: 18, backgroundColor: 'rgba(5,5,6,0.84)', borderWidth: 1, borderColor: hairline(0.14), gap: 4, alignSelf: 'stretch' }}>
              <Label tone="label">Taking a while?</Label>
              <Txt size={13} tone="secondary">
                Add more light, or aim at a textured floor. A plain, shiny floor is the hardest.
              </Txt>
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** Tracking lost while walking: the scan pauses until the camera recognizes a known place. */
export function TrackingLost({ reason, kept, onKeep, onSave }: { reason: string; kept: string; onKeep: () => void; onSave: () => void }) {
  const insets = useSafeAreaInsets();
  const hint =
    reason === 'insufficient_light'
      ? 'It got too dark. Turn on a light, then point back at a place you already scanned.'
      : reason === 'excessive_motion'
        ? 'You moved a bit fast. Slow down and point back at a place you already scanned.'
        : reason === 'insufficient_features'
          ? 'The camera sees too little detail. Point back at a place you already scanned.'
          : 'Point your phone back at a place you already scanned. The scan picks up again on its own.';
  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(5,5,6,0.78)', justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: insets.bottom + 28 }}>
      <View style={{ gap: 12, marginBottom: 32 }}>
        <Label tone="label">Scan paused</Label>
        <Display size={34}>We lost track</Display>
        <Txt tone="secondary">{hint}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.connected }} />
          <Txt size={13} tone="secondary">
            {kept}
          </Txt>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <PillButton title="Keep scanning" kind="primary" onPress={onKeep} />
        <PillButton title="Save what I have" onPress={onSave} />
      </View>
    </View>
  );
}

/** A choice row in a sheet: icon, title, one line of help. */
export function ChoiceRow({ icon, title, sub, onPress, disabled }: { icon: IconName; title: string; sub: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, borderTopWidth: 1, borderTopColor: hairline(0.08), opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: hairline(0.16), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} tint={color.champagne} />
      </View>
      <View style={{ flex: 1 }}>
        <Display size={17} weight={400} style={{ lineHeight: 21 }}>
          {title}
        </Display>
        <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
          {sub}
        </Txt>
      </View>
      <Icon name="chevronRight" size={14} tint={color.muted} />
    </Pressable>
  );
}

/** Pill chip used in sheets: champagne when chosen, dashed for "other". */
export function Choice({ label, chosen, dashed, onPress, dot }: { label: string; chosen?: boolean; dashed?: boolean; onPress: () => void; dot?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!chosen }}
      style={({ pressed }) => ({
        height: 44,
        paddingHorizontal: 15,
        borderRadius: 22,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        backgroundColor: chosen ? color.champagne : 'transparent',
        borderWidth: 1,
        borderStyle: dashed && !chosen ? 'dashed' : 'solid',
        borderColor: chosen ? color.champagne : hairline(dashed ? 0.32 : 0.16),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {dot && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot, boxShadow: `0 0 6px 1px ${dot}` }} />}
      <Txt size={14} medium={chosen} style={{ color: chosen ? color.onChampagne : color.ivory, lineHeight: 18 }}>
        {label}
      </Txt>
    </Pressable>
  );
}
