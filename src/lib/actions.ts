import { cachedSnapshot, roomIsOn, saveCachedSnapshot, setLight, setRoom, type Snapshot } from './hue/client';

/**
 * Light actions shared by the app and the widgets. Each one is planned first: `next` is the
 * expected state (shown right away), `send` applies it on the bridge.
 */
export type Planned = { next: Snapshot; send: () => Promise<unknown> };

/** `target` forces the resulting state (widgets decide it when they render); default is to flip. */
export function planToggleLight(s: Snapshot, lightId: string, target?: boolean): Planned | null {
  const light = s.lights.find((l) => l.id === lightId);
  if (!light) return null;
  const on = target ?? !light.on;
  return {
    next: { ...s, lights: s.lights.map((l) => (l.id === lightId ? { ...l, on } : l)) },
    send: () => setLight(lightId, { on }),
  };
}

export function planToggleRoom(s: Snapshot, roomId: string, target?: boolean): Planned | null {
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room?.groupedLightId) return null;
  const on = target ?? !roomIsOn(room, s.lights);
  const groupId = room.groupedLightId;
  return {
    next: { ...s, lights: s.lights.map((l) => (room.lightIds.includes(l.id) ? { ...l, on } : l)) },
    send: () => setRoom(groupId, { on }),
  };
}

export function planRoomBrightness(s: Snapshot, roomId: string, brightness: number): Planned | null {
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room?.groupedLightId) return null;
  const groupId = room.groupedLightId;
  return {
    next: {
      ...s,
      lights: s.lights.map((l) => (room.lightIds.includes(l.id) && l.brightness !== null ? { ...l, on: true, brightness } : l)),
    },
    send: () => setRoom(groupId, { on: true, brightness }),
  };
}

export function planLightBrightness(s: Snapshot, lightId: string, brightness: number): Planned | null {
  const light = s.lights.find((l) => l.id === lightId);
  if (!light || light.brightness === null) return null;
  return {
    next: { ...s, lights: s.lights.map((l) => (l.id === lightId ? { ...l, on: true, brightness } : l)) },
    send: () => setLight(lightId, { on: true, brightness }),
  };
}

/** Every light on the bridge on or off ("All off"). */
export function planAll(s: Snapshot, on: boolean): Planned | null {
  const groupId = s.homeGroupId;
  return {
    next: { ...s, lights: s.lights.map((l) => ({ ...l, on })) },
    // Old cached snapshots have no home group: fall back to each room.
    send: groupId
      ? () => setRoom(groupId, { on })
      : () => Promise.all(s.rooms.filter((r) => r.groupedLightId).map((r) => setRoom(r.groupedLightId!, { on }))),
  };
}

/** Runs a planned action against the cached snapshot: saves the expected state, then sends it. */
async function run(plan: (s: Snapshot) => Planned | null): Promise<Snapshot | null> {
  const s = await cachedSnapshot();
  const p = s && plan(s);
  if (!p) return s;
  await Promise.all([saveCachedSnapshot(p.next), p.send()]);
  return p.next;
}

export const toggleLight = (lightId: string) => run((s) => planToggleLight(s, lightId));
export const toggleRoom = (roomId: string) => run((s) => planToggleRoom(s, roomId));
export const setRoomBrightness = (roomId: string, brightness: number) => run((s) => planRoomBrightness(s, roomId, brightness));
