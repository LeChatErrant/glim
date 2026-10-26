import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { planAll, planToggleLight, planToggleRoom, type Planned } from '../lib/actions';
import { getBridge } from '../lib/hue/bridge';
import { cachedSnapshot, fetchSnapshot, saveCachedSnapshot, type Snapshot } from '../lib/hue/client';
import { loadMap } from '../lib/map/map';
import { forgetWidgetSettings, loadWidgetSettings, saveWidgetSettings, widgetPages, widgetPlan } from './settings';
import { MapWidget, NotPaired, RoomsWidget } from './widgets';

export const WIDGET_NAMES = ['Rooms', 'Map'] as const;

/** A state to draw, and whether it is only the last known one (bridge unreachable). */
export type State = { snapshot: Snapshot | null; stale: boolean };

export async function render(info: WidgetInfo, { snapshot, stale }: State) {
  if (!(await getBridge())) return <NotPaired />;
  if (info.widgetName === 'Map') {
    const map = await loadMap();
    const settings = await loadWidgetSettings(info.widgetId);
    const focus = map?.rooms.find((r) => r.id === settings.focus);
    const hueRoom = focus ? snapshot?.rooms.find((r) => r.id === focus.hueRoomId) : undefined;
    const title = focus ? (hueRoom?.name ?? focus.name) : undefined;
    const plan = widgetPlan(map, settings);
    return <MapWidget snapshot={snapshot} plan={plan} width={info.width} height={info.height} stale={stale} title={title} focusRoom={hueRoom} pager={widgetPages(map, settings).length > 1} />;
  }
  return <RoomsWidget snapshot={snapshot} width={info.width} height={info.height} stale={stale} />;
}

async function fresh(): Promise<State> {
  try {
    return { snapshot: await fetchSnapshot(), stale: false };
  } catch {
    // Off the home network (cloud access comes later): keep showing the last known state, muted.
    return { snapshot: await cachedSnapshot(), stale: true };
  }
}

/** Re-renders every placed widget. Called by the app after it changes lights. */
export async function refreshAllWidgets(snapshot?: Snapshot | null, stale = false) {
  const state: State = { snapshot: snapshot === undefined ? await cachedSnapshot() : snapshot, stale };
  await Promise.all(WIDGET_NAMES.map((widgetName) => requestWidgetUpdate({ widgetName, renderWidget: (info) => render(info, state) })));
}

/** The Map widget's own buttons: step to the next room (or back to the whole area), or turn it a quarter. */
async function moveMapWidget(widgetId: number, action: 'MAP_PAGE' | 'MAP_TURN', dir: 1 | -1) {
  const map = await loadMap();
  const s = await loadWidgetSettings(widgetId);
  if (action === 'MAP_TURN') {
    await saveWidgetSettings(widgetId, { ...s, rotation: ((s.rotation ?? map?.rotation ?? 0) + 90) % 360 });
    return;
  }
  // Pages: the whole area, then each room in it.
  const pages = [undefined, ...widgetPages(map, s).map((r) => r.id)];
  const i = Math.max(0, pages.indexOf(s.focus));
  await saveWidgetSettings(widgetId, { ...s, focus: pages[(i + dir + pages.length) % pages.length] });
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;

  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_RESIZED':
      renderWidget(await render(widgetInfo, { snapshot: await cachedSnapshot(), stale: false }));
      renderWidget(await render(widgetInfo, await fresh()));
      break;
    // Periodic, or live sync saw a change on the bridge: draw the fresh state directly.
    case 'WIDGET_UPDATE':
      renderWidget(await render(widgetInfo, await fresh()));
      break;
    case 'WIDGET_CLICK': {
      if (clickAction === 'MAP_PAGE' || clickAction === 'MAP_TURN') {
        await moveMapWidget(widgetInfo.widgetId, clickAction, clickActionData?.dir === '-1' ? -1 : 1);
        renderWidget(await render(widgetInfo, { snapshot: await cachedSnapshot(), stale: false }));
        break;
      }
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
      }
      if (plan) {
        const sent = fast ? Promise.resolve() : plan.send().catch(() => null);
        renderWidget(await render(widgetInfo, { snapshot: plan.next, stale: false }));
        await Promise.all([sent, saveCachedSnapshot(plan.next)]);
      }
      // Bring every widget to the real state, so they stay consistent.
      const state = await fresh();
      await refreshAllWidgets(state.snapshot, state.stale);
      break;
    }
    case 'WIDGET_DELETED':
      await forgetWidgetSettings(widgetInfo.widgetId);
      break;
    default:
      break;
  }
}
