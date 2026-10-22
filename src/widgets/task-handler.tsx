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
      let plan: Planned | null = null;
      if (cached && clickAction === 'TOGGLE_LIGHT' && typeof clickActionData?.lightId === 'string') {
        plan = planToggleLight(cached, clickActionData.lightId);
      } else if (cached && clickAction === 'TOGGLE_ROOM' && typeof clickActionData?.roomId === 'string') {
        plan = planToggleRoom(cached, clickActionData.roomId);
      }
      if (plan) {
        // Send first, then redraw with the expected state while the bridge applies it.
        const sent = plan.send().catch(() => null);
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
