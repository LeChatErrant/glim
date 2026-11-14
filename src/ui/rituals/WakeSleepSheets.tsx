import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { Snapshot } from '../../lib/hue/client';
import type { SleepRitual, SleepRun, WakeRitual } from '../../lib/rituals/rituals';
import { daysLabel, fmtClock, nextAt, whenLabel } from '../../lib/rituals/time';
import { PillButton, Slider } from '../controls';
import { Field, ModalSheet } from '../ModalSheet';
import { Choice } from '../scan/parts';
import { Display, Label, Txt } from '../text';
import { color, hairline } from '../theme';
import { Block, daysPhrase, DaysRow, NumberTabs, Sentence, SheetFooter, TargetChips, targetNames, TimePicker } from './parts';

const BRIDGE_NOTE = 'Runs on your bridge, even with your phone off.';

/** Sunrise wake-up: when you wake up, which days, which rooms, how long the fade, how bright. */
export function WakeSheet({
  initial,
  snapshot,
  onSave,
  onDelete,
  onClose,
}: {
  initial: WakeRitual;
  snapshot: Snapshot | null;
  onSave: (r: WakeRitual) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [r, setR] = useState(initial);
  const set = (c: Partial<WakeRitual>) => setR((x) => ({ ...x, ...c }));
  const start = (r.at - r.fadeMin + 1440) % 1440;
  const isNew = !initial.id;
  const sentence = r.targets.length
    ? `${cap(daysPhrase(r.days))}, ${targetNames(snapshot, r.targets)} ${r.targets.length === 1 ? 'glows' : 'glow'} up from ${fmtClock(start)}, fully lit at ${fmtClock(r.at)}.`
    : 'Pick the rooms to wake up.';
  return (
    <ModalSheet visible title={isNew ? 'New sunrise' : r.name} onClose={onClose}>
      <SunriseStrip fadeMin={r.fadeMin} start={start} end={r.at} />
      <Sentence>{sentence}</Sentence>
      <Block label="Wake up at" right={initial.enabled && !isNew ? <Txt size={12} tone="secondary">{`Next: ${whenLabel(nextAt(initial.at, initial.days))}`}</Txt> : undefined}>
        <TimePicker value={r.at} onChange={(at) => set({ at })} label="Wake-up time" />
      </Block>
      <Block label={`Days · ${daysLabel(r.days)}`}>
        <DaysRow days={r.days} onChange={(days) => set({ days })} />
      </Block>
      <Block label="Rooms">
        <TargetChips snapshot={snapshot} targets={r.targets} onChange={(targets) => set({ targets })} />
      </Block>
      <Block label="Fade in">
        <NumberTabs values={[10, 20, 30, 45, 60]} value={r.fadeMin} onChange={(fadeMin) => set({ fadeMin })} unit="min" />
      </Block>
      <Block label={`Brightness at ${fmtClock(r.at)} · ${r.brightness}%`}>
        <Slider value={r.brightness} min={10} max={100} tint="#FFE7CC" ground={color.sheet} label="Brightness at wake-up time" onChange={(brightness) => set({ brightness })} onCommit={(brightness) => set({ brightness })} />
      </Block>
      <Block label="Light">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Choice label="Sunrise colors" dot="#FFB46B" chosen={r.style === 'sunrise'} onPress={() => set({ style: 'sunrise' })} />
          <Choice label="Plain white" dot="#FFF1DE" chosen={r.style === 'basic'} onPress={() => set({ style: 'basic' })} />
        </View>
      </Block>
      <Field label="Name" value={r.name} onChange={(name) => set({ name })} />
      <Txt size={12} tone="muted">
        {BRIDGE_NOTE}
      </Txt>
      <SheetFooter
        isNew={isNew}
        on={initial.enabled}
        noun="sunrise"
        missing={!r.targets.length ? 'Pick a room' : !r.days.length ? 'Pick the days' : null}
        onSave={(enabled) => onSave({ ...r, enabled, name: r.name.trim() || 'Sunrise' })}
        onDelete={onDelete}
      />
    </ModalSheet>
  );
}

/** The fade-in as a strip from night blue to morning white, start and end times under it. */
function SunriseStrip({ fadeMin, start, end }: { fadeMin: number; start: number; end: number }) {
  const [w, setW] = useState(0);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 44 }}>
      {w > 0 && (
        <Svg width={w} height={8}>
          <Defs>
            <LinearGradient id="sunrise" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#121838" />
              <Stop offset="0.18" stopColor="#27295E" />
              <Stop offset="0.36" stopColor="#5B3C78" />
              <Stop offset="0.52" stopColor="#B35A6E" />
              <Stop offset="0.66" stopColor="#F08A5A" />
              <Stop offset="0.78" stopColor="#FFB46B" />
              <Stop offset="0.9" stopColor="#FFDDAE" />
              <Stop offset="1" stopColor="#FFF5E6" />
            </LinearGradient>
          </Defs>
          <Rect width={w} height={8} rx={4} fill="url(#sunrise)" />
        </Svg>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
        <Txt size={12} tone="secondary">
          {fmtClock(start)}
        </Txt>
        <Label size={9}>{`${fadeMin} min · fade in`}</Label>
        <Txt size={12} tone="champagne">
          {fmtClock(end)}
        </Txt>
      </View>
    </View>
  );
}

/**
 * Sleep fade: lights dim from where they are to off. Start it now (the button near the top), and
 * optionally on a schedule too. While one runs, the sheet opens on the time left.
 */
