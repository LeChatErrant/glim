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
  reachable: boolean;
};

export type Room = {
  id: string;
  name: string;
  archetype: string;
  groupedLightId: string | null;
  lightIds: string[];
};

export type Snapshot = { rooms: Room[]; lights: Light[]; fetchedAt: number };

type Resource = Record<string, any> & { id: string; type: string };

async function call(path: string, method: 'GET' | 'PUT' = 'GET', body?: unknown): Promise<Resource[]> {
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
  const [lightsRaw, devices, rooms, connectivity] = await Promise.all([
    call('light'),
    call('device'),
    call('room'),
    call('zigbee_connectivity'),
  ]);
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const roomByDevice = new Map<string, string>();
  for (const r of rooms) for (const c of r.children) if (c.rtype === 'device') roomByDevice.set(c.rid, r.id);
  const reachableByDevice = new Map(connectivity.map((c) => [c.owner.rid, c.status === 'connected']));

  const lights: Light[] = lightsRaw.map((l) => {
    const device = deviceById.get(l.owner.rid);
    const kind: LightKind = l.color ? 'color' : l.dimming ? 'white' : 'onoff';
    const mirek = l.color_temperature?.mirek_valid ? l.color_temperature.mirek : null;
    const color =
      kind === 'onoff'
        ? PLUG_ON_COLOR
        : l.color_mode === 'color_temperature' && mirek
          ? mirekToHex(mirek)
          : l.color
            ? xyToHex(l.color.xy.x, l.color.xy.y)
            : mirek
              ? mirekToHex(mirek)
              : PLUG_ON_COLOR;
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
    fetchedAt: Date.now(),
  };
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function cachedSnapshot(): Promise<Snapshot | null> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
  return raw ? (JSON.parse(raw) as Snapshot) : null;
}

/** Applies a local change to the cached snapshot, so widgets can render it before the bridge confirms. */
export async function patchCachedSnapshot(patch: (s: Snapshot) => Snapshot): Promise<Snapshot | null> {
  const s = await cachedSnapshot();
  if (!s) return null;
  const next = patch(s);
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
  return next;
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

export function roomIsOn(room: Room, lights: Light[]) {
  return lights.some((l) => room.lightIds.includes(l.id) && l.on);
}
