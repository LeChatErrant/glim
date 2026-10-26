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

export type MapLight = {
  lightId: string;
  /** Direction it runs along (string lights, bars, lanterns), degrees in map coordinates. Absent = along the nearest wall. */
  angle?: number;
  /** Length of string lights, in meters. */
  length?: number;
} & FloorPoint;

export type HomeMap = {
  version: 2;
  rooms: MapRoom[];
  lights: MapLight[];
  updatedAt: number;
  /** How the map is turned on screen, in degrees clockwise (map coordinates follow the first scanned wall, not the screen). */
  rotation?: number;
};

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

/** Saves the map. The scan and the editor don't know the orientation: an unset one is kept. */
export async function saveMap(map: HomeMap) {
  const k = await key();
  let rotation = map.rotation;
  if (rotation === undefined) {
    const raw = await AsyncStorage.getItem(k);
    rotation = raw ? (JSON.parse(raw) as HomeMap).rotation : undefined;
  }
  await AsyncStorage.setItem(k, JSON.stringify({ ...map, rotation, updatedAt: Date.now() }));
}

/** Turns the map on screen (degrees clockwise, kept in 0–360). */
export async function saveMapRotation(rotation: number) {
  const map = await loadMap();
  if (!map) return null;
  const next = { ...map, rotation: ((Math.round(rotation) % 360) + 360) % 360 };
  await saveMap(next);
  return next;
}

/**
 * Lights the user chose to leave off the map ("Not now" on the map's reminder), per bridge.
 * A light that goes missing later is shown again; this only remembers the ones already seen.
 */
export async function loadHiddenLights(): Promise<string[]> {
  const bridge = await getBridge();
  const raw = await AsyncStorage.getItem(`map-hidden-lights:${bridge?.id ?? ''}`);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function saveHiddenLights(ids: string[]) {
  const bridge = await getBridge();
  await AsyncStorage.setItem(`map-hidden-lights:${bridge?.id ?? ''}`, JSON.stringify(ids));
}

/** A map laid out for drawing: shifted so the top-left of its bounding box is at (0, 0). */
export type Plan = {
  width: number;
  height: number;
  rooms: (MapRoom & { pts: { u: number; v: number }[] })[];
  lights: (MapLight & { u: number; v: number })[];
};

/** Lays out a map for drawing, turned by `rotation` degrees clockwise (default: the map's own). */
export function toPlan(map: HomeMap, rotation = map.rotation ?? 0): Plan {
  const a = (rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Screen y points down, so this turns clockwise on screen.
  const turn = <T extends FloorPoint>(p: T): T => ({ ...p, x: cos * p.x - sin * p.z, z: sin * p.x + cos * p.z });
  map = {
    ...map,
    rooms: map.rooms.map((r) => ({ ...r, points: r.points.map(turn) })),
    lights: map.lights.map((l) => ({ ...turn(l), angle: l.angle === undefined ? undefined : l.angle + rotation })),
  };
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

/** Zoom (1 = whole plan) and pan in px, on top of the fit. */
export type PlanView = { zoom: number; x: number; y: number };

/** Scale and offsets to fit a plan into a box, keeping proportions, then zoomed and panned. */
export function fitPlan(plan: Plan, width: number, height: number, padding: number, view?: PlanView) {
  const scale = Math.min((width - padding * 2) / plan.width, (height - padding * 2) / plan.height) * (view?.zoom ?? 1);
  const offsetX = (width - plan.width * scale) / 2 + (view?.x ?? 0);
  const offsetY = (height - plan.height * scale) / 2 + (view?.y ?? 0);
  return { scale, x: (u: number) => offsetX + u * scale, y: (v: number) => offsetY + v * scale };
}
