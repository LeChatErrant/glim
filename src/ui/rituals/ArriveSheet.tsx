import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { Snapshot } from '../../lib/hue/client';
import type { Mood } from '../../lib/moods';
import { askLocationAccess, hereNow, locationAccess } from '../../lib/rituals/arrive';
import { askNotifications, notificationsAllowed } from '../../lib/rituals/homeNotice';
import type { Arrive, HomeArea, RitualSettings } from '../../lib/rituals/store';
import { sunTimes } from '../../lib/rituals/sun';
import { clock, fmtClock } from '../../lib/rituals/time';
import { PillButton } from '../controls';
import { ModalSheet } from '../ModalSheet';
import { Choice } from '../scan/parts';
import { Display, Label, Txt } from '../text';
import { color, hairline } from '../theme';
import { Block, NumberTabs, TimePicker } from './parts';

export type HomeRitual = 'arrive' | 'leave';

type Draft = Pick<RitualSettings, 'home' | 'arrive' | 'leave'>;
type When = 'any' | 'sunset' | 'hours';

const RADII = [100, 150, 250, 400];

/** The arriving ritual's condition, as one choice (sunset and hours together read as hours). */
const whenOf = (a: Arrive): When => (a.hours ? 'hours' : a.afterSunset ? 'sunset' : 'any');

/**
 * Arriving home or leaving home, each in its own sheet (home itself is shared). Reads top to
 * bottom like the ritual: a sentence saying what will happen, where home is, what happens, when.
 * The main button turns it on (or saves it); location access is asked only then, when needed.
 */
