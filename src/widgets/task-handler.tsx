import { requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { toggleLight, toggleRoom } from '../lib/actions';
import { cachedSnapshot, fetchSnapshot, type Snapshot } from '../lib/hue/client';
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
      try {
        if (clickAction === 'TOGGLE_LIGHT' && typeof clickActionData?.lightId === 'string') {
          await toggleLight(clickActionData.lightId);
        } else if (clickAction === 'TOGGLE_ROOM' && typeof clickActionData?.roomId === 'string') {
          await toggleRoom(clickActionData.roomId);
        }
      } catch {
        // The fresh fetch below brings the widget back to the real state.
      }
      // Update every widget, not only the one tapped, so they stay consistent.
      await refreshAllWidgets(await fresh());
      break;
    }
    default:
      break;
  }
}
