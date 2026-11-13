import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Light, Room, Snapshot } from '../lib/hue/client';

/** One tile of a Light or Grid widget: a room or a single light. */
export type TileItem = { kind: 'room' | 'light'; id: string };

/**
 * Per-widget options of the Light widget (1×1, one item) and the Grid widget (up to 8, in the
 * order picked). Absent = the defaults.
 */
export type TilesWidgetSettings = { items?: TileItem[] };

const key = (widgetId: number) => `widget-tiles:${widgetId}`;

export async function loadTilesWidgetSettings(widgetId: number): Promise<TilesWidgetSettings> {
  try {
    return JSON.parse((await AsyncStorage.getItem(key(widgetId))) ?? '{}');
  } catch {
    return {};
  }
}

export const saveTilesWidgetSettings = (widgetId: number, s: TilesWidgetSettings) => AsyncStorage.setItem(key(widgetId), JSON.stringify(s));
export const forgetTilesWidgetSettings = (widgetId: number) => AsyncStorage.removeItem(key(widgetId));

export const MAX_TILES = 8;

export const tileKey = (i: TileItem) => `${i.kind}:${i.id}`;

/** Until the user picks: the rooms, then the lights in no room, as many as a grid holds. */
export function defaultTiles(s: Snapshot): TileItem[] {
  const rooms: TileItem[] = s.rooms.map((r) => ({ kind: 'room', id: r.id }));
  const loose: TileItem[] = s.lights.filter((l) => !l.roomId).map((l) => ({ kind: 'light', id: l.id }));
  return [...rooms, ...loose].slice(0, MAX_TILES);
}

/** A tile resolved against the home: its room or light, or nothing when it was deleted since. */
export type Tile = { key: string; room: Room; light?: undefined } | { key: string; light: Light; room?: undefined };

export function resolveTiles(items: TileItem[], s: Snapshot): Tile[] {
  return items.flatMap((i): Tile[] => {
    if (i.kind === 'room') {
      const room = s.rooms.find((r) => r.id === i.id);
      return room ? [{ key: tileKey(i), room }] : [];
    }
    const light = s.lights.find((l) => l.id === i.id);
    return light ? [{ key: tileKey(i), light }] : [];
  });
}
