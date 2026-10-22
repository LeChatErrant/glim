import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { planToggleLight, planToggleRoom, type Planned } from '../lib/actions';
import { cachedSnapshot, fetchSnapshot, saveCachedSnapshot, type Snapshot } from '../lib/hue/client';
import { loadMap, toPlan } from '../lib/map/map';
import { MapWidget, RoomsWidget } from './widgets';

export const WIDGET_NAMES = ['Rooms', 'Map'] as const;

async function render(info: WidgetInfo, snapshot: Snapshot | null) {
  if (info.widgetName === 'Map') {
    const map = await loadMap();
    return <MapWidget snapshot={snapshot} plan={map ? toPlan(map) : null} width={info.width} height={info.height} />;
  }
  return <RoomsWidget snapshot={snapshot} />;
}

async function fresh(): Promise<Snapshot | null> {
  try {
    return await fetchSnapshot();
  } catch {
    // Off the home network (cloud access comes later): keep showing the last known state.
    return cachedSnapshot();
  }
}

/** Re-renders every placed widget. Called by the app after it changes lights. */
export async function refreshAllWidgets(snapshot?: Snapshot | null) {
  const s = snapshot === undefined ? await cachedSnapshot() : snapshot;
  await Promise.all(WIDGET_NAMES.map((widgetName) => requestWidgetUpdate({ widgetName, renderWidget: (info) => render(info, s) })));
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;

  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      renderWidget(await render(widgetInfo, await cachedSnapshot()));
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
      }
      if (plan) {
        const sent = fast ? Promise.resolve() : plan.send().catch(() => null);
        renderWidget(await render(widgetInfo, plan.next));
        await Promise.all([sent, saveCachedSnapshot(plan.next)]);
      }
      // Bring every widget to the real state, so they stay consistent.
      await refreshAllWidgets(await fresh());
      break;
    }
    default:
      break;
  }
}
