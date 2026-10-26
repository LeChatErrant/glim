import { cachedSnapshot, roomIsOn, saveCachedSnapshot, setLight, setRoom, type Light, type Snapshot } from './hue/client';
import { hexToXy, kelvinToMirek, mirekToHex } from './hue/color';

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

/** Lights that take a white temperature (color lights do too). */
export const hasTemperature = (l: Light) => l.kind === 'color' || !!l.mirekRange;

/** The light's nearest mirek to a kelvin value (most lights do 2000/2200–6500 K). */
export function mirekFor(l: Light, kelvin: number) {
  const [lo, hi] = l.mirekRange ?? [153, 500];
  return Math.max(lo, Math.min(hi, kelvinToMirek(kelvin)));
}

/** Sets a color light to a color (and turns it on). */
export function planLightColor(s: Snapshot, lightId: string, hex: string): Planned | null {
  const light = s.lights.find((l) => l.id === lightId);
  if (!light || light.kind !== 'color') return null;
  const xy = hexToXy(hex);
  return {
    next: { ...s, lights: s.lights.map((l) => (l.id === lightId ? { ...l, on: true, color: hex, mirek: null } : l)) },
    send: () => setLight(lightId, { on: true, xy }),
  };
}

/** Sets a light to a white temperature (and turns it on). */
export function planLightKelvin(s: Snapshot, lightId: string, kelvin: number): Planned | null {
  const light = s.lights.find((l) => l.id === lightId);
  if (!light || !hasTemperature(light)) return null;
  const mirek = mirekFor(light, kelvin);
  return {
    next: { ...s, lights: s.lights.map((l) => (l.id === lightId ? { ...l, on: true, color: mirekToHex(mirek), mirek } : l)) },
    send: () => setLight(lightId, { on: true, mirek }),
  };
}

/**
 * Paints a room's color lights. Lights that can't do color keep theirs. Lights that are off stay
 * off, unless the whole room was off: then it turns on.
 */
export function planRoomColor(s: Snapshot, roomId: string, hex: string): Planned | null {
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room?.groupedLightId) return null;
  const groupId = room.groupedLightId;
  const wasOn = roomIsOn(room, s.lights);
  const xy = hexToXy(hex);
  return {
    next: {
      ...s,
      lights: s.lights.map((l) => {
        if (!room.lightIds.includes(l.id)) return l;
        const on = wasOn ? l.on : true;
        return l.kind === 'color' ? { ...l, on, color: hex, mirek: null } : { ...l, on };
      }),
    },
    // Only a room that was off needs `on`: otherwise lights that are off stay off.
    send: () => setRoom(groupId, wasOn ? { xy } : { on: true, xy }),
  };
}

/** Sets every light in a room that takes a white temperature to it. */
export function planRoomKelvin(s: Snapshot, roomId: string, kelvin: number): Planned | null {
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room?.groupedLightId) return null;
  const groupId = room.groupedLightId;
  const wasOn = roomIsOn(room, s.lights);
  const mirek = kelvinToMirek(kelvin);
  return {
    next: {
      ...s,
      lights: s.lights.map((l) => {
        if (!room.lightIds.includes(l.id)) return l;
        const on = wasOn ? l.on : true;
        if (!hasTemperature(l)) return { ...l, on };
        const m = mirekFor(l, kelvin);
        return { ...l, on, color: mirekToHex(m), mirek: m };
      }),
    },
    send: () => setRoom(groupId, wasOn ? { mirek } : { on: true, mirek }),
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

/** A saved look (palette Favorite) as a bridge state. */
type Look = { hex?: string; kelvin?: number; brightness: number };

/** Puts a light back in a saved look: its color or white, and its brightness. */
export function planLightLook(s: Snapshot, lightId: string, look: Look): Planned | null {
  const light = s.lights.find((l) => l.id === lightId);
  if (!light || light.brightness === null) return null;
  const xy = look.hex && light.kind === 'color' ? hexToXy(look.hex) : undefined;
  const mirek = !xy && look.kelvin && hasTemperature(light) ? mirekFor(light, look.kelvin) : undefined;
  const brightness = look.brightness;
  return {
    next: {
      ...s,
      lights: s.lights.map((l) =>
        l.id !== lightId ? l : { ...l, on: true, brightness, ...(xy ? { color: look.hex!, mirek: null } : mirek ? { color: mirekToHex(mirek), mirek } : {}) },
      ),
    },
    send: () => setLight(lightId, { on: true, brightness, xy, mirek }),
  };
}

/** A saved look on a whole room: lights that can't do the color or white just take the brightness. */
export function planRoomLook(s: Snapshot, roomId: string, look: Look): Planned | null {
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room?.groupedLightId) return null;
  const groupId = room.groupedLightId;
  const xy = look.hex ? hexToXy(look.hex) : undefined;
  const mirek = !xy && look.kelvin ? kelvinToMirek(look.kelvin) : undefined;
  return {
    next: {
      ...s,
      lights: s.lights.map((l) => {
        if (!room.lightIds.includes(l.id)) return l;
        const base = { ...l, on: true, brightness: l.brightness === null ? null : look.brightness };
        if (xy && l.kind === 'color') return { ...base, color: look.hex!, mirek: null };
        if (look.kelvin && hasTemperature(l)) {
          const m = mirekFor(l, look.kelvin);
          return { ...base, color: mirekToHex(m), mirek: m };
        }
        return base;
      }),
    },
    send: () => setRoom(groupId, { on: true, brightness: look.brightness, xy, mirek }),
  };
}

/** A group (Hue zone) on or off. */
export function planToggleZone(s: Snapshot, zoneId: string, target?: boolean): Planned | null {
  const zone = s.zones?.find((z) => z.id === zoneId);
  if (!zone?.groupedLightId) return null;
  const on = target ?? !s.lights.some((l) => zone.lightIds.includes(l.id) && l.on && l.reachable);
  const groupId = zone.groupedLightId;
  return {
    next: { ...s, lights: s.lights.map((l) => (zone.lightIds.includes(l.id) ? { ...l, on } : l)) },
    send: () => setRoom(groupId, { on }),
  };
}
