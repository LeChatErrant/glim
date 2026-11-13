import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import type { Snapshot } from '../../lib/hue/client';
import { DAY_LETTERS, DAY_NAMES, DAYS, fmtClock, type Clock, type Day } from '../../lib/rituals/time';
import { Switch } from '../controls';
import { Icon } from '../icons';
import { Choice } from '../scan/parts';
import { Display, Label, Txt } from '../text';
import { color, font, hairline } from '../theme';

export type RitualGlyphKind = 'wake' | 'sleep' | 'rhythm' | 'arrive' | 'leave';

/** Each ritual's tint: the light it's about. */
export const RITUAL_TINT: Record<RitualGlyphKind, string> = { wake: '#FFB46B', sleep: '#FF9E6B', rhythm: '#FFE2B8', arrive: '#FFC27A', leave: '#B9B0A2' };

/** The ritual's drawing (Nocturne canvas, Rituals page): sunrise, moon trail, day curve, home ring, leaving. */
export function RitualGlyph({ kind, size = 30, tint = color.ivory }: { kind: RitualGlyphKind; size?: number; tint?: string }) {
  const s = { stroke: tint, strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {kind === 'wake' && (
        <G>
          <Path d="M7 22a9 9 0 0 1 18 0Z" fill="#FFB46B" fillOpacity={0.22} />
          <Path d="M10 22a6 6 0 0 1 12 0" {...s} />
          <Path d="M16 12.5V9.5M9.3 15.3l-2.1-2.1M22.7 15.3l2.1-2.1" {...s} />
          <Path d="M4 22h24" {...s} />
          <Path d="M10 26h12" {...s} opacity={0.45} />
        </G>
      )}
      {kind === 'sleep' && (
        <G>
          <G transform="translate(1 2) scale(0.9)">
            <Path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10Z" {...s} fill="#FFC27A" fillOpacity={0.16} strokeWidth={1.45} />
          </G>
          <Circle cx={21.5} cy={19.5} r={1.5} fill={tint} />
          <Circle cx={25} cy={23.5} r={1.2} fill={tint} opacity={0.6} />
          <Circle cx={28} cy={27.5} r={0.9} fill={tint} opacity={0.32} />
        </G>
      )}
      {kind === 'rhythm' && (
        <G>
          <Path d="M4 26h24" {...s} opacity={0.4} strokeDasharray="1.5 3" />
          <Path d="M4 23C9 23 10.5 9 16 9s7 14 12 14" {...s} />
          <Circle cx={16} cy={9} r={5} fill="#FFE2B8" fillOpacity={0.2} />
          <Circle cx={16} cy={9} r={2.2} fill="#FFE2B8" />
        </G>
      )}
      {kind === 'arrive' && (
        <G>
          <Circle cx={16} cy={17} r={12.5} {...s} strokeDasharray="1.6 3" opacity={0.6} />
          <Path d="M11 21.5V16l5-4 5 4v5.5Z" {...s} fill="#FFC27A" fillOpacity={0.2} />
          <Path d="M14.8 21.5v-3.2h2.4v3.2" {...s} />
        </G>
      )}
      {kind === 'leave' && (
        <G>
          <Path d="M4.5 23v-6l5.5-4.5 5.5 4.5v6Z" {...s} />
          <Path d="M8.6 23v-3h2.8v3" {...s} />
          <Path d="M19 18.5h8.5M24 15l3.5 3.5L24 22" {...s} />
        </G>
      )}
    </Svg>
  );
}