export function SleepSheet({
  initial,
  snapshot,
  run,
  onStart,
  onStop,
  onAllOff,
  onExtend,
  onSave,
  onDelete,
  onClose,
}: {
  initial: SleepRitual;
  snapshot: Snapshot | null;
  run: SleepRun | null;
  onStart: (r: SleepRitual) => void;
  onStop: () => void;
  onAllOff: () => void;
  onExtend: () => void;
  onSave: (r: SleepRitual) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [r, setR] = useState(initial);
  const set = (c: Partial<SleepRitual>) => setR((x) => ({ ...x, ...c }));
  const isNew = !initial.id;
  const rooms = targetNames(snapshot, r.targets);
  const sentence = !r.targets.length
    ? 'Pick the rooms to fade.'
    : `${rooms} ${r.targets.length === 1 ? 'dims' : 'dim'} to dark over ${r.fadeMin} min, ${r.enabled ? `${daysPhrase(r.days)} at ${fmtClock(r.at)}, or when you start it` : 'when you start it'}.`;
  return (
    <ModalSheet visible title={isNew ? 'New sleep fade' : r.name} onClose={onClose}>
      {run ? <SleepRunning run={run} snapshot={snapshot} onStop={onStop} onAllOff={onAllOff} onExtend={onExtend} /> : <Sentence>{sentence}</Sentence>}
      {!run && <PillButton title={`Start now · ${r.fadeMin} min`} icon="sleep" disabled={!r.targets.length} onPress={() => onStart(r)} />}
      <Block label="Rooms">
        <TargetChips snapshot={snapshot} targets={r.targets} onChange={(targets) => set({ targets })} />
      </Block>
      <Block label="Fade out">
        <NumberTabs values={[5, 10, 20, 30, 45, 60]} value={r.fadeMin} onChange={(fadeMin) => set({ fadeMin })} unit="min" />
      </Block>
      <Block label="When">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Choice label="When I start it" chosen={!r.enabled} onPress={() => set({ enabled: false })} />
          <Choice label="On a schedule" chosen={r.enabled} onPress={() => set({ enabled: true })} />
        </View>
        {r.enabled && (
          <View style={{ gap: 10, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Label size={9} style={{ width: 44 }}>
                Starts
              </Label>
              <TimePicker value={r.at} onChange={(at) => set({ at })} label="Fade starts at" />
            </View>
            <DaysRow days={r.days} onChange={(days) => set({ days })} />
          </View>
        )}
      </Block>
      <Field label="Name" value={r.name} onChange={(name) => set({ name })} />
      <Txt size={12} tone="muted">
        {r.enabled ? BRIDGE_NOTE : 'Start it here, from the Rituals tab, a Moods widget button or the Quick Settings tile.'}
      </Txt>
      <SheetFooter
        isNew={isNew}
        on
        toggle={false}
        noun="sleep fade"
        missing={!r.targets.length ? 'Pick a room' : r.enabled && !r.days.length ? 'Pick the days' : null}
        onSave={() => onSave({ ...r, name: r.name.trim() || 'Sleep fade' })}
        onDelete={onDelete}
      />
    </ModalSheet>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "Fading to dark": a ring with the time left, Stop and keep lights, Lights off now. */
function SleepRunning({ run, snapshot, onStop, onAllOff, onExtend }: { run: SleepRun; snapshot: Snapshot | null; onStop: () => void; onAllOff: () => void; onExtend: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const total = run.fadeMin * 60_000;
  const left = Math.max(0, run.endsAt - now);
  const waiting = left > total;
  const frac = waiting ? 1 : left / total;
  const secs = Math.ceil(Math.min(left, total) / 1000);
  const names = run.targets.map((t) => snapshot?.rooms.find((x) => x.id === t)?.name ?? snapshot?.zones?.find((x) => x.id === t)?.name).filter(Boolean).join(', ');
  const R = 80;
  const a = frac * 2 * Math.PI;
  const arc = frac >= 0.999 ? `M100 ${100 - R}a${R} ${R} 0 1 1 -0.01 0` : `M100 ${100 - R}A${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${100 + R * Math.sin(a)} ${100 - R * Math.cos(a)}`;
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingBottom: 6 }}>
      <Display size={28}>
        {left > 0 ? 'Fading to ' : 'Lights '}
        <Display size={28} style={{ color: color.champagne }}>
          {left > 0 ? 'dark' : 'off'}
        </Display>
      </Display>
      <Txt size={13} tone="secondary">
        {names}
        {left > 0 ? ` · ends at ${fmtClock(new Date(run.endsAt).getHours() * 60 + new Date(run.endsAt).getMinutes())}` : ''}
      </Txt>
      <View style={{ width: 200, height: 200, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={200} height={200} style={{ position: 'absolute' }}>
          <Path d={`M100 ${100 - R}a${R} ${R} 0 1 1 -0.01 0`} stroke={hairline(0.1)} strokeWidth={2} fill="none" />
          {frac > 0 && <Path d={arc} stroke={color.champagne} strokeWidth={2} fill="none" strokeLinecap="round" />}
        </Svg>
        <Display size={52} weight={200} style={{ lineHeight: 56, fontVariant: ['tabular-nums'] }}>
          {waiting ? '…' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}
        </Display>
        <Label size={9} tone="label">
          {waiting ? 'Starting' : left > 0 ? 'Left' : 'Good night'}
        </Label>
        <Txt size={12} tone="muted">
          {`of ${Math.round(run.fadeMin)} min`}
        </Txt>
      </View>
      {left > 0 && (
        <View style={{ gap: 10, alignSelf: 'stretch' }}>
          <PillButton title="Stop and keep lights" kind="primary" onPress={onStop} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PillButton title="+5 min" onPress={onExtend} style={{ flex: 1 }} />
            <PillButton title="Lights off now" onPress={onAllOff} style={{ flex: 1 }} />
          </View>
        </View>
      )}
    </View>
  );
}
