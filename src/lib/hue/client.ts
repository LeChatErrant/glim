import AsyncStorage from '@react-native-async-storage/async-storage';

import { HueHttp } from '../../../modules/hue-http';
import { getBridge } from './bridge';
import { mirekToHex, PLUG_ON_COLOR, xyToHex } from './color';

export type LightKind = 'color' | 'white' | 'onoff';

export type Light = {
  id: string;
  deviceId: string;
  name: string;
  archetype: string;
  roomId: string | null;
  kind: LightKind;
  on: boolean;
  /** 0–100, null for on/off lights. */
  brightness: number | null;
  /** Display color of the light's current state (ignores brightness). */
  color: string;
  /** White temperature when the light is in white mode, else null. */
  mirek: number | null;
  reachable: boolean;
};

export type Room = {
  id: string;
  name: string;
  archetype: string;
  groupedLightId: string | null;
  lightIds: string[];
};

export type Snapshot = {
  rooms: Room[];
  lights: Light[];
  /** Grouped light for every light on the bridge ("all off"). Missing in old cached snapshots. */
  homeGroupId?: string | null;
  fetchedAt: number;
};

type Resource = Record<string, any> & { id: string; type: string };

async function call(path: string, method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<Resource[]> {
  const bridge = await getBridge();
  if (!bridge) throw new Error('No bridge paired');
  const res = await HueHttp.request({
    url: `https://${bridge.ip}/clip/v2/resource/${path}`,
    method,
    headers: { 'hue-application-key': bridge.appKey },
    body: body === undefined ? undefined : JSON.stringify(body),
    bridgeId: bridge.id,
    pin: bridge.pin,
    timeoutMs: 4000,
  });
  const json = JSON.parse(res.body || '{}') as { data?: Resource[]; errors?: { description: string }[] };
  if (res.status >= 400 || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.description).join(', ') || `HTTP ${res.status}`);
  }
  return json.data ?? [];
}

const SNAPSHOT_KEY = 'snapshot';

export async function fetchSnapshot(): Promise<Snapshot> {
  const [lightsRaw, devices, rooms, connectivity, homes] = await Promise.all([
    call('light'),
    call('device'),
    call('room'),
    call('zigbee_connectivity'),
    call('bridge_home').catch(() => []),
  ]);
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const roomByDevice = new Map<string, string>();
  for (const r of rooms) for (const c of r.children) if (c.rtype === 'device') roomByDevice.set(c.rid, r.id);
  const reachableByDevice = new Map(connectivity.map((c) => [c.owner.rid, c.status === 'connected']));

  const lights: Light[] = lightsRaw.map((l) => {
    const device = deviceById.get(l.owner.rid);
    const kind: LightKind = l.color ? 'color' : l.dimming ? 'white' : 'onoff';
    // mirek_valid is true only while the light is in white mode.
    const mirek: number | null = l.color_temperature?.mirek_valid ? l.color_temperature.mirek : null;
    const color = kind === 'onoff' ? PLUG_ON_COLOR : mirek ? mirekToHex(mirek) : l.color ? xyToHex(l.color.xy.x, l.color.xy.y) : PLUG_ON_COLOR;
    return {
      id: l.id,
      deviceId: l.owner.rid,
      // Device names are the ones the user set; light names are often defaults.
      name: device?.metadata?.name ?? l.metadata.name,
      archetype: device?.metadata?.archetype ?? l.metadata.archetype,
      roomId: roomByDevice.get(l.owner.rid) ?? null,
      kind,
      on: l.on.on,
      brightness: l.dimming ? Math.round(l.dimming.brightness) : null,
      color,
      mirek: kind === 'onoff' ? null : mirek,
      reachable: reachableByDevice.get(l.owner.rid) ?? true,
    };
  });

  const lightIdsByDevice = new Map(lights.map((l) => [l.deviceId, l.id]));
  const snapshot: Snapshot = {
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.metadata.name,
      archetype: r.metadata.archetype,
      groupedLightId: r.services.find((s: { rtype: string }) => s.rtype === 'grouped_light')?.rid ?? null,
      lightIds: r.children.map((c: { rid: string }) => lightIdsByDevice.get(c.rid)).filter(Boolean) as string[],
    })),
    lights,
    homeGroupId: homes[0]?.services?.find((x: { rtype: string }) => x.rtype === 'grouped_light')?.rid ?? null,
    fetchedAt: Date.now(),
  };
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function cachedSnapshot(): Promise<Snapshot | null> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
  return raw ? (JSON.parse(raw) as Snapshot) : null;
}

export async function saveCachedSnapshot(snapshot: Snapshot) {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function setLight(id: string, state: { on?: boolean; brightness?: number }) {
  const body: Record<string, unknown> = {};
  if (state.on !== undefined) body.on = { on: state.on };
  if (state.brightness !== undefined) body.dimming = { brightness: state.brightness };
  return call(`light/${id}`, 'PUT', body);
}

export function setRoom(groupedLightId: string, state: { on?: boolean; brightness?: number }) {
  const body: Record<string, unknown> = {};
  if (state.on !== undefined) body.on = { on: state.on };
  if (state.brightness !== undefined) body.dimming = { brightness: state.brightness };
  return call(`grouped_light/${groupedLightId}`, 'PUT', body);
}

/** Makes the light blink so the user can tell which one it is. */
export function identifyLight(id: string) {
  return call(`light/${id}`, 'PUT', { identify: { action: 'identify' } });
}

/** A room is on if any reachable light in it is on (unreachable lights report a stale state). */
export function roomIsOn(room: Room, lights: Light[]) {
  return lights.some((l) => room.lightIds.includes(l.id) && l.on && l.reachable);
}

/** Hue room types offered when creating a room from the app (subset of the bridge's archetypes). */
export const ROOM_ARCHETYPES = [
  { id: 'living_room', label: 'Living room' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'office', label: 'Office' },
  { id: 'dining', label: 'Dining room' },
  { id: 'hallway', label: 'Hallway' },
  { id: 'balcony', label: 'Balcony' },
  { id: 'terrace', label: 'Terrace' },
  { id: 'other', label: 'Other' },
] as const;

/** Creates an empty room on the bridge and returns its ID. */
export async function createRoom(name: string, archetype: string): Promise<string> {
  const data = await call('room', 'POST', { metadata: { name, archetype }, children: [] });
  const id = (data[0] as unknown as { rid?: string })?.rid;
  if (!id) throw new Error("The bridge didn't return the new room");
  return id;
}

/**
 * Moves a light's device into a room. A device belongs to at most one room, so it's
 * removed from its current room first.
 */
export async function moveDeviceToRoom(deviceId: string, roomId: string) {
  const rooms = await call('room');
  for (const room of rooms) {
    if (room.id === roomId) continue;
    const children = room.children as { rid: string; rtype: string }[];
    if (children.some((c) => c.rid === deviceId)) {
      await call(`room/${room.id}`, 'PUT', { children: children.filter((c) => c.rid !== deviceId) });
    }
  }
  const target = rooms.find((r) => r.id === roomId);
  if (!target) throw new Error('Room not found');
  const children = target.children as { rid: string; rtype: string }[];
  if (!children.some((c) => c.rid === deviceId)) {
    await call(`room/${roomId}`, 'PUT', { children: [...children, { rid: deviceId, rtype: 'device' }] });
  }
}