export function ArriveSheet({
  which,
  initial,
  snapshot,
  moods,
  onSave,
  onClose,
}: {
  which: HomeRitual;
  initial: RitualSettings;
  snapshot: Snapshot | null;
  moods: Mood[];
  onSave: (s: Draft) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<Draft>({ home: initial.home, arrive: initial.arrive, leave: initial.leave });
  const [access, setAccess] = useState<'all' | 'foreground' | 'none' | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<boolean | null>(null);
  const { locating, setHere } = useHere((home) => setS((x) => ({ ...x, home: { ...home, radius: x.home?.radius ?? 150 } })), setError);
  // A mood picked, or about to be (the "A mood" choice before one is chosen).
  const [moodMode, setMoodMode] = useState(!!initial.arrive.moodId);
  const arrive = s.arrive;
  const setArrive = (c: Partial<Arrive>) => setS((x) => ({ ...x, arrive: { ...x.arrive, ...c } }));
  const wasOn = which === 'arrive' ? initial.arrive.enabled && !!initial.home : initial.leave.enabled && !!initial.home;

  useEffect(() => {
    locationAccess().then(setAccess);
    notificationsAllowed().then(setNotices);
  }, []);

  /** Saves it on, after asking for notifications (each run says what it did; never blocks). */
  const turnOn = async () => {
    if (!notices) setNotices(await askNotifications());
    onSave(draft(true));
  };

  const draft = (enabled: boolean): Draft =>
    which === 'arrive' ? { ...s, arrive: { ...s.arrive, enabled, moodId: moodMode ? s.arrive.moodId : null } } : { ...s, leave: { enabled } };

  /** Turn on or save: asks for location "all the time" first when it's missing. */
  const confirm = async () => {
    if (access !== 'all') return setAsking(true);
    turnOn();
  };

  const ask = async () => {
    setError(null);
    const a = await askLocationAccess().catch(() => 'none' as const);
    setAccess(a);
    if (a === 'all') return turnOn();
    setError(a === 'foreground' ? 'Choose “Allow all the time” so it works with the app closed.' : 'Location is off for Glim.');
  };

  if (asking) {
    return (
      <ModalSheet visible title="Let your home know you’re near" onClose={onClose}>
        <ApproachArt leaving={which === 'leave'} />
        <Txt size={14} tone="secondary">
          Glim needs your location{' '}
          <Txt size={14} tone="ivory">
            all the time
          </Txt>
          , so it notices you {which === 'arrive' ? 'arriving' : 'leaving'} with the app closed. Your location stays on your phone and is only used to know if you’re home.
        </Txt>
        <View style={{ gap: 10 }}>
          <Step n={1} text="Tap Continue" />
          <Step n={2} text="Choose “Allow all the time”" />
        </View>
        {error && (
          <Txt size={13} tone="champagne">
            {error}
          </Txt>
        )}
        <PillButton title="Continue" kind="primary" onPress={ask} />
        {access === 'foreground' && <PillButton title="Open app settings" onPress={() => Linking.openSettings()} />}
        <PillButton title="Back" kind="text" onPress={() => setAsking(false)} />
      </ModalSheet>
    );
  }

  const groups = [...(snapshot?.rooms ?? []), ...(snapshot?.zones ?? [])].filter((g) => g.lightIds.length);
  const groupName = (id: string | null) => (id ? groups.find((g) => g.id === id)?.name : null);
  const moodLabel = (m: Mood) => {
    const where = groupName(m.targetId);
    return where && moods.some((o) => o !== m && o.name === m.name) ? `${m.name} · ${where}` : m.name;
  };
  const when = whenOf(arrive);
  const sun = s.home ? sunTimes(s.home.lat, s.home.lon) : null;
  const pickedMood = moodMode ? moods.find((m) => m.id === arrive.moodId) : undefined;
  const sentence =
    which === 'leave'
      ? 'When you leave, every light turns off.'
      : `When you get home${when === 'sunset' ? ' after sunset' : when === 'hours' && arrive.hours ? ` between ${fmtClock(arrive.hours[0])} and ${fmtClock(arrive.hours[1])}` : ''}, ${
          moodMode ? (pickedMood ? `${pickedMood.name} comes on` : 'a mood comes on') : `${groupName(arrive.targetId) ?? 'the whole home'} turns on`
        }.`;
  const ready = !!s.home && (which === 'leave' || !moodMode || !!pickedMood);

  return (
    <ModalSheet visible title={which === 'arrive' ? 'Arriving home' : 'Leaving home'} onClose={onClose}>
      <View style={{ gap: 6 }}>
        <ApproachArt leaving={which === 'leave'} />
        <Display size={22} weight={300} style={{ lineHeight: 29 }}>
          {sentence}
        </Display>
      </View>

      <HomeBlock home={s.home} locating={locating} onHere={setHere} onRadius={(radius) => setS((x) => ({ ...x, home: x.home && { ...x.home, radius } }))} />
      {error && (
        <Txt size={13} tone="champagne">
          {error}
        </Txt>
      )}

      {which === 'arrive' ? (
        <>
          <Block label="What happens">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Choice label="Lights on" chosen={!moodMode} onPress={() => setMoodMode(false)} />
              <Choice label="A mood" chosen={moodMode} onPress={() => setMoodMode(true)} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
              {moodMode ? (
                moods.length ? (
                  moods.map((m) => <Choice key={m.id} label={moodLabel(m)} dashed chosen={arrive.moodId === m.id} onPress={() => setArrive({ moodId: m.id })} />)
                ) : (
                  <Txt size={13} tone="muted" style={{ paddingVertical: 12 }}>
                    No moods yet: make one on the Moods tab.
                  </Txt>
                )
              ) : (
                [
                  <Choice key="home" label="Whole home" dashed chosen={!arrive.targetId} onPress={() => setArrive({ targetId: null })} />,
                  ...groups.map((g) => <Choice key={g.id} label={g.name} dashed chosen={arrive.targetId === g.id} onPress={() => setArrive({ targetId: g.id })} />),
                ]
              )}
            </ScrollView>
          </Block>

          <Block label="When">
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Choice label="Any time" chosen={when === 'any'} onPress={() => setArrive({ afterSunset: false, hours: null })} />
              <Choice label="After sunset" chosen={when === 'sunset'} onPress={() => setArrive({ afterSunset: true, hours: null })} />
              <Choice label="Between…" chosen={when === 'hours'} onPress={() => setArrive({ afterSunset: false, hours: arrive.hours ?? [clock(17), clock(2)] })} />
            </View>
            {when === 'sunset' && (
              <Txt size={12} tone="muted">
                {sun ? `Today from ${fmtClock(sun.set)} until sunrise at ${fmtClock(sun.rise)}.` : 'From sunset until sunrise.'}
              </Txt>
            )}
            {when === 'hours' && arrive.hours && (
              <View style={{ gap: 2, marginTop: 4 }}>
                <HoursRow label="From" value={arrive.hours[0]} onChange={(v) => setArrive({ hours: [v, arrive.hours![1]] })} />
                <HoursRow label="Until" value={arrive.hours[1]} onChange={(v) => setArrive({ hours: [arrive.hours![0], v] })} />
              </View>
            )}
          </Block>
        </>
      ) : (
        <Txt size={13} tone="secondary">
          Every light and plug in the home turns off, wherever it was turned on from.
        </Txt>
      )}

      <View style={{ gap: 6 }}>
        <Txt size={12} tone="muted">
          Uses your phone’s location: expect 1 to 3 minutes of delay.
        </Txt>
        {notices === false && wasOn ? (
          <>
            <Txt size={12} tone="champagne">
              Notifications are off for Glim: you won’t see when it runs.
            </Txt>
            <PillButton title="Allow notifications" kind="text" height={36} onPress={async () => setNotices(await askNotifications(true))} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : (
          <Txt size={12} tone="muted">
            {which === 'arrive' ? 'A notification says what it did each time, with a button to put the lights back.' : 'A notification says which lights went off, with a button to turn them back on.'}
          </Txt>
        )}
      </View>
      <PillButton
        title={!s.home ? 'Set your home first' : moodMode && which === 'arrive' && !pickedMood ? 'Pick a mood' : wasOn ? 'Save' : 'Turn on'}
        kind="primary"
        disabled={!ready}
        onPress={confirm}
      />
      {wasOn && <PillButton title="Turn off" kind="text" height={40} onPress={() => onSave(draft(false))} style={{ alignSelf: 'flex-start' }} />}
    </ModalSheet>
  );
}

/** "I'm home now": takes the phone's position. */
function useHere(onPlace: (p: { lat: number; lon: number }) => void, setError: (e: string | null) => void) {
  const [locating, setLocating] = useState(false);
  const setHere = async () => {
    setLocating(true);
    setError(null);
    try {
      const p = await hereNow();
      onPlace({ lat: p.lat, lon: p.lon });
    } catch (e) {
      const off = String((e as Error)?.message ?? '').startsWith('Location is off');
      setError(off ? 'Location is off for Glim: allow it to set your home.' : 'Couldn’t get your position. Try again by a window.');
    } finally {
      setLocating(false);
    }
  };
  return { locating, setHere };
}

/**
 * Settings → Home location: where home is and how far around it counts, set right there (the
 * same block as in the Arriving and Leaving home sheets).
 */
export function HomeSheet({ initial, onSave, onClose }: { initial: HomeArea | null; onSave: (home: HomeArea) => void; onClose: () => void }) {
  const [home, setHome] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const { locating, setHere } = useHere((p) => setHome((h) => ({ ...p, radius: h?.radius ?? 150 })), setError);
  const changed = !!home && (home.lat !== initial?.lat || home.lon !== initial?.lon || home.radius !== initial?.radius);
  return (
    <ModalSheet visible title="Home location" onClose={onClose}>
      <ApproachArt />
      <Txt size={14} tone="secondary">
        Arriving and Leaving home watch a circle around your home. Its place stays on this phone.
      </Txt>
      <HomeBlock home={home} locating={locating} onHere={setHere} onRadius={(radius) => setHome((h) => h && { ...h, radius })} />
      {error && (
        <Txt size={13} tone="champagne">
          {error}
        </Txt>
      )}
      <PillButton title={home ? 'Save' : 'Set your home first'} kind="primary" disabled={!changed} onPress={() => home && onSave(home)} />
    </ModalSheet>
  );
}

/** Where home is: the phone's position, set while there, and how far around it counts. */
function HomeBlock({ home, locating, onHere, onRadius }: { home: HomeArea | null; locating: boolean; onHere: () => void; onRadius: (r: number) => void }) {
  const radii = home && !RADII.includes(home.radius) ? [...RADII, home.radius].sort((a, b) => a - b) : RADII;
  return (
    <Block label="Home">
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: hairline(home ? 0.1 : 0.24), borderStyle: home ? 'solid' : 'dashed', padding: 16, gap: 10 }}>
        {home ? (
          <>
            <Txt size={14}>Home is set. Counts as home within:</Txt>
            <NumberTabs values={radii} value={home.radius} onChange={onRadius} unit="m" />
            <PillButton title={locating ? 'Finding you…' : 'Moved? Set it here again'} kind="text" icon="location" height={36} disabled={locating} onPress={onHere} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : (
          <>
            <Txt size={14} tone="secondary">
              Glim needs to know where home is. Do it while you’re there.
            </Txt>
            <PillButton title={locating ? 'Finding you…' : 'I’m home now'} icon="location" height={44} disabled={locating} onPress={onHere} style={{ alignSelf: 'flex-start' }} />
          </>
        )}
      </View>
    </Block>
  );
}

function HoursRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Label size={9} style={{ width: 44 }}>
        {label}
      </Label>
      <TimePicker value={value} onChange={onChange} label={`Active ${label.toLowerCase()}`} />
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: hairline(0.2), alignItems: 'center', justifyContent: 'center' }}>
        <Txt size={12} tone="champagne">
          {String(n)}
        </Txt>
      </View>
      <Txt size={14}>{text}</Txt>
    </View>
  );
}

/** The phone crossing the rings around home: coming in, or (leaving) heading away. */
function ApproachArt({ leaving }: { leaving?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={300} height={120} viewBox="0 15 300 120">
        {[64, 44, 24].map((r, i) => (
          <Circle key={r} cx={200} cy={75} r={r} stroke={i === 0 ? 'rgba(233,207,159,0.5)' : hairline(0.14)} strokeWidth={1} strokeDasharray={i === 0 ? '2 4' : undefined} fill="none" />
        ))}
        <Circle cx={200} cy={75} r={34} fill="#FFC27A" fillOpacity={leaving ? 0.04 : 0.12} />
        <Path d="M193 82v-9l7-5.5 7 5.5v9Z" stroke={color.ivory} strokeWidth={1.3} fill="#FFC27A" fillOpacity={leaving ? 0.05 : 0.25} strokeLinejoin="round" />
        <Path d="M30 120C70 110 100 95 136 80" stroke={color.champagne} strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="3 5" fill="none" strokeLinecap="round" />
        <Circle cx={leaving ? 30 : 136} cy={leaving ? 120 : 80} r={4} fill={color.champagne} />
      </Svg>
    </View>
  );
}
