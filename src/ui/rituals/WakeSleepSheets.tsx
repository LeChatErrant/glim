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
import { Block, DaysRow, NumberTabs, SwitchRow, TargetChips, TimePicker } from './parts';

const BRIDGE_NOTE = 'Runs on your bridge, even with your phone off.';

/** Sunrise wake-up: wake-up time, days, rooms, how long the fade takes, how bright it ends. */
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
  const start = r.at - r.fadeMin;
  const next = nextAt(r.at, r.days);
  return (
    <ModalSheet visible title={initial.id ? 'Sunrise' : 'New sunrise'} onClose={onClose}>
      <SunriseStrip fadeMin={r.fadeMin} start={start} end={r.at} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <TimePicker value={r.at} onChange={(at) => set({ at })} label="Wake-up time" />
        <View style={{ alignItems: 'flex-end', gap: 4, paddingBottom: 8 }}>
          <Label size={9}>Wake-up time</Label>
          <Txt size={12} tone="secondary">
            {r.enabled ? whenLabel(next) : 'Off'}
          </Txt>
        </View>
      </View>
      <Block label={`Days · ${daysLabel(r.days)}`}>
        <DaysRow days={r.days} onChange={(days) => set({ days })} />
      </Block>
      <Block label="Lights">
        <TargetChips snapshot={snapshot} targets={r.targets} onChange={(targets) => set({ targets })} />
      </Block>
      <Block label="Fade in">
        <NumberTabs values={[10, 20, 30, 45, 60]} value={r.fadeMin} onChange={(fadeMin) => set({ fadeMin })} unit="min" />
      </Block>
      <Block label={`Ends at · ${r.brightness}%`}>
        <Slider value={r.brightness} min={10} max={100} tint="#FFE7CC" ground={color.sheet} label="Brightness at wake-up time" onChange={(brightness) => set({ brightness })} onCommit={(brightness) => set({ brightness })} />
      </Block>
      <Block label="Light">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Choice label="Sunrise colors" dot="#FFB46B" chosen={r.style === 'sunrise'} onPress={() => set({ style: 'sunrise' })} />
          <Choice label="Plain white" dot="#FFF1DE" chosen={r.style === 'basic'} onPress={() => set({ style: 'basic' })} />
        </View>
      </Block>
      <Field label="Name" value={r.name} onChange={(name) => set({ name })} />
      <SwitchRow title="On" sub={r.enabled ? `Starts ${fmtClock(start)}, ${daysLabel(r.days).toLowerCase()}` : 'Kept, but won’t run'} on={r.enabled} onToggle={() => set({ enabled: !r.enabled })} />
      <Txt size={12} tone="muted">
        {BRIDGE_NOTE}
      </Txt>
      <PillButton title="Save" kind="primary" disabled={!r.targets.length} onPress={() => onSave({ ...r, name: r.name.trim() || 'Sunrise' })} />
      {onDelete && <PillButton title="Delete sunrise" kind="text" height={40} onPress={onDelete} style={{ alignSelf: 'flex-start' }} />}
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
 * Sleep fade: start it now (lights dim from where they are to off), and optionally on a schedule.
 * While one runs, the sheet shows the time left with Stop and Lights off now.
 */
export function SleepSheet({
  initial,
  snapshot,
  run,
  onStart,
  onStop,
  onAllOff,
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
  onSave: (r: SleepRitual) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [r, setR] = useState(initial);
  const set = (c: Partial<SleepRitual>) => setR((x) => ({ ...x, ...c }));
  return (
    <ModalSheet visible title={initial.id ? r.name : 'New sleep fade'} onClose={onClose}>
      {run ? <SleepRunning run={run} snapshot={snapshot} onStop={onStop} onAllOff={onAllOff} /> : null}
      <Block label="Lights">
        <TargetChips snapshot={snapshot} targets={r.targets} onChange={(targets) => set({ targets })} />
      </Block>
      <Block label="Fade out">
        <NumberTabs values={[5, 10, 20, 30, 45, 60]} value={r.fadeMin} onChange={(fadeMin) => set({ fadeMin })} unit="min" />
      </Block>
      {!run && <PillButton title={`Start now · ${r.fadeMin} min`} kind="primary" disabled={!r.targets.length} onPress={() => onStart(r)} />}
      <SwitchRow
        title="On a schedule"
        sub={r.enabled ? `${daysLabel(r.days)} at ${fmtClock(r.at)}` : 'Only when you start it'}
        on={r.enabled}
        onToggle={() => set({ enabled: !r.enabled })}
      />
      {r.enabled && (
        <>
          <TimePicker value={r.at} onChange={(at) => set({ at })} label="Fade starts at" />
          <DaysRow days={r.days} onChange={(days) => set({ days })} />
        </>
      )}
      <Field label="Name" value={r.name} onChange={(name) => set({ name })} />
      <Txt size={12} tone="muted">
        {BRIDGE_NOTE}
      </Txt>
      <PillButton title="Save" disabled={!r.targets.length} onPress={() => onSave({ ...r, name: r.name.trim() || 'Sleep fade' })} />
      {onDelete && <PillButton title="Delete sleep fade" kind="text" height={40} onPress={onDelete} style={{ alignSelf: 'flex-start' }} />}
    </ModalSheet>
  );
}

/** "Fading to dark": a ring with the time left, Stop and keep lights, Lights off now. */
function SleepRunning({ run, snapshot, onStop, onAllOff }: { run: SleepRun; snapshot: Snapshot | null; onStop: () => void; onAllOff: () => void }) {
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
          {`of ${run.fadeMin} min`}
        </Txt>
      </View>
      {left > 0 && (
        <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
          <PillButton title="Stop and keep lights" kind="primary" onPress={onStop} style={{ flex: 1 }} />
          <PillButton title="Lights off now" onPress={onAllOff} />
        </View>
      )}
    </View>
  );
}
