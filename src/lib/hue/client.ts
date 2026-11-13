import AsyncStorage from '@react-native-async-storage/async-storage';

import { getBridge } from './bridge';
import { mirekToHex, PLUG_ON_COLOR, xyToHex } from './color';
import { send } from './transport';

export type LightKind = 'color' | 'white' | 'onoff';

export type Light = {
  id: string;
  deviceId: string;
  name: string;
  /** What it looks like (pendant, string lights...): the device archetype, set by the user. */
  archetype: string;
  /** What the hardware is (Hue's product archetype: "plug", "sultan_bulb", "hue_go"...). Missing in old cached snapshots. */
  product?: string;
  /** A smart plug: whatever is plugged in, it only turns on and off. Missing in old cached snapshots. */
  plug?: boolean;
  roomId: string | null;
  kind: LightKind;
  on: boolean;
  /** 0–100, null for on/off lights. */
  brightness: number | null;
  /** Display color of the light's current state (ignores brightness). */
  color: string;
  /** White temperature when the light is in white mode, else null. */
  mirek: number | null;
  /** Supported white temperatures in mirek, [coolest, warmest]; null if the light has no white temperature. Missing in old cached snapshots. */
  mirekRange?: [number, number] | null;
  reachable: boolean;
  /** Effect running now ("candle"...), "no_effect" or absent. */
  effect?: string;
  /** Effects the light supports; absent or empty when none (plugs, white lights). */
  effects?: string[];
  /** Speed of the running effect, 0–1. */
  effectSpeed?: number;
};

export type Room = {
  id: string;
  name: string;
  archetype: string;
  groupedLightId: string | null;
  lightIds: string[];
};

/** A group of lights across rooms (Hue zone). */
export type Zone = {
  id: string;
  name: string;
  archetype: string;
  groupedLightId: string | null;
  lightIds: string[];
};

export type Snapshot = {
  rooms: Room[];
  /** Groups (Hue zones). Missing in old cached snapshots. */
  zones?: Zone[];
  lights: Light[];
  /** Grouped light for every light on the bridge ("all off"). Missing in old cached snapshots. */
  homeGroupId?: string | null;
  fetchedAt: number;
};

type Resource = Record<string, any> & { id: string; type: string };

async function call(path: string, method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<Resource[]> {
  const bridge = await getBridge();
  if (!bridge) throw new Error('No bridge paired');
  // Straight to the bridge at home, through Hue's cloud when away.
  const res = await send(bridge, path, method, body === undefined ? undefined : JSON.stringify(body));
  const json = JSON.parse(res.body || '{}') as { data?: Resource[]; errors?: { description: string }[] };
  if (res.status >= 400 || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.description).join(', ') || `HTTP ${res.status}`);
  }
  return json.data ?? [];
}

const SNAPSHOT_KEY = 'snapshot';

