import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { HueHttp } from '../../../modules/hue-http';
import type { Connection } from '../../ui/controls';
import { refreshAllWidgets } from '../../widgets/task-handler';
import type { Planned } from '../actions';
import { cachedSnapshot, fetchSnapshot, saveCachedSnapshot, type Snapshot } from './client';

/**
 * The home as every screen sees it: one shared state, so the map, the rooms, the light screen and
 * the "All off" buttons always agree. Last known state first, then polled from the bridge while a
 * screen is focused, and refreshed at once when the bridge reports a change (live sync).
 */
type State = { snapshot: Snapshot | null; connection: Connection };

let state: State = { snapshot: null, connection: 'home' };
const listeners = new Set<() => void>();
/** Changes sent and not yet confirmed: polls are ignored meanwhile so they don't flicker back. */
let inFlight = 0;
/** Bumped by every change; a poll that started before one is stale and dropped. */
let version = 0;
/** Signature of the light states last drawn on the widgets. */
let drawn = '';
/** Poll intervals asked by the focused screens; the shortest wins. */
const polls: number[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let interval = 0;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const signature = (s: Snapshot) =>
  JSON.stringify([s.lights.map((l) => [l.id, l.on, l.brightness, l.color, l.reachable, l.roomId, l.name, l.archetype]), s.rooms, s.zones]);

cachedSnapshot().then((s) => {
  if (s && !state.snapshot) set({ snapshot: s });
});

export async function refreshHome() {
  const started = version;
  try {
    const s = await fetchSnapshot();
    set({ connection: 'home' });
    if (inFlight || started !== version) return;
    set({ snapshot: s });
    // Something else changed the lights (a switch, another app): bring the widgets along.
    const sig = signature(s);
    if (sig !== drawn) {
      drawn = sig;
      refreshAllWidgets(s).catch(() => null);
    }
  } catch {
    // Cloud access comes later: off the home network, the bridge is out of reach.
    set({ connection: 'offline' });
  }
}

/** Applies a planned change optimistically: screens and widgets update at once, the bridge follows. */
export async function actHome(plan: (s: Snapshot) => Planned | null) {
  const s = state.snapshot ?? (await cachedSnapshot());
  const p = s && plan(s);
  if (!p) return;
  version++;
  inFlight++;
  set({ snapshot: p.next });
  try {
    await saveCachedSnapshot(p.next);
    drawn = signature(p.next);
    refreshAllWidgets(p.next).catch(() => null);
    await p.send();
  } catch {
    set({ connection: 'offline' });
  } finally {
    inFlight--;
  }
  if (!inFlight) await refreshHome();
}

function schedule() {
  const next = polls.length ? Math.min(...polls) : 0;
  if (next === interval) return;
  if (timer) clearInterval(timer);
  timer = next ? setInterval(refreshHome, next) : null;
  if (next && !interval) refreshHome();
  interval = next;
}

function startPolling(ms: number) {
  polls.push(ms);
  schedule();
  return () => {
    polls.splice(polls.indexOf(ms), 1);
    schedule();
  };
}

// The bridge's event stream (native live sync) says something changed.
let subscribed = false;
function listenToBridge() {
  if (subscribed) return;
  subscribed = true;
  // Back from the background: the lights may have changed meanwhile.
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    if (polls.length) refreshHome();
    HueHttp.startLive?.().catch(() => null);
  });
  try {
    HueHttp.addListener('onChange', () => {
      if (polls.length) refreshHome();
    });
    HueHttp.startLive().catch(() => null);
  } catch {
    // Not available (web, tests): polling is enough.
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const get = () => state;

export function useHome(intervalMs = 3000) {
  const { snapshot, connection } = useSyncExternalStore(subscribe, get);

  useEffect(listenToBridge, []);

  useFocusEffect(
    useCallback(() => startPolling(intervalMs), [intervalMs]),
  );

  return { snapshot, connection, act: actHome, refresh: refreshHome };
}
