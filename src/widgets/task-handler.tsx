import { getWidgetInfo, requestWidgetUpdateById, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { planAll, planToggleLight, planToggleRoom, type Planned } from '../lib/actions';
import { getBridge } from '../lib/hue/bridge';
import { cachedSnapshot, fetchSnapshot, saveCachedSnapshot, type Snapshot } from '../lib/hue/client';
import { planScene } from '../lib/hueMoods';
import { loadMap } from '../lib/map/map';
import { loadMoods, planLights } from '../lib/moods';
import { ensureSleepPool, findSleepRun } from '../lib/rituals/sleepNow';
import { syncTile } from '../lib/tile';
import { outsideNow } from '../lib/weather/source';
import { weatherIcon } from '../ui/icons';
import { sendMapOutside } from './outside';
import { defaultItems, forgetMoodsWidgetSettings, isShowing, loadMoodsWidgetSettings, moodButtons, type MoodButton } from './moodButtons';
import { forgetWidgetSettings, loadWidgetSettings, widgetPlan } from './settings';
import { defaultTiles, forgetTilesWidgetSettings, loadTilesWidgetSettings, resolveTiles } from './tiles';
import { GridWidget, LightWidget, MapWidget, MoodsWidget, NotPaired, RoomsWidget } from './widgets';

export const WIDGET_NAMES = ['Rooms', 'Map', 'Moods', 'Light', 'Grid'] as const;

/** A state to draw, and whether it is only the last known one (bridge unreachable). */
export type State = { snapshot: Snapshot | null; stale: boolean };

/**
 * Lights just switched from a widget, and until when to show them that way. The bridge reports a
 * room's lights one by one, and a redraw in between flashed some of them back to their old state.
 */
const expected = new Map<string, { on: boolean; until: number }>();
/** How long a tapped state is trusted over what the bridge says. */
const HOLD_MS = 4000;

function withExpected(snapshot: Snapshot | null): Snapshot | null {
  if (!snapshot) return snapshot;
  const now = Date.now();
  for (const [id, e] of expected) if (e.until <= now) expected.delete(id);
  if (!expected.size) return snapshot;
  return { ...snapshot, lights: snapshot.lights.map((l) => (expected.has(l.id) ? { ...l, on: expected.get(l.id)!.on } : l)) };
}

/**
 * The mood just tapped on a Moods widget, shown as on while the bridge catches up (lights report
 * one by one, so the real state only matches the mood after a moment).
 */
let tappedMood: { key: string; until: number; off?: boolean } | null = null;

/** The sleep fade running now, read at most every 10 s: every redraw of a widget with a moon button needs it. */
let sleepRun: { at: number; targets: string[] | null } | null = null;
async function fadingNow(): Promise<string[] | null> {
  if (!sleepRun || Date.now() - sleepRun.at > 10_000) sleepRun = { at: Date.now(), targets: (await findSleepRun().catch(() => null))?.targets ?? null };
  return sleepRun.targets;
}

/** The buttons a Moods widget shows, for this state. */
async function widgetMoodButtons(info: Pick<WidgetInfo, 'widgetId' | 'widgetName'>, snapshot: Snapshot): Promise<MoodButton[]> {
  const [moods, map, settings] = await Promise.all([loadMoods(), loadMap(), loadMoodsWidgetSettings(info.widgetId)]);
  return moodButtons(settings.items ?? defaultItems(moods), moods, snapshot, map);
}

/** Mood buttons as drawn: each shows as on while the lights look like it (or just after its tap). */
async function shownMoodButtons(info: Pick<WidgetInfo, 'widgetId' | 'widgetName'>, snapshot: Snapshot | null, stale: boolean) {
  if (!snapshot) return [];
  const held = tappedMood && tappedMood.until > Date.now() ? tappedMood : null;
  const list = await widgetMoodButtons(info, snapshot);
  // Sleep fade buttons: the bridge has what a tap changes, and they show while a fade runs.
  const sleepTargets = list.flatMap((b) => b.sleep?.targets ?? []);
  let fading: string[] | null = null;
  if (sleepTargets.length && !stale) {
    ensureSleepPool(snapshot, sleepTargets).catch((e) => console.warn('Sleep fade button', e));
    fading = await fadingNow();
  }
  // Just tapped: that button is shown on (or off, a sleep fade stopped), the others as they are.
  const showing = (b: MoodButton) => (!held ? isShowing(snapshot, b, fading) : held.off ? b.key !== held.key && isShowing(snapshot, b, fading) : b.key === held.key);
  return list.map((b) => ({ ...b, showing: showing(b) }));
}

/**
 * What each widget drew last, and when. Every redraw makes a widget flicker, and one tap brings
 * several (the tap itself, then each burst of bridge events): a redraw identical to one made in
 * the last few seconds is skipped. Only recent ones, in case another JS runtime drew in between.
 */
const drawn = new Map<number, { key: string; at: number }>();
const SAME_MS = 15_000;

/** A stable text for what a widget would show (floats rounded, so the outside's clock doesn't count every second). */
function drawKey(info: WidgetInfo, parts: unknown) {
  return `${info.widgetName}|${info.width}x${info.height}|${JSON.stringify(parts, (_, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v))}`;
}

/** Whether a widget already shows this; remembers it as drawn otherwise. `force` always draws. */
function alreadyDrawn(info: WidgetInfo, key: string, force: boolean) {
  const last = drawn.get(info.widgetId);
  const now = Date.now();
  if (!force && last && last.key === key && now - last.at < SAME_MS) return true;
  drawn.set(info.widgetId, { key, at: now });
  return false;
}

/** The snapshot as drawn: without the fetch time, which only shows when stale. */
const shown = (s: Snapshot | null, stale: boolean) => s && { ...s, fetchedAt: stale ? s.fetchedAt : 0 };

/**
 * The widget to draw, or null when `force` is off and the widget already shows exactly this.
 */
export async function render(info: WidgetInfo, state: State, force = true) {
  const stale = state.stale;
  const snapshot = withExpected(state.snapshot);
  if (!(await getBridge())) return alreadyDrawn(info, drawKey(info, 'unpaired'), force) ? null : <NotPaired />;
  if (info.widgetName === 'Map') {
    const map = await loadMap();
    const settings = await loadWidgetSettings(info.widgetId);
    const plan = widgetPlan(map, settings);
    const outside = await outsideNow();
    const background = settings.background ?? 'black';
    if (alreadyDrawn(info, drawKey(info, [shown(snapshot, stale), stale, plan, settings, outside]), force)) return null;
    // The outside lands under the image the library is about to draw; native code waits for it.
    sendMapOutside(info, plan, snapshot?.lights ?? [], outside, background).catch((e) => console.warn('Map widget outside', e));
    const weather = outside && { icon: weatherIcon(outside.sky), text: outside.temp !== null ? `${outside.temp}°` : outside.label, temp: outside.temp !== null };
    return (
      <MapWidget
        snapshot={snapshot}
        plan={plan}
        width={info.width}
        height={info.height}
        stale={stale}
        outside={!!outside}
        background={background}
        weather={weather}
      />
    );
  }
  if (info.widgetName === 'Moods') {
    const buttons = await shownMoodButtons(info, snapshot, stale);
    if (alreadyDrawn(info, drawKey(info, [shown(snapshot, stale), stale, buttons.map((b) => [b.key, b.name, b.dots, b.glyph ?? null, b.showing])]), force)) return null;
    return <MoodsWidget snapshot={snapshot} buttons={buttons} width={info.width} height={info.height} stale={stale} />;
  }
  if (info.widgetName === 'Light' || info.widgetName === 'Grid') {
    const settings = await loadTilesWidgetSettings(info.widgetId);
    // A Light widget shows its one item; with none picked (or it was deleted), it asks to be set up.
    const items = settings.items ?? (info.widgetName === 'Grid' && snapshot ? defaultTiles(snapshot) : []);
    const tiles = snapshot ? resolveTiles(items, snapshot) : [];
    if (alreadyDrawn(info, drawKey(info, [shown(snapshot, stale), stale, items]), force)) return null;
    return info.widgetName === 'Light' ? (
      <LightWidget snapshot={snapshot} tile={tiles[0] ?? null} width={info.width} height={info.height} stale={stale} />
    ) : (
      <GridWidget snapshot={snapshot} tiles={tiles} width={info.width} height={info.height} stale={stale} />
    );
  }
  if (alreadyDrawn(info, drawKey(info, [shown(snapshot, stale), stale]), force)) return null;
  return <RoomsWidget snapshot={snapshot} width={info.width} height={info.height} stale={stale} />;
}

async function fresh(): Promise<State> {
  try {
    return { snapshot: await fetchSnapshot(), stale: false };
  } catch {
    // Neither the bridge nor Hue's cloud answered: keep showing the last known state, muted.
    return { snapshot: await cachedSnapshot(), stale: true };
  }
}

/** Re-renders every placed widget that would change. Called by the app after it changes lights. */
export async function refreshAllWidgets(snapshot?: Snapshot | null, stale = false) {
  const state: State = { snapshot: snapshot === undefined ? await cachedSnapshot() : snapshot, stale };
  // The Quick Settings tile's requests follow the lights (and a paired bridge) too.
  syncTile(state.snapshot);
  for (const widgetName of WIDGET_NAMES) {
    for (const info of await getWidgetInfo(widgetName)) {
      const widget = await render(info, state, false);
      if (widget) await requestWidgetUpdateById({ widgetName, widgetId: info.widgetId, renderWidget: () => widget });
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;

  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_RESIZED': {
      const first = await render(widgetInfo, { snapshot: await cachedSnapshot(), stale: false });
      if (first) renderWidget(first);
      const widget = await render(widgetInfo, await fresh(), false);
      if (widget) renderWidget(widget);
      break;
    }
    // Periodic, or live sync saw a change on the bridge: draw the fresh state, if it changed.
    case 'WIDGET_UPDATE': {
      const widget = await render(widgetInfo, await fresh(), false);
      if (widget) renderWidget(widget);
      break;
    }
    case 'WIDGET_CLICK': {
      const cached = await cachedSnapshot();
      const data = clickActionData ?? {};
      const target = data.target === 'on' ? true : data.target === 'off' ? false : undefined;
      // FAST_* taps were already sent to the bridge by the native provider; only redraw.
      const fast = clickAction?.startsWith('FAST_') ?? false;
      let plan: Planned | null = null;
      if (cached && clickAction?.endsWith('TOGGLE_LIGHT') && typeof data.lightId === 'string') {
        plan = planToggleLight(cached, data.lightId, target);
      } else if (cached && clickAction?.endsWith('TOGGLE_ROOM') && typeof data.roomId === 'string') {
        plan = planToggleRoom(cached, data.roomId, target);
      } else if (cached && clickAction?.endsWith('TOGGLE_ALL') && target !== undefined) {
        plan = planAll(cached, target);
      } else if (cached && clickAction?.endsWith('APPLY_MOOD') && typeof data.moodKey === 'string') {
        const b = (await widgetMoodButtons(widgetInfo, cached)).find((x) => x.key === data.moodKey);
        const scene = b?.scene && cached.scenes?.find((x) => x.id === b.scene);
        if (b?.lights) {
          plan = scene ? planScene(cached, scene) : planLights(cached, b.lights);
          tappedMood = { key: b.key, until: Date.now() + HOLD_MS };
        }
      }
      if (clickAction?.endsWith('TOGGLE_ALL') && target === false) tappedMood = { key: 'off', until: Date.now() + HOLD_MS };
      // A sleep fade button: shown on (or off) while native code tells the bridge.
      if (clickAction === 'FAST_SLEEP' && typeof data.moodKey === 'string') tappedMood = { key: data.moodKey, until: Date.now() + HOLD_MS };
      if (clickAction === 'FAST_SLEEP_STOP' && typeof data.moodKey === 'string') tappedMood = { key: data.moodKey, until: Date.now() + HOLD_MS, off: true };
      // A sleep fade started or stopped: read it again once the bridge has it.
      if (clickAction?.startsWith('FAST_SLEEP')) sleepRun = null;
      if (plan) {
        const until = Date.now() + HOLD_MS;
        for (const l of plan.next.lights) if (cached?.lights.find((c) => c.id === l.id)?.on !== l.on) expected.set(l.id, { on: l.on, until });
        const sent = fast ? Promise.resolve() : plan.send().catch(() => null);
        const widget = await render(widgetInfo, { snapshot: plan.next, stale: false }, false);
        if (widget) renderWidget(widget);
        await Promise.all([sent, saveCachedSnapshot(plan.next)]);
      }
      // Bring every widget to the real state, so they stay consistent.
      const state = await fresh();
      await refreshAllWidgets(state.snapshot, state.stale);
      if (plan || clickAction?.startsWith('FAST_SLEEP')) {
        // Once the tapped state is no longer held, show what the bridge really did (a light that
        // didn't answer goes back), if that differs.
        await sleep(HOLD_MS + 200);
        if (clickAction?.startsWith('FAST_SLEEP')) sleepRun = null;
        const settled = await fresh();
        await refreshAllWidgets(settled.snapshot, settled.stale);
      }
      break;
    }
    case 'WIDGET_DELETED':
      await Promise.all([
        forgetWidgetSettings(widgetInfo.widgetId),
        forgetMoodsWidgetSettings(widgetInfo.widgetId),
        forgetTilesWidgetSettings(widgetInfo.widgetId),
      ]);
      break;
    default:
      break;
  }
}