export async function fetchSnapshot(): Promise<Snapshot> {
  const [lightsRaw, devices, rooms, connectivity, homes, zones] = await Promise.all([
    call('light'),
    call('device'),
    call('room'),
    call('zigbee_connectivity'),
    call('bridge_home').catch(() => []),
    call('zone').catch(() => []),
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
      product: device?.product_data?.product_archetype ?? '',
      // Hue reports what the device is; a plug can be "string lights" if the user said so.
      plug: device?.product_data?.product_archetype === 'plug' || (!l.dimming && !l.color),
      roomId: roomByDevice.get(l.owner.rid) ?? null,
      kind,
      on: l.on.on,
      brightness: l.dimming ? Math.round(l.dimming.brightness) : null,
      color,
      mirek: kind === 'onoff' ? null : mirek,
      mirekRange: l.color_temperature?.mirek_schema
        ? [l.color_temperature.mirek_schema.mirek_minimum, l.color_temperature.mirek_schema.mirek_maximum]
        : null,
      reachable: reachableByDevice.get(l.owner.rid) ?? true,
      effect: l.effects_v2?.status?.effect ?? l.effects?.status,
      effects: (l.effects_v2?.action?.effect_values ?? l.effects?.effect_values ?? []).filter((e: string) => e !== 'no_effect'),
      effectSpeed: l.effects_v2?.status?.parameters?.speed,
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
    zones: zones.map((z) => ({
      id: z.id,
      name: z.metadata.name,
      archetype: z.metadata.archetype,
      groupedLightId: z.services.find((x: { rtype: string }) => x.rtype === 'grouped_light')?.rid ?? null,
      lightIds: z.children.filter((c: { rtype: string }) => c.rtype === 'light').map((c: { rid: string }) => c.rid),
    })),
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

/**
 * A change to send: color (CIE xy) and white temperature (mirek) are exclusive. `effect` starts a
 * built-in effect ("candle"...) or stops it ("no_effect"); `speed` is 0–1.
 */
export type LightState = { on?: boolean; brightness?: number; xy?: { x: number; y: number }; mirek?: number; effect?: string; speed?: number };

export function stateBody(state: LightState) {
  const body: Record<string, unknown> = {};
  if (state.on !== undefined) body.on = { on: state.on };
  if (state.brightness !== undefined) body.dimming = { brightness: state.brightness };
  if (state.xy) body.color = { xy: state.xy };
  else if (state.mirek !== undefined) body.color_temperature = { mirek: state.mirek };
  if (state.effect) body.effects_v2 = { action: { effect: state.effect, ...(state.speed !== undefined ? { parameters: { speed: state.speed } } : {}) } };
  return body;
}

export function setLight(id: string, state: LightState) {
  return call(`light/${id}`, 'PUT', stateBody(state));
}

/** Lights in the group that can't do the color or temperature just ignore it. */
export function setRoom(groupedLightId: string, state: LightState) {
  return call(`grouped_light/${groupedLightId}`, 'PUT', stateBody(state));
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

/** Renames a light (its device: the name the user sees everywhere, Hue app included). */
export function renameDevice(deviceId: string, name: string) {
  return call(`device/${deviceId}`, 'PUT', { metadata: { name } });
}

/** Says what a light looks like (or what's plugged into a plug), e.g. "string_light". */
export function setDeviceArchetype(deviceId: string, archetype: string) {
  return call(`device/${deviceId}`, 'PUT', { metadata: { archetype } });
}

export function updateRoom(roomId: string, metadata: { name?: string; archetype?: string }) {
  return call(`room/${roomId}`, 'PUT', { metadata });
}

/** Deletes a room on the bridge. Its lights stay, in no room. */
export function deleteRoom(roomId: string) {
  return call(`room/${roomId}`, 'DELETE');
}

/** Takes a light's device out of its room (it stays on the bridge, in no room). */
export async function removeDeviceFromRoom(deviceId: string) {
  for (const room of await call('room')) {
    const children = room.children as { rid: string; rtype: string }[];
    if (children.some((c) => c.rid === deviceId)) {
      await call(`room/${room.id}`, 'PUT', { children: children.filter((c) => c.rid !== deviceId) });
    }
  }
}

const lightRefs = (lightIds: string[]) => lightIds.map((rid) => ({ rid, rtype: 'light' }));

/** Creates a group (Hue zone) and returns its ID. */
export async function createZone(name: string, archetype: string, lightIds: string[]): Promise<string> {
  const data = await call('zone', 'POST', { metadata: { name, archetype }, children: lightRefs(lightIds) });
  const id = (data[0] as unknown as { rid?: string })?.rid;
  if (!id) throw new Error("The bridge didn't return the new group");
  return id;
}

export function updateZone(zoneId: string, change: { name?: string; archetype?: string; lightIds?: string[] }) {
  const body: Record<string, unknown> = {};
  if (change.name !== undefined || change.archetype !== undefined) body.metadata = { name: change.name, archetype: change.archetype };
  if (change.lightIds) body.children = lightRefs(change.lightIds);
  return call(`zone/${zoneId}`, 'PUT', body);
}

export function deleteZone(zoneId: string) {
  return call(`zone/${zoneId}`, 'DELETE');
}

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
