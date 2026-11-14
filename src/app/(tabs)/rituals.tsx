import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setRoom, type Snapshot } from '../../lib/hue/client';
import { refreshHome, useHome } from '../../lib/hue/useHome';
import type { Mood } from '../../lib/moods';
import { syncGeofence } from '../../lib/rituals/arrive';
import { ARRIVE_READY } from '../../lib/rituals/flags';
import { deleteRhythm, RHYTHM_PRESETS, saveRhythm, setRhythmEnabled, type RhythmRitual } from '../../lib/rituals/rhythm';
import {
  createBridgeRitual,
  deleteBridgeRitual,
  extendSleep,
  saveBridgeRitual,
  setBridgeRitualEnabled,
  startSleepNow,
  stopSleepNow,
  type BridgeRitual,
  type SleepRitual,
  type SleepRun,
  type WakeRitual,
} from '../../lib/rituals/rituals';
import { saveRitualSettings, type RitualSettings } from '../../lib/rituals/store';
import { cachedRituals, fetchRituals, localRituals, rememberRituals, type RitualsView } from '../../lib/rituals/view';
import { clock, daysLabel, EVERY_DAY, fmtClock, nextAt, WEEKDAYS, whenPhrase } from '../../lib/rituals/time';
import { ModalSheet } from '../../ui/ModalSheet';
import { ArriveSheet, type HomeRitual } from '../../ui/rituals/ArriveSheet';
import { DashedButton, RitualCard, RitualGlyph, targetNames, type RitualGlyphKind } from '../../ui/rituals/parts';
import { RhythmSheet } from '../../ui/rituals/RhythmSheet';
import { SleepSheet, WakeSheet } from '../../ui/rituals/WakeSleepSheets';
import { Display, Label, Txt } from '../../ui/text';
import { color, hairline, TAB_BAR_SPACE } from '../../ui/theme';

type Editing =
  | { kind: 'wake'; r: WakeRitual }
  | { kind: 'sleep'; r: SleepRitual }
  | { kind: 'rhythm'; r: RhythmRitual }
  | { kind: 'arrive'; which: HomeRitual }
  | { kind: 'new' };

/** A bedroom first (wake-ups and sleep fades), else the first room with lights. */
function defaultTargets(s: Snapshot | null): string[] {
  const rooms = (s?.rooms ?? []).filter((r) => r.lightIds.length);
  const bed = rooms.find((r) => r.archetype === 'bedroom');
  return bed ? [bed.id] : rooms[0] ? [rooms[0].id] : [];
}

/** Every indoor room with lights that take a white (day rhythm). */
function rhythmTargets(s: Snapshot | null): string[] {
  const outdoor = ['terrace', 'balcony', 'garden', 'driveway', 'porch', 'barbecue', 'pool', 'front_door', 'carport'];
  return (s?.rooms ?? []).filter((r) => !outdoor.includes(r.archetype) && r.lightIds.some((id) => s?.lights.find((l) => l.id === id)?.mirekRange)).map((r) => r.id);
}

const newWake = (s: Snapshot | null, at: number, days: WakeRitual['days']): WakeRitual => ({
  kind: 'wake',
  id: '',
  name: 'Sunrise',
  enabled: true,
  targets: defaultTargets(s),
  at,
  days,
  fadeMin: 30,
  brightness: 100,
  style: 'sunrise',
});

const newSleep = (s: Snapshot | null, scheduled: boolean): SleepRitual => ({
  kind: 'sleep',
  id: '',
  name: 'Sleep fade',
  enabled: scheduled,
  targets: defaultTargets(s),
  at: clock(23),
  days: EVERY_DAY,
  fadeMin: scheduled ? 30 : 20,
});

const newRhythm = (s: Snapshot | null, preset = RHYTHM_PRESETS[0]): RhythmRitual => ({
  kind: 'rhythm',
  id: `rhythm-${Date.now()}`,
  name: 'Day rhythm',
  enabled: true,
  targets: rhythmTargets(s),
  preset: preset.id,
  points: preset.points,
  bridge: {},
});

