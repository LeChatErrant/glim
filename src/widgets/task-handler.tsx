import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { planAll, planToggleLight, planToggleRoom, type Planned } from '../lib/actions';
import { getBridge } from '../lib/hue/bridge';
import { cachedSnapshot, fetchSnapshot, saveCachedSnapshot, type Snapshot } from '../lib/hue/client';
import { loadMap, toPlan } from '../lib/map/map';
import { MapWidget, NotPaired, RoomsWidget } from './widgets';

export const WIDGET_NAMES = ['Rooms', 'Map'] as const;

/** A state to draw, and whether it is only the last known one (bridge unreachable). */
type State = { snapshot: Snapshot | null; stale: boolean };

async function render(info: WidgetInfo, { snapshot, stale }: State) {
  if (!(await getBridge())) return <NotPaired />;
  if (info.widgetName === 'Map') {
    const map = await loadMap();
    return <MapWidget snapshot={snapshot} plan={map ? toPlan(map) : null} width={info.width} height={info.height} stale={stale} />;
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

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;

  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      renderWidget(await render(widgetInfo, { snapshot: await cachedSnapshot(), stale: false }));
      renderWidget(await render(widgetInfo, await fresh()));
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
    default:
      break;
  }
}
