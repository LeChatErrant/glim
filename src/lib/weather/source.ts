import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { getBridge } from '../hue/bridge';
import { DEFAULT_SUN, skyAt, type Sky, type SunTimes, type WeatherKind } from './sky';

// Where the outside comes from: the real weather at home (Open-Meteo, no key, home location
// saved once per bridge), unless Settings forces a weather or a time of day.

export type TimeSetting = 'live' | 'cycle' | number;

export type WeatherSettings = {
  /** Off: the map and widgets go back to the plain dark ground. */
  outside: boolean;
  weather: 'live' | WeatherKind;
  /** 'live' = the real clock; 'cycle' = a whole day every minute; a number = that clock hour. */
  time: TimeSetting;
};

export type HomeLocation = { lat: number; lon: number; at: number };

export type LiveWeather = { kind: WeatherKind; code: number; temp: number; isDay: boolean; sun: SunTimes; at: number };

export type Outside = {
  sky: Sky;
  /** "Light rain", "Clear night"... */
  label: string;
  temp: number | null;
  /** Clock hour shown (forced or real). */
  clock: number;
  forcedWeather: boolean;
  forcedTime: boolean;
};

const SETTINGS_KEY = 'weather-settings';
const DEFAULTS: WeatherSettings = { outside: true, weather: 'live', time: 'live' };
/** Live weather older than this is fetched again. */
const STALE_MS = 20 * 60 * 1000;
/** "A day in a minute". */
const CYCLE_MS = 60 * 1000;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export async function loadWeatherSettings(): Promise<WeatherSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WeatherSettings>) } : DEFAULTS;
}

export async function saveWeatherSettings(patch: Partial<WeatherSettings>) {
  const next = { ...(await loadWeatherSettings()), ...patch };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  changed();
  return next;
}

async function bridgeKey(prefix: string) {
  const bridge = await getBridge();
  return `${prefix}:${bridge?.id ?? ''}`;
}

export async function loadHomeLocation(): Promise<HomeLocation | null> {
  const raw = await AsyncStorage.getItem(await bridgeKey('home-location'));
  return raw ? (JSON.parse(raw) as HomeLocation) : null;
}

/** Saves where the home is (once: the home doesn't move) and fetches its weather. */
export async function saveHomeLocation(lat: number, lon: number) {
  // Two decimals (~1 km) is plenty for the weather and keeps less of the user's location.
  const loc: HomeLocation = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, at: Date.now() };
  await AsyncStorage.setItem(await bridgeKey('home-location'), JSON.stringify(loc));
  await refreshLiveWeather(true);
  changed();
  return loc;
}

export async function forgetHomeLocation() {
  await AsyncStorage.multiRemove([await bridgeKey('home-location'), await bridgeKey('weather-now')]);
  changed();
}

export async function cachedLiveWeather(): Promise<LiveWeather | null> {
  const raw = await AsyncStorage.getItem(await bridgeKey('weather-now'));
  return raw ? (JSON.parse(raw) as LiveWeather) : null;
}

/** WMO weather codes (Open-Meteo) to our kinds. */
export function kindForCode(code: number): WeatherKind {
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'rain';
}

const hoursOf = (iso: string) => {
  const m = /T(\d\d):(\d\d)/.exec(iso);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};

/** Fetches the weather at home when the cached one is old (or `force`). Null without a home location. */
export async function refreshLiveWeather(force = false): Promise<LiveWeather | null> {
  const cached = await cachedLiveWeather();
  if (!force && cached && Date.now() - cached.at < STALE_MS) return cached;
  const loc = await loadHomeLocation();
  if (!loc) return cached;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      '&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1';
    const res = await fetch(url);
    if (!res.ok) return cached;
    const j = (await res.json()) as {
      current: { temperature_2m: number; weather_code: number; is_day: number };
      daily: { sunrise: string[]; sunset: string[] };
    };
    const rise = hoursOf(j.daily.sunrise[0]);
    const set = hoursOf(j.daily.sunset[0]);
    const live: LiveWeather = {
      kind: kindForCode(j.current.weather_code),
      code: j.current.weather_code,
      temp: Math.round(j.current.temperature_2m),
      isDay: j.current.is_day === 1,
      sun: rise !== null && set !== null && set > rise ? { rise, set } : DEFAULT_SUN,
      at: Date.now(),
    };
    await AsyncStorage.setItem(await bridgeKey('weather-now'), JSON.stringify(live));
    return live;
  } catch {
    return cached;
  }
}

const isDayAt = (h: number, sun: SunTimes) => h >= sun.rise && h < sun.set;

export function weatherLabel(kind: WeatherKind, day: boolean, code?: number) {
  switch (kind) {
    case 'clear':
      return day ? 'Sunny' : 'Clear night';
    case 'cloudy':
      return code === 2 ? 'Partly cloudy' : 'Overcast';
    case 'fog':
      return 'Fog';
    case 'rain':
      return code !== undefined && code >= 51 && code <= 57 ? 'Drizzle' : code !== undefined && code >= 80 ? 'Showers' : 'Rain';
    case 'storm':
      return 'Thunderstorm';
    case 'snow':
      return 'Snow';
  }
}

/** The clock hour to draw: real, forced, or racing through a day per minute. */
export function clockHour(time: TimeSetting, now = new Date()) {
  if (time === 'cycle') return ((now.getTime() % CYCLE_MS) / CYCLE_MS) * 24;
  if (typeof time === 'number') return time;
  return now.getHours() + now.getMinutes() / 60;
}

/** What the outside looks like now, or null when it's turned off. Uses cached weather only. */
export function resolveOutside(settings: WeatherSettings, live: LiveWeather | null, now = new Date()): Outside | null {
  if (!settings.outside) return null;
  const sun = live?.sun ?? DEFAULT_SUN;
  const clock = clockHour(settings.time, now);
  const kind = settings.weather === 'live' ? (live?.kind ?? 'clear') : settings.weather;
  const day = isDayAt(clock, sun);
  return {
    sky: skyAt(kind, clock, sun),
    label: weatherLabel(kind, day, settings.weather === 'live' ? live?.code : undefined),
    temp: settings.weather === 'live' && live ? live.temp : null,
    clock,
    forcedWeather: settings.weather !== 'live',
    forcedTime: settings.time !== 'live',
  };
}

/** For widgets: settings and weather (refreshed if old), resolved for now. */
export async function outsideNow(): Promise<Outside | null> {
  const settings = await loadWeatherSettings();
  if (!settings.outside) return null;
  return resolveOutside(settings, await refreshLiveWeather());
}

/**
 * The outside for app screens: follows Settings at once, refreshes the weather when old, and
 * moves with the clock (every second while racing through a day, otherwise every minute).
 */
export function useOutside(active = true) {
  const [settings, setSettings] = useState<WeatherSettings | null>(null);
  const [live, setLive] = useState<LiveWeather | null>(null);
  const [now, setNow] = useState(() => new Date());

  const reload = useCallback(async () => {
    setSettings(await loadWeatherSettings());
    setLive(await cachedLiveWeather());
    setLive(await refreshLiveWeather());
  }, []);

  useEffect(() => {
    // Loads from storage: the state is set once the reads come back, not during the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);

  const cycle = settings?.time === 'cycle';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(new Date()), cycle ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [active, cycle]);

  return { settings, live, outside: settings ? resolveOutside(settings, live, now) : null, reload };
}