/**
 * Rituals: things that happen on their own. Sunrise wake-ups, sleep fades and day rhythms live on
 * the bridge (read back each time the tab opens); arriving and leaving home are a geofence on the
 * phone. Each one has a switch; tap to edit; "New ritual" offers presets per type.
 */
export default function RitualsScreen() {
  const insets = useSafeAreaInsets();
  const { snapshot } = useHome();
  // The last view first (kept between visits and on the phone), then the bridge read back: the
  // list shows whole, at once, never card by card.
  const [first] = useState(cachedRituals);
  const [bridge, setBridge] = useState<BridgeRitual[] | null>(first?.bridge ?? null);
  const [rhythms, setRhythms] = useState<RhythmRitual[]>(first?.rhythms ?? []);
  const [settings, setSettings] = useState<RitualSettings | null>(first?.settings ?? null);
  const [moods, setMoods] = useState<Mood[]>(first?.moods ?? []);
  const [sleepRun, setSleepRun] = useState<SleepRun | null>(first?.sleepRun ?? null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((v: RitualsView) => {
    setBridge(v.bridge);
    setSleepRun(v.sleepRun);
    setRhythms(v.rhythms);
    setSettings(v.settings);
    setMoods(v.moods);
  }, []);

  const load = useCallback(async () => {
    let fetched = false;
    // Nothing on screen yet: the phone's copy, if it has the bridge's part (else wait for the bridge).
    if (!cachedRituals()?.bridge) localRituals().then((v) => !fetched && v.bridge && show(v)).catch(() => null);
    try {
      const v = await fetchRituals();
      fetched = true;
      show(v);
      setError(null);
    } catch (e) {
      fetched = true;
      setError(String((e as Error)?.message ?? e));
      // Unreachable: still show what's kept on the phone (arriving home works without the bridge).
      localRituals().then(show).catch(() => null);
    }
  }, [show]);

  // What's on screen (optimistic changes included) is what the next visit starts from.
  useEffect(() => {
    if (settings) rememberRituals({ bridge, sleepRun, rhythms, settings, moods });
  }, [bridge, sleepRun, rhythms, settings, moods]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** Runs a bridge change, then reads everything back so the list shows what the bridge has. */
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      Alert.alert("Couldn't change the ritual", String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
      load();
    }
  };

  const toggleBridge = (r: BridgeRitual) => {
    setBridge((list) => list?.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)) ?? null);
    run(() => setBridgeRitualEnabled(r.id, !r.enabled));
  };

  const saveBridge = (r: BridgeRitual) => {
    if (!snapshot) return;
    setEditing(null);
    run(() => (r.id ? saveBridgeRitual(snapshot, r) : createBridgeRitual(snapshot, r)));
  };

  const removeBridge = (r: BridgeRitual) =>
    Alert.alert(`Delete ${r.name}?`, 'It’s removed from your bridge.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setEditing(null);
          run(() => deleteBridgeRitual(r.id));
        },
      },
    ]);

  const startSleep = (r: SleepRitual) => {
    if (!snapshot) return;
    run(async () => setSleepRun(await startSleepNow(snapshot, r.targets, r.fadeMin)));
  };

  const stopSleep = () => {
    setSleepRun(null);
    run(stopSleepNow);
  };

  /** "+5 min": the running fade ends five minutes later. */
  const extendSleepRun = () => {
    if (!snapshot || !sleepRun) return;
    const r = sleepRun;
    setSleepRun({ ...r, endsAt: r.endsAt + 5 * 60_000 });
    run(async () => setSleepRun(await extendSleep(snapshot, r)));
  };

  const sleepAllOff = () => {
    const targets = sleepRun?.targets ?? [];
    setSleepRun(null);
    run(async () => {
      await stopSleepNow();
      for (const t of targets) {
        const g = snapshot?.rooms.find((x) => x.id === t) ?? snapshot?.zones?.find((x) => x.id === t);
        if (g?.groupedLightId) await setRoom(g.groupedLightId, { on: false });
      }
      refreshHome();
    });
  };

  const saveRhythmRitual = (r: RhythmRitual) => {
    if (!snapshot) return;
    setEditing(null);
    run(async () => setRhythms(await saveRhythm(snapshot, r)));
  };

  const toggleRhythm = (r: RhythmRitual) => {
    if (!snapshot) return;
    setRhythms((list) => list.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)));
    run(async () => setRhythms(await setRhythmEnabled(snapshot, r.id, !r.enabled)));
  };

  const removeRhythm = (r: RhythmRitual) =>
    Alert.alert(`Delete ${r.name}?`, undefined, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setEditing(null);
          run(async () => setRhythms(await deleteRhythm(r.id)));
        },
      },
    ]);

  const saveArrive = async (change: Pick<RitualSettings, 'home' | 'arrive' | 'leave'>) => {
    setEditing(null);
    setSettings(await saveRitualSettings(change));
    syncGeofence().catch((e) => Alert.alert("Couldn't watch for home", String(e?.message ?? e)));
  };

  const toggleHome = async (which: 'arrive' | 'leave') => {
    if (!settings?.home) return setEditing({ kind: 'arrive', which });
    const next = which === 'arrive' ? { arrive: { ...settings.arrive, enabled: !settings.arrive.enabled } } : { leave: { enabled: !settings.leave.enabled } };
    setSettings(await saveRitualSettings(next));
    const watching = await syncGeofence().catch(() => false);
    // Turned on without "Allow all the time": the sheet asks for it.
    if (!watching && (next.arrive?.enabled || next.leave?.enabled)) setEditing({ kind: 'arrive', which });
  };

  // What comes next, for the header and the cards.
  const wakes = (bridge ?? []).filter((r): r is WakeRitual => r.kind === 'wake');
  const sleeps = (bridge ?? []).filter((r): r is SleepRitual => r.kind === 'sleep');
  const upcoming = [
    ...wakes.filter((r) => r.enabled).map((r) => ({ at: new Date(nextAt(r.at, r.days).getTime() - r.fadeMin * 60_000), what: r.name })),
    ...sleeps.filter((r) => r.enabled).map((r) => ({ at: nextAt(r.at, r.days), what: r.name })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const next = upcoming[0];
  const arriveOn = !!settings?.arrive.enabled && !!settings.home;
  const leaveOn = !!settings?.leave.enabled && !!settings.home;
  const active = wakes.filter((r) => r.enabled).length + sleeps.filter((r) => r.enabled).length + rhythms.filter((r) => r.enabled).length + (arriveOn ? 1 : 0) + (leaveOn ? 1 : 0);
  const total = wakes.length + sleeps.length + rhythms.length + (ARRIVE_READY ? 2 : 0);
  // The list appears whole: the bridge's part read (or known unreachable) and the phone's settings.
  const ready = !!settings && (bridge !== null || !!error);
  const moodName = (id: string | null) => (id ? (moods.find((m) => m.id === id)?.name ?? 'Removed mood') : null);
  const arriveSummary = !settings?.home
    ? 'Set your home first'
    : [settings.arrive.afterSunset ? 'After sunset' : null, settings.arrive.hours ? `${fmtClock(settings.arrive.hours[0])}–${fmtClock(settings.arrive.hours[1])}` : null, moodName(settings.arrive.moodId) ?? 'Lights on']
        .filter(Boolean)
        .join(' · ');
  const lightCount = (r: RhythmRitual) =>
    new Set(r.targets.flatMap((t) => snapshot?.rooms.find((x) => x.id === t)?.lightIds ?? snapshot?.zones?.find((x) => x.id === t)?.lightIds ?? [])
      .filter((id) => snapshot?.lights.find((l) => l.id === id)?.kind !== 'onoff')).size;

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + TAB_BAR_SPACE + 32 }}>
      <Label tone="label">{bridge ? `${active} of ${total} active` : ' '}</Label>
      <Display style={{ marginTop: 14 }}>Rituals</Display>
      <Txt size={14} tone="secondary" style={{ marginTop: 8 }}>
        {'Next: '}
        <Txt size={14}>{!ready ? ' ' : next ? `${next.what} ${whenPhrase(next.at)}` : arriveOn ? 'Arriving home' : 'Nothing scheduled'}</Txt>
      </Txt>

      {error && (
        <Txt size={13} tone="champagne" style={{ marginTop: 14 }}>
          {`Couldn't reach your bridge: ${error}`}
        </Txt>
      )}

      {ready && (
        <View style={{ marginTop: 22, gap: 8, opacity: busy ? 0.7 : 1 }}>
          {wakes.map((r) => (
            <RitualCard
              key={r.id}
              kind="wake"
              name={r.name}
              badge={`Starts ${fmtClock(r.at - r.fadeMin)}`}
              summary={`${daysLabel(r.days)} · ${fmtClock(r.at)} · ${targetNames(snapshot, r.targets)}`}
              on={r.enabled}
              onToggle={() => toggleBridge(r)}
              onPress={() => setEditing({ kind: 'wake', r })}
            />
          ))}
          {sleeps.map((r) => {
            const running = !!sleepRun && sleepRun.targets.join() === r.targets.join();
            return (
              <RitualCard
                key={r.id}
                kind="sleep"
                name={r.name}
                badge={running ? 'Fading' : null}
                summary={r.enabled ? `${daysLabel(r.days)} · ${fmtClock(r.at)} · ${r.fadeMin} min · ${targetNames(snapshot, r.targets)}` : `${r.fadeMin} min · ${targetNames(snapshot, r.targets)}`}
                on={r.enabled || running}
                action={running ? { title: '+5 min', onPress: extendSleepRun } : { title: 'Start', onPress: () => startSleep(r) }}
                onToggle={() => toggleBridge(r)}
                onPress={() => setEditing({ kind: 'sleep', r })}
              />
            );
          })}
          {sleepRun && !sleeps.some((r) => r.targets.join() === sleepRun.targets.join()) && (
            <RitualCard
              kind="sleep"
              name="Sleep fade"
              badge="Fading"
              summary={`${Math.round(sleepRun.fadeMin)} min · ${targetNames(snapshot, sleepRun.targets)}`}
              on
              action={{ title: '+5 min', onPress: extendSleepRun }}
              onPress={() => setEditing({ kind: 'sleep', r: { ...newSleep(snapshot, false), targets: sleepRun.targets, fadeMin: Math.round(sleepRun.fadeMin) } })}
            />
          )}
          {rhythms.map((r) => (
            <RitualCard
              key={r.id}
              kind="rhythm"
              name={r.name}
              summary={`${RHYTHM_PRESETS.find((p) => p.id === r.preset)?.name ?? 'Your curve'} · ${lightCount(r)} lights · ${targetNames(snapshot, r.targets)}`}
              on={r.enabled}
              onToggle={() => toggleRhythm(r)}
              onPress={() => setEditing({ kind: 'rhythm', r })}
            />
          ))}
          {settings && ARRIVE_READY && (
            <>
              <RitualCard kind="arrive" name="Arriving home" summary={arriveSummary} on={arriveOn} onToggle={() => toggleHome('arrive')} onPress={() => setEditing({ kind: 'arrive', which: 'arrive' })} />
              <RitualCard kind="leave" name="Leaving home" summary={settings.home ? 'All off' : 'Set your home first'} on={leaveOn} onToggle={() => toggleHome('leave')} onPress={() => setEditing({ kind: 'arrive', which: 'leave' })} />
            </>
          )}
          <DashedButton title="New ritual" onPress={() => setEditing({ kind: 'new' })} />
        </View>
      )}

      <View style={{ marginTop: 16, flexDirection: 'row', gap: 10, alignItems: 'flex-start', opacity: ready ? 1 : 0 }}>
        <View style={{ width: 16, height: 16, borderRadius: 5, borderWidth: 1.5, borderColor: color.muted, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: color.muted }} />
        </View>
        <Txt size={11.5} tone="muted" style={{ flex: 1, lineHeight: 17 }}>
          Sunrise, sleep fade and day rhythm run on your bridge, even with your phone off.
        </Txt>
      </View>

      {editing?.kind === 'new' && (
        <NewRitualSheet
          onClose={() => setEditing(null)}
          onPick={(e) => setEditing(e)}
          onStartSleep={() => {
            setEditing(null);
            startSleep(newSleep(snapshot, false));
          }}
          snapshot={snapshot}
        />
      )}
      {editing?.kind === 'wake' && (
        <WakeSheet initial={editing.r} snapshot={snapshot} onSave={saveBridge} onDelete={editing.r.id ? () => removeBridge(editing.r) : undefined} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'sleep' && (
        <SleepSheet
          initial={editing.r}
          snapshot={snapshot}
          run={sleepRun}
          onStart={(r) => startSleep(r)}
          onStop={stopSleep}
          onAllOff={sleepAllOff}
          onExtend={extendSleepRun}
          onSave={saveBridge}
          onDelete={editing.r.id ? () => removeBridge(editing.r) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'rhythm' && (
        <RhythmSheet
          isNew={!rhythms.some((x) => x.id === editing.r.id)}
          initial={editing.r}
          snapshot={snapshot}
          onSave={saveRhythmRitual}
          onDelete={rhythms.some((x) => x.id === editing.r.id) ? () => removeRhythm(editing.r) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'arrive' && settings && <ArriveSheet which={editing.which} initial={settings} snapshot={snapshot} moods={moods} onSave={saveArrive} onClose={() => setEditing(null)} />}
    </ScrollView>
  );
}

/** "New ritual": each type with its presets. */
function NewRitualSheet({ snapshot, onPick, onStartSleep, onClose }: { snapshot: Snapshot | null; onPick: (e: Editing) => void; onStartSleep: () => void; onClose: () => void }) {
  return (
    <ModalSheet visible title="New ritual" onClose={onClose}>
      <TypeBlock kind="wake" title="Sunrise" sub="Lights fade up before you wake.">
        <Preset label="Weekdays · 7:00" onPress={() => onPick({ kind: 'wake', r: newWake(snapshot, clock(7), WEEKDAYS) })} />
        <Preset label="Weekends · 9:00" onPress={() => onPick({ kind: 'wake', r: { ...newWake(snapshot, clock(9), ['saturday', 'sunday']), name: 'Weekend sunrise' } })} />
        <Preset label="Every day · 7:30" onPress={() => onPick({ kind: 'wake', r: newWake(snapshot, clock(7, 30), EVERY_DAY) })} />
      </TypeBlock>
      <TypeBlock kind="sleep" title="Sleep fade" sub="Lights dim to off while you fall asleep.">
        <Preset label="Start now · 20 min" onPress={onStartSleep} />
        <Preset label="When I start it" onPress={() => onPick({ kind: 'sleep', r: newSleep(snapshot, false) })} />
        <Preset label="Every night · 23:00" onPress={() => onPick({ kind: 'sleep', r: { ...newSleep(snapshot, true), name: 'Bedtime' } })} />
      </TypeBlock>
      <TypeBlock kind="rhythm" title="Day rhythm" sub="White that follows the day, cool to warm.">
        {RHYTHM_PRESETS.map((p) => (
          <Preset key={p.id} label={p.name} onPress={() => onPick({ kind: 'rhythm', r: newRhythm(snapshot, p) })} />
        ))}
      </TypeBlock>
      {ARRIVE_READY && (
        <TypeBlock kind="arrive" title="Arriving and leaving" sub="Lights on as you get home; all off when you leave.">
          <Preset label="When I get home" onPress={() => onPick({ kind: 'arrive', which: 'arrive' })} />
          <Preset label="When I leave" onPress={() => onPick({ kind: 'arrive', which: 'leave' })} />
        </TypeBlock>
      )}
    </ModalSheet>
  );
}

function TypeBlock({ kind, title, sub, children }: { kind: RitualGlyphKind; title: string; sub: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: hairline(0.08) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <RitualGlyph kind={kind} size={28} />
        <View style={{ flex: 1 }}>
          <Display size={17} weight={400} style={{ lineHeight: 21 }}>
            {title}
          </Display>
          <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
            {sub}
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

function Preset({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: hairline(0.16), justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Txt size={13} style={{ lineHeight: 17 }}>
        {label}
      </Txt>
    </Pressable>
  );
}
