import AsyncStorage from '@react-native-async-storage/async-storage';

/** A point on the floor in meters (AR world coordinates: x and z, y is up). */
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

export type HomeMap = { version: 1; rooms: MapRoom[]; lights: MapLight[]; updatedAt: number };

const KEY = 'home-map';

export async function loadMap(): Promise<HomeMap | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as HomeMap) : null;
}

export async function saveMap(map: HomeMap) {
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
}

/** A map laid out for drawing: rotated so walls are axis-aligned, origin at the top-left corner. */
export type Plan = {
  width: number;
  height: number;
  rooms: (MapRoom & { pts: { u: number; v: number }[] })[];
  lights: (MapLight & { u: number; v: number })[];
};

export function toPlan(map: HomeMap): Plan {
  // Align the first wall scanned with the horizontal axis.
  const first = map.rooms.find((r) => r.points.length >= 2);
  const angle = first ? Math.atan2(first.points[1].z - first.points[0].z, first.points[1].x - first.points[0].x) : 0;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const rot = (p: FloorPoint) => ({ u: p.x * cos - p.z * sin, v: p.x * sin + p.z * cos });

  const all = [...map.rooms.flatMap((r) => r.points), ...map.lights].map(rot);
  const minU = Math.min(...all.map((p) => p.u), 0);
  const minV = Math.min(...all.map((p) => p.v), 0);
  const maxU = Math.max(...all.map((p) => p.u), 1);
  const maxV = Math.max(...all.map((p) => p.v), 1);
  const shift = (p: { u: number; v: number }) => ({ u: p.u - minU, v: p.v - minV });

  return {
    width: maxU - minU,
    height: maxV - minV,
    rooms: map.rooms.map((r) => ({ ...r, pts: r.points.map((p) => shift(rot(p))) })),
    lights: map.lights.map((l) => ({ ...l, ...shift(rot(l)) })),
  };
}

/** Scale and offsets to fit a plan into a box, keeping proportions. */
export function fitPlan(plan: Plan, width: number, height: number, padding: number) {
  const scale = Math.min((width - padding * 2) / plan.width, (height - padding * 2) / plan.height);
  const offsetX = (width - plan.width * scale) / 2;
  const offsetY = (height - plan.height * scale) / 2;
  return { scale, x: (u: number) => offsetX + u * scale, y: (v: number) => offsetY + v * scale };
}
