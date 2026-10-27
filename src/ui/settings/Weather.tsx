import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { clockHourFor, DEFAULT_SUN, MOMENTS, WEATHER_KINDS, type WeatherKind } from '../../lib/weather/sky';
import {
  forgetHomeLocation,
  loadHomeLocation,
  refreshLiveWeather,
  saveHomeLocation,
  saveWeatherSettings,
  useOutside,
  weatherLabel,
  type HomeLocation,
  type WeatherSettings,
} from '../../lib/weather/source';
import { PillButton, Rule, Section, Slider, Switch, TagButton } from '../controls';
import { Label, Txt } from '../text';
import { color, font, hairline } from '../theme';
import { refreshAllWidgets } from '../../widgets/task-handler';

const KIND_LABEL: Record<WeatherKind, string> = { clear: 'Clear', cloudy: 'Cloudy', fog: 'Fog', rain: 'Rain', storm: 'Storm', snow: 'Snow' };

/**
 * Settings → Outside and Weather control: the real weather at home (location saved once), and
 * forcing a weather or a time of day to try every sky on the map and the widgets.
 */
export function Weather() {
  const { settings, live, outside } = useOutside();
  const [home, setHome] = useState<HomeLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadHomeLocation().then(setHome);
    }, []),
  );

  const set = async (patch: Partial<WeatherSettings>) => {
    await saveWeatherSettings(patch);
    refreshAllWidgets().catch(() => null);
  };

  const locate = async () => {
    setLocating(true);
    setNote(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setNote('Location is off for Glim. You can allow it in Android settings, or keep the weather set by hand.');
        return;
      }
      const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      setHome(await saveHomeLocation(pos.coords.latitude, pos.coords.longitude));
      refreshAllWidgets().catch(() => null);
    } catch {
      setNote('Couldn’t get a location. Try again in a moment.');
    } finally {
      setLocating(false);
    }
  };

  if (!settings) return null;
  const sun = live?.sun ?? DEFAULT_SUN;
  const forced = settings.weather !== 'live' || settings.time !== 'live';
  const hour = typeof settings.time === 'number' ? settings.time : (outside?.clock ?? 12);

  return (
    <>
      <Section title="Outside">
        <Row title="Weather on the map" sub="The sky and the weather around your home, in the app and on the map widget.">
          <Switch on={settings.outside} onToggle={() => set({ outside: !settings.outside })} label="Weather on the map" />
        </Row>
        <Rule />
        {home ? (
          <Row
            title={live ? `${weatherLabel(live.kind, live.isDay, live.code)} · ${live.temp}°` : 'Live weather'}
            sub={live ? `At home, updated ${clock(live.at)}` : 'Fetching the weather at home…'}
          >
            <TagButton title="Update" icon="rotate" onPress={() => refreshLiveWeather(true).then(() => refreshAllWidgets().catch(() => null))} />
          </Row>
        ) : (
          <View style={{ gap: 12, paddingVertical: 6 }}>
            <Txt tone="secondary" size={14}>
              Show the real weather at home: Glim needs to know roughly where your home is, once.
            </Txt>
            <PillButton title={locating ? 'Locating…' : 'Use this phone’s location'} icon="location" kind="primary" height={44} disabled={locating} onPress={locate} style={{ alignSelf: 'flex-start' }} />
          </View>
        )}
        {note && <Txt size={13} tone="champagne">{note}</Txt>}
        <Txt size={12} tone="muted">
          Saved for this home, rounded to about 1 km. Weather data by Open-Meteo.com (CC BY 4.0).
          {home ? ' ' : ''}
          {home && (
            <Text
              onPress={async () => {
                await forgetHomeLocation();
                setHome(null);
                refreshAllWidgets().catch(() => null);
              }}
              style={{ color: color.secondary, textDecorationLine: 'underline' }}
            >
              Forget location
            </Text>
          )}
        </Txt>
      </Section>

      <Section title="Weather control" right={forced ? <TagButton title="Back to live" icon="undo" onPress={() => set({ weather: 'live', time: 'live' })} /> : undefined}>
        <Txt size={13} tone="muted">
          Try any sky on the map and the widgets. Set by hand until you go back to live.
        </Txt>
        <Label style={{ marginTop: 6 }}>Weather</Label>
        <Chips>
          <Chip label="Live" on={settings.weather === 'live'} onPress={() => set({ weather: 'live' })} />
          {WEATHER_KINDS.map((k) => (
            <Chip key={k} label={KIND_LABEL[k]} on={settings.weather === k} onPress={() => set({ weather: k })} />
          ))}
        </Chips>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
          <Label>Time of day</Label>
          <Text style={{ fontFamily: font.display, fontSize: 24, color: color.ivory, fontVariant: ['tabular-nums'] }}>
            {settings.time === 'cycle' ? 'A day a minute' : hhmm(hour)}
          </Text>
        </View>
        <Chips>
          <Chip label="Live" on={settings.time === 'live'} onPress={() => set({ time: 'live' })} />
          <Chip label="A day in a minute" on={settings.time === 'cycle'} onPress={() => set({ time: 'cycle' })} />
          {MOMENTS.map((m) => {
            const h = Math.round(clockHourFor(m.design, sun) * 4) / 4;
            return <Chip key={m.label} label={m.label} on={settings.time === h} onPress={() => set({ time: h })} />;
          })}
        </Chips>
        <Slider
          value={Math.round(hour * 4)}
          min={0}
          max={95}
          tint={color.champagne}
          ground={color.ground}
          label="Time of day"
          onCommit={(q) => set({ time: q / 4 })}
        />
      </Section>

    </>
  );
}

function Row({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt>{title}</Txt>
        {sub ? (
          <Txt size={12} tone="muted">
            {sub}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        height: 44,
        paddingHorizontal: 16,
        borderRadius: 22,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: on ? color.champagne : hairline(0.16),
        backgroundColor: on ? color.champagne : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: font.ui, fontSize: 13, color: on ? color.onChampagne : color.ivory }}>{label}</Text>
    </Pressable>
  );
}

const hhmm = (h: number) => {
  const m = Math.round(h * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
