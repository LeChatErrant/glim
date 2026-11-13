import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { Snapshot } from '../../lib/hue/client';
import type { Mood } from '../../lib/moods';
import { askLocationAccess, hereNow, locationAccess } from '../../lib/rituals/arrive';
import type { RitualSettings } from '../../lib/rituals/store';
import { sunTimes } from '../../lib/rituals/sun';
import { clock, fmtClock } from '../../lib/rituals/time';
import { PillButton, Slider } from '../controls';
import { ModalSheet } from '../ModalSheet';
import { Choice } from '../scan/parts';
import { Label, Txt } from '../text';
import { color, hairline } from '../theme';
import { Block, SwitchRow, TimePicker } from './parts';

/**
 * Arriving and leaving home: where home is (the phone's position when you're there) and how far
 * around it counts, what arriving does (a mood, or lights on), only after sunset, active hours;
 * leaving turns everything off. Starts with the location permission moment when needed.
 */
export function ArriveSheet({
  initial,
  snapshot,
  moods,
  onSave,
  onClose,
}: {
  initial: RitualSettings;
  snapshot: Snapshot | null;
  moods: Mood[];
  onSave: (s: Pick<RitualSettings, 'home' | 'arrive' | 'leave'>) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState({ home: initial.home, arrive: initial.arrive, leave: initial.leave });
  const [access, setAccess] = useState<'all' | 'foreground' | 'none' | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const arrive = s.arrive;
  const setArrive = (c: Partial<typeof arrive>) => setS((x) => ({ ...x, arrive: { ...x.arrive, ...c } }));

  useEffect(() => {
    locationAccess().then(setAccess);
  }, []);

  const ask = async () => {
    setError(null);
    const a = await askLocationAccess().catch(() => 'none' as const);
    setAccess(a);
    if (a !== 'all') setError(a === 'foreground' ? 'Choose “Allow all the time” so it works with the app closed.' : 'Location is off for Glim.');
  };

  const setHere = async () => {
    setLocating(true);
    setError(null);
    try {
      const p = await hereNow();
      setS((x) => ({ ...x, home: { lat: p.lat, lon: p.lon, radius: x.home?.radius ?? 150 } }));
    } catch {
      setError("Couldn't get your position. Try again by a window.");
    } finally {
      setLocating(false);
    }
  };

  if (access === null) {
    return (
      <ModalSheet visible title="Arriving home" onClose={onClose}>
        <ActivityIndicator color={color.champagne} />
      </ModalSheet>
    );
  }

  if (access !== 'all') {
    return (
      <ModalSheet visible title="Let your home know you’re near" onClose={onClose}>
        <ApproachArt />
        <Txt size={14} tone="secondary">
          Arriving and leaving need location access{' '}
          <Txt size={14} tone="ivory">
            all the time
          </Txt>
          , so they work when the app is closed. Your location stays on your phone and is only used to know if you’re home.
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
        <PillButton title="Not now" kind="text" onPress={onClose} />
      </ModalSheet>
    );
  }

  const sun = s.home ? sunTimes(s.home.lat, s.home.lon) : null;
  const moodLabel = (m: Mood) => m.name;
  const groups = [...(snapshot?.rooms ?? []), ...(snapshot?.zones ?? [])].filter((g) => g.lightIds.length);

  return (
    <ModalSheet visible title="Arriving home" onClose={onClose}>
      <Block label="Home">
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: hairline(0.1), padding: 16, gap: 10 }}>
          <Txt size={14} tone={s.home ? 'ivory' : 'secondary'}>
            {s.home ? `Set · ${s.home.radius} m around it` : 'Not set yet. Do it while you’re home.'}
          </Txt>
          <PillButton title={locating ? 'Finding you…' : s.home ? 'I’m home: set it here again' : 'I’m home: set it here'} icon="location" height={44} disabled={locating} onPress={setHere} style={{ alignSelf: 'flex-start' }} />
        </View>
      </Block>
      {s.home && (
        <Block label={`Radius · ${s.home.radius} m`}>
          <Slider value={s.home.radius} min={50} max={500} tint={color.champagne} ground={color.sheet} label="Radius around home" onChange={(radius) => setS((x) => ({ ...x, home: { ...x.home!, radius: Math.round(radius / 10) * 10 } }))} onCommit={(radius) => setS((x) => ({ ...x, home: { ...x.home!, radius: Math.round(radius / 10) * 10 } }))} />
        </Block>
      )}
      {error && (
        <Txt size={13} tone="champagne">
          {error}
        </Txt>
      )}
      <SwitchRow title="When I arrive" sub="Turn lights on as you get home" on={arrive.enabled} onToggle={() => setArrive({ enabled: !arrive.enabled })} />
      {arrive.enabled && (
        <>
          <Block label="Mood">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
              <Choice label="Just turn lights on" chosen={!arrive.moodId} onPress={() => setArrive({ moodId: null })} />
              {moods.map((m) => (
                <Choice key={m.id} label={moodLabel(m)} chosen={arrive.moodId === m.id} onPress={() => setArrive({ moodId: m.id })} />
              ))}
            </ScrollView>
          </Block>
          {!arrive.moodId && (
            <Block label="Which lights">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                <Choice label="Whole home" chosen={!arrive.targetId} onPress={() => setArrive({ targetId: null })} />
                {groups.map((g) => (
                  <Choice key={g.id} label={g.name} chosen={arrive.targetId === g.id} onPress={() => setArrive({ targetId: g.id })} />
                ))}
              </ScrollView>
            </Block>
          )}
          <SwitchRow
            title="Only after sunset"
            sub={sun ? `Sunset today at ${fmtClock(sun.set)}` : 'Set your home first'}
            on={arrive.afterSunset}
            onToggle={() => setArrive({ afterSunset: !arrive.afterSunset })}
          />
          <SwitchRow
            title="Active hours"
            sub={arrive.hours ? `${fmtClock(arrive.hours[0])} – ${fmtClock(arrive.hours[1])}` : 'Any time'}
            on={!!arrive.hours}
            onToggle={() => setArrive({ hours: arrive.hours ? null : [clock(17), clock(2)] })}
          />
          {arrive.hours && (
            <View style={{ gap: 4 }}>
              <Label size={9}>From</Label>
              <TimePicker value={arrive.hours[0]} onChange={(v) => setArrive({ hours: [v, arrive.hours![1]] })} label="Active from" />
              <Label size={9}>Until</Label>
              <TimePicker value={arrive.hours[1]} onChange={(v) => setArrive({ hours: [arrive.hours![0], v] })} label="Active until" />
            </View>
          )}
        </>
      )}
      <Label size={9} tone="label" style={{ marginTop: 8 }}>
        Leaving home
      </Label>
      <SwitchRow title="Turn everything off" sub="When you leave the circle around home" on={s.leave.enabled} onToggle={() => setS((x) => ({ ...x, leave: { enabled: !x.leave.enabled } }))} />
      <Txt size={12} tone="muted">
        Uses your phone’s location. Expect 1 to 3 minutes of delay.
      </Txt>
      <PillButton title="Save" kind="primary" disabled={!s.home && (arrive.enabled || s.leave.enabled)} onPress={() => onSave(s)} />
    </ModalSheet>
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

/** The phone approaching home, crossing the rings around it. */
function ApproachArt() {
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={300} height={150} viewBox="0 0 300 150">
        {[64, 44, 24].map((r, i) => (
          <Circle key={r} cx={200} cy={75} r={r} stroke={i === 0 ? 'rgba(233,207,159,0.5)' : hairline(0.14)} strokeWidth={1} strokeDasharray={i === 0 ? '2 4' : undefined} fill="none" />
        ))}
        <Circle cx={200} cy={75} r={34} fill="#FFC27A" fillOpacity={0.12} />
        <Path d="M193 82v-9l7-5.5 7 5.5v9Z" stroke={color.ivory} strokeWidth={1.3} fill="#FFC27A" fillOpacity={0.25} strokeLinejoin="round" />
        <Path d="M30 120C70 110 100 95 136 80" stroke={color.champagne} strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="3 5" fill="none" strokeLinecap="round" />
        <Circle cx={136} cy={80} r={4} fill={color.champagne} />
      </Svg>
    </View>
  );
}