/** The glyph in its round hairline frame, glowing in the ritual's tint while it's on. */
function GlyphDisc({ kind, on }: { kind: RitualGlyphKind; on: boolean }) {
  const tint = RITUAL_TINT[kind];
  return (
    <View style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: hairline(0.12), alignItems: 'center', justifyContent: 'center', opacity: on ? 1 : 0.7 }}>
      {on && (
        <Svg width={46} height={46} style={{ position: 'absolute' }}>
          <Defs>
            <RadialGradient id={`rg-${kind}`}>
              <Stop offset="0" stopColor={tint} stopOpacity={0.25} />
              <Stop offset="1" stopColor={tint} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={46} height={46} rx={23} fill={`url(#rg-${kind})`} />
        </Svg>
      )}
      <RitualGlyph kind={kind} tint={on ? color.ivory : color.muted} />
    </View>
  );
}

/** A ritual in the list: glyph, name (and a champagne badge), one-line summary, on/off switch. */
export function RitualCard({
  kind,
  name,
  badge,
  summary,
  on,
  onToggle,
  onPress,
  action,
}: {
  kind: RitualGlyphKind;
  name: string;
  badge?: string | null;
  summary: string;
  on: boolean;
  onToggle?: () => void;
  onPress: () => void;
  /** A small button instead of (or before) the switch, e.g. START. */
  action?: { title: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        minHeight: 84,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: hairline(on ? 0.12 : 0.08),
        backgroundColor: on ? color.card : '#070708',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 10,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${name}. ${summary}. Edit`}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, opacity: pressed ? 0.6 : 1 })}
      >
        <GlyphDisc kind={kind} on={on} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 22, color: on ? color.ivory : color.secondary, flexShrink: 1 }}>
              {name}
            </Display>
            {on && badge ? (
              <Label size={9} tone="champagne">
                {badge}
              </Label>
            ) : null}
          </View>
          <Txt size={12.5} tone={on ? 'secondary' : 'muted'} numberOfLines={1} style={{ lineHeight: 17 }}>
            {summary}
          </Txt>
        </View>
      </Pressable>
      {action && (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={`${action.title} ${name}`}
          style={({ pressed }) => ({ height: 44, justifyContent: 'center', paddingHorizontal: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: hairline(0.2), justifyContent: 'center' }}>
            <Label size={9} tone="ivory">
              {action.title}
            </Label>
          </View>
        </Pressable>
      )}
      {onToggle && <Switch on={on} onToggle={onToggle} label={name} big />}
    </View>
  );
}

/** A dashed "add" button (New ritual). */
export function DashedButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        height: 52,
        borderRadius: 22,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: hairline(0.24),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="add" size={14} tint={color.secondary} stroke={1.6} />
      <Txt size={14} tone="secondary" style={{ lineHeight: 18 }}>
        {title}
      </Txt>
    </Pressable>
  );
}

/** Seven round day toggles, Monday first. */
export function DaysRow({ days, onChange }: { days: Day[]; onChange: (d: Day[]) => void }) {
  return (
    <View accessibilityRole="none" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {DAYS.map((d, i) => {
        const on = days.includes(d);
        return (
          <Pressable
            key={d}
            onPress={() => onChange(on ? days.filter((x) => x !== d) : DAYS.filter((x) => x === d || days.includes(x)))}
            accessibilityRole="button"
            accessibilityLabel={DAY_NAMES[i]}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              borderWidth: 1,
              borderColor: on ? color.champagne : hairline(0.16),
              backgroundColor: on ? 'rgba(233,207,159,0.10)' : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Txt size={12} medium tone={on ? 'champagne' : 'muted'} style={{ lineHeight: 16 }}>
              {DAY_LETTERS[i]}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pick rooms and groups (several). Only those with lights. */
export function TargetChips({ snapshot, targets, onChange, single }: { snapshot: Snapshot | null; targets: string[]; onChange: (t: string[]) => void; single?: boolean }) {
  const groups = [...(snapshot?.rooms ?? []), ...(snapshot?.zones ?? [])].filter((g) => g.lightIds.length);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
      {groups.map((g) => {
        const on = targets.includes(g.id);
        return <Choice key={g.id} label={g.name} chosen={on} onPress={() => onChange(single ? [g.id] : on ? targets.filter((t) => t !== g.id) : [...targets, g.id])} />;
      })}
    </ScrollView>
  );
}

/** Names of rooms and groups, "Chambre, Salon" (or "No lights" when none is left). */
export function targetNames(s: Snapshot | null, targets: string[]) {
  const names = targets.map((t) => s?.rooms.find((r) => r.id === t)?.name ?? s?.zones?.find((z) => z.id === t)?.name).filter(Boolean);
  return names.length ? names.join(', ') : 'No lights';
}

/** A labeled block in an editor sheet. */
export function Block({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>{label}</Label>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Underlined number tabs (10 · 20 · 30 · 45 · 60 MIN). */
export function NumberTabs({ values, value, onChange, unit }: { values: number[]; value: number; onChange: (v: number) => void; unit: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {values.map((v) => (
        <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="button" accessibilityLabel={`${v} ${unit}`} accessibilityState={{ selected: v === value }} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={15} tone={v === value ? 'ivory' : 'muted'} style={{ lineHeight: 20, textDecorationLine: v === value ? 'underline' : 'none', textDecorationColor: color.champagne }}>
            {v}
          </Txt>
        </Pressable>
      ))}
      <Label size={9} style={{ marginLeft: 4 }}>
        {unit}
      </Label>
    </View>
  );
}

/** A switch row: title, a quiet line under it, the switch. */
export function SwitchRow({ title, sub, on, onToggle }: { title: string; sub?: string; on: boolean; onToggle: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderTopWidth: 1, borderTopColor: hairline(0.08) }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={15} style={{ lineHeight: 20 }}>
          {title}
        </Txt>
        {sub ? (
          <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <Switch on={on} onToggle={onToggle} label={title} big />
    </View>
  );
}

/**
 * A time of day in big Jost numbers, with steppers: hours by one, minutes by five. Holding a
 * stepper repeats.
 */
export function TimePicker({ value, onChange, label }: { value: Clock; onChange: (v: Clock) => void; label: string }) {
  const h = Math.floor(value / 60);
  const m = value % 60;
  const set = (hh: number, mm: number) => onChange((((hh * 60 + mm) % 1440) + 1440) % 1440);
  return (
    <View accessible accessibilityLabel={`${label} ${fmtClock(value)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Stepper label={`Hour, ${label}`} icon="up" onPress={() => set(h + 1, m)} onPress2={() => set(h - 1, m)} />
      <Display size={56} weight={200} style={{ lineHeight: 60, fontVariant: ['tabular-nums'], fontFamily: font.thin }}>
        {fmtClock(value)}
      </Display>
      <Stepper label={`Minutes, ${label}`} icon="up" onPress={() => set(h, m - (m % 5) + 5)} onPress2={() => set(h, m % 5 ? m - (m % 5) : m - 5)} />
    </View>
  );
}

/** Up/down pair; holding repeats. */
function Stepper({ label, onPress, onPress2 }: { label: string; icon: 'up'; onPress: () => void; onPress2: () => void }) {
  return (
    <View style={{ gap: 2 }}>
      <RepeatButton label={`${label}: later`} onPress={onPress} rotate="180deg" />
      <RepeatButton label={`${label}: earlier`} onPress={onPress2} rotate="0deg" />
    </View>
  );
}

function RepeatButton({ label, onPress, rotate }: { label: string; onPress: () => void; rotate: string }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const latest = useRef(onPress);
  useLayoutEffect(() => {
    latest.current = onPress;
  });
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  return (
    <Pressable
      onPress={() => latest.current()}
      onLongPress={() => {
        stop();
        timer.current = setInterval(() => latest.current(), 120);
      }}
      onPressOut={stop}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 44, height: 30, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1, transform: [{ rotate }] })}
    >
      <Icon name="chevronDown" size={16} tint={color.secondary} stroke={1.6} />
    </Pressable>
  );
}
