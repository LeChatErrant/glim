import AsyncStorage from '@react-native-async-storage/async-storage';

import { pointInPolygon } from '../lib/map/geometry';
import { toPlan, type HomeMap, type Plan } from '../lib/map/map';

/**
 * Per-widget options of the Map widget (set from its configuration screen). A widget can show part
 * of the home, so a big map stays tappable, and be turned on its own.
 */
export type MapWidgetSettings = {
  /** Degrees clockwise; absent = same orientation as the app. */
  rotation?: number;
  /** Map rooms to show; absent or empty = the whole home. */
  roomIds?: string[];
  /** Room zoomed into with the widget's arrows; absent = the whole area. */
  focus?: string;
};

const key = (widgetId: number) => `widget:${widgetId}`;

export async function loadWidgetSettings(widgetId: number): Promise<MapWidgetSettings> {
  try {
    return JSON.parse((await AsyncStorage.getItem(key(widgetId))) ?? '{}');
  } catch {
    return {};
  }
}

export const saveWidgetSettings = (widgetId: number, s: MapWidgetSettings) => AsyncStorage.setItem(key(widgetId), JSON.stringify(s));
export const forgetWidgetSettings = (widgetId: number) => AsyncStorage.removeItem(key(widgetId));

/** Rooms the widget's arrows step through: the configured area, then each room in it. */
export function widgetPages(map: HomeMap | null, s: MapWidgetSettings) {
  const area = s.roomIds?.length ? (map?.rooms ?? []).filter((r) => s.roomIds!.includes(r.id)) : (map?.rooms ?? []);
  return area.filter((r) => r.points.length > 2);
}

/** The plan a Map widget draws: the focused room, else the chosen rooms, and the lights inside them, turned as asked. */
export function widgetPlan(map: HomeMap | null, s: MapWidgetSettings): Plan | null {
  if (!map?.rooms.length) return null;
  const focus = s.focus && map.rooms.find((r) => r.id === s.focus);
  const rooms = focus ? [focus] : s.roomIds?.length ? map.rooms.filter((r) => s.roomIds!.includes(r.id)) : map.rooms;
  if (!rooms.length) return toPlan(map, s.rotation);
  const lights = rooms === map.rooms ? map.lights : map.lights.filter((l) => rooms.some((r) => r.points.length > 2 && pointInPolygon(l, r.points)));
  return toPlan({ ...map, rooms, lights }, s.rotation);
}
