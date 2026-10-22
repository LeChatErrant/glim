import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from '../hue/bridge';
import { apply, normalizingTransform } from './geometry';

/** A point on the floor in meters. In a saved map: map coordinates (first wall along +x). */
export type FloorPoint = { x: number; z: number };

export type MapRoom = {
  id: string;
  name: string;
  /** Hue room this outline belongs to; null for spaces without lights (hallway...). */
  hueRoomId: string | null;
  points: FloorPoint[];
  outdoor?: boolean;
};

export type MapLight = { lightId: string } & FloorPoint;

export type HomeMap = { version: 2; rooms: MapRoom[]; lights: MapLight[]; updatedAt: number };

const LEGACY_KEY = 'home-map';

/** Maps are stored per bridge, so a second home or bridge gets its own map. */
async function key() {
  const bridge = await getBridge();
  return bridge ? `home-map:${bridge.id}` : LEGACY_KEY;
}

export async function loadMap(): Promise<HomeMap | null> {
  const k = await key();
  let raw = await AsyncStorage.getItem(k);
  if (!raw && k !== LEGACY_KEY) raw = await AsyncStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  const map = JSON.parse(raw) as HomeMap | (Omit<HomeMap, 'version'> & { version: 1 });
  if (map.version === 2) return map;
  // v1 maps were saved in raw AR coordinates: put them in map coordinates once.
  const t = normalizingTransform(map.rooms[0]?.points ?? []);
  const migrated: HomeMap = {
    version: 2,
    rooms: map.rooms.map((r) => ({ ...r, points: r.points.map((p) => apply(t, p)) })),
    lights: map.lights.map((l) => ({ ...l, ...apply(t, l) })),
    updatedAt: map.updatedAt,
  };
  await saveMap(migrated);
  await AsyncStorage.removeItem(LEGACY_KEY);
  return migrated;
}

export async function saveMap(map: HomeMap) {
  await AsyncStorage.setItem(await key(), JSON.stringify({ ...map, updatedAt: Date.now() }));
}

/** A map laid out for drawing: shifted so the top-left of its bounding box is at (0, 0). */
export type Plan = {
  width: number;
  height: number;
  rooms: (MapRoom & { pts: { u: number; v: number }[] })[];
  lights: (MapLight & { u: number; v: number })[];
};

export function toPlan(map: HomeMap): Plan {
  const all = [...map.rooms.flatMap((r) => r.points), ...map.lights];
  const minU = Math.min(...all.map((p) => p.x), 0);
  const minV = Math.min(...all.map((p) => p.z), 0);
  const maxU = Math.max(...all.map((p) => p.x), minU + 1);
  const maxV = Math.max(...all.map((p) => p.z), minV + 1);
  const shift = (p: FloorPoint) => ({ u: p.x - minU, v: p.z - minV });
  return {
    width: maxU - minU,
    height: maxV - minV,
    rooms: map.rooms.map((r) => ({ ...r, pts: r.points.map(shift) })),
    lights: map.lights.map((l) => ({ ...l, ...shift(l) })),
  };
}

/** Scale and offsets to fit a plan into a box, keeping proportions. */
export function fitPlan(plan: Plan, width: number, height: number, padding: number) {
  const scale = Math.min((width - padding * 2) / plan.width, (height - padding * 2) / plan.height);
  const offsetX = (width - plan.width * scale) / 2;
  const offsetY = (height - plan.height * scale) / 2;
  return { scale, x: (u: number) => offsetX + u * scale, y: (v: number) => offsetY + v * scale };
}
