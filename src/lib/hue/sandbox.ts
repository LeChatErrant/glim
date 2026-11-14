import AsyncStorage from '@react-native-async-storage/async-storage';

import { HueHttp } from '../../../modules/hue-http';

/**
 * Glim Fresh: the sandbox build (plugins/with-fresh-variant.js), for testing the first-time setup
 * without touching the real one. It pairs with the real bridge, reads it and drives the real
 * lights (on, brightness, color, effects, the identify blink), but never changes the bridge's
 * configuration. Instead it shows the bridge as if new: no rooms, no groups, no scenes, no
 * behaviors. What the app creates (rooms, groups, moods' scenes, rituals, names, light types)
 * lives here, on the phone, and answers like the bridge would.
 *
 * Native code checks every request again (Sandbox.kt) and refuses config writes, so a bug here
 * can't reach the bridge either.
 */
export const SANDBOX: boolean = (() => {
  try {
    return HueHttp.isSandbox?.() ?? false;
  } catch {
    return false;
  }
})();

type Res = Record<string, any> & { id: string; type: string };
type Reply = { status: number; body: string };
type Real = (path: string, method: 'GET' | 'PUT' | 'POST' | 'DELETE', body?: string) => Promise<Reply>;

/** Resources that exist only on the phone in the sandbox. The real ones are hidden. */
const VIRTUAL = ['room', 'zone', 'scene', 'behavior_instance', 'smart_scene'] as const;
const isVirtual = (t: string): t is (typeof VIRTUAL)[number] => (VIRTUAL as readonly string[]).includes(t);

type Overlay = {
  res: Record<string, Record<string, Res>>;
  /** Grouped lights of sandbox rooms and groups: id → owner. */
  groups: Record<string, { rid: string; rtype: string }>;
  /** Names and types given to devices in the sandbox. */
  meta: Record<string, { name?: string; archetype?: string }>;
  /** Device → its light ids, from the last read of the real lights. */
  deviceLights: Record<string, string[]>;
};

const empty = (): Overlay => ({ res: {}, groups: {}, meta: {}, deviceLights: {} });
const KEY = (bridgeId: string) => `sandbox:${bridgeId}`;
const cache = new Map<string, Overlay>();

async function load(bridgeId: string): Promise<Overlay> {
  const hit = cache.get(bridgeId);
  if (hit) return hit;
  let o = empty();
  try {
    const raw = await AsyncStorage.getItem(KEY(bridgeId));
    if (raw) o = { ...o, ...(JSON.parse(raw) as Overlay) };
  } catch {
    // Unreadable: start from a new bridge.
  }
  cache.set(bridgeId, o);
  return o;
}

async function save(bridgeId: string, o: Overlay) {
  await AsyncStorage.setItem(KEY(bridgeId), JSON.stringify(o));
  await HueHttp.setSandboxGroups?.(JSON.stringify(groupLights(o))).catch(() => null);
}

/** Forgets everything made in the sandbox for this bridge: it looks new again. */
export async function resetSandbox(bridgeId: string) {
  cache.delete(bridgeId);
  await AsyncStorage.removeItem(KEY(bridgeId));
  await HueHttp.setSandboxGroups?.(null).catch(() => null);
}

/** Light ids of a sandbox room (children are devices) or group (children are lights). */
function lightsOf(o: Overlay, owner: Res | undefined): string[] {
  if (!owner) return [];
  return ((owner.children ?? []) as { rid: string; rtype: string }[]).flatMap((c) =>
    c.rtype === 'light' ? [c.rid] : c.rtype === 'device' ? (o.deviceLights[c.rid] ?? []) : [],
  );
}

function groupLights(o: Overlay): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, owner] of Object.entries(o.groups)) out[id] = lightsOf(o, o.res[owner.rtype]?.[owner.rid]);
  return out;
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const ok = (data: unknown[]): Reply => ({ status: 200, body: JSON.stringify({ errors: [], data }) });
const fail = (status: number, description: string): Reply => ({ status, body: JSON.stringify({ errors: [{ description }], data: [] }) });
const parse = (body?: string) => {
  try {
    return body ? (JSON.parse(body) as Record<string, any>) : {};
  } catch {
    return {};
  }
};
const dataOf = (r: Reply) => (parse(r.body).data ?? []) as Res[];

/** Sends `body` to each light, a few at a time (the bridge takes ~10 changes a second). */
async function toLights(real: Real, ids: string[], body: Record<string, any>) {
  const queue = [...ids];
  const json = JSON.stringify(body);
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await real(`light/${id}`, 'PUT', json).catch(() => null);
    }),
  );
}

/**
 * Answers one CLIP v2 request in the sandbox: from the phone for rooms, groups, scenes and
 * behaviors, from the real bridge for lights and devices (with the sandbox's names on top).
 */
export async function sandboxSend(bridgeId: string, path: string, method: 'GET' | 'PUT' | 'POST' | 'DELETE', body: string | undefined, real: Real): Promise<Reply> {
  const o = await load(bridgeId);
  const [type, id] = path.split('?')[0].split('/');
  const input = parse(body);

  if (method === 'GET') {
    if (isVirtual(type)) {
      const all = o.res[type] ?? {};
      if (!id) return ok(Object.values(all));
      return all[id] ? ok([all[id]]) : fail(404, `${type} ${id} not found`);
    }
    if (type === 'grouped_light' && id && o.groups[id]) {
      const lights = new Set(lightsOf(o, o.res[o.groups[id].rtype]?.[o.groups[id].rid]));
      const states = dataOf(await real('light', 'GET')).filter((l) => lights.has(l.id));
      return ok([{ id, type: 'grouped_light', owner: o.groups[id], on: { on: states.some((l) => l.on?.on) } }]);
    }
    const r = await real(path, 'GET');
    if (r.status >= 400) return r;
    if (type === 'light' && !id) {
      const deviceLights: Record<string, string[]> = {};
      for (const l of dataOf(r)) (deviceLights[l.owner?.rid] ??= []).push(l.id);
      if (JSON.stringify(deviceLights) !== JSON.stringify(o.deviceLights)) {
        o.deviceLights = deviceLights;
        await save(bridgeId, o);
      }
    }
    if (type === 'device') {
      return ok(dataOf(r).map((d) => (o.meta[d.id] ? { ...d, metadata: { ...d.metadata, ...o.meta[d.id] } } : d)));
    }
    if (type === 'bridge_home') {
      // A new bridge: the home holds the sandbox's rooms and every device in none of them.
      const inRooms = new Set(Object.values(o.res.room ?? {}).flatMap((r) => (r.children ?? []).map((c: { rid: string }) => c.rid)));
      return ok(
        dataOf(r).map((h) => ({
          ...h,
          children: [
            ...Object.keys(o.res.room ?? {}).map((rid) => ({ rid, rtype: 'room' })),
            ...((h.children ?? []) as { rid: string; rtype: string }[]).filter((c) => c.rtype === 'device' && !inRooms.has(c.rid)),
          ],
        })),
      );
    }
    return r;
  }

  if (isVirtual(type)) {
    const all = (o.res[type] ??= {});
    if (method === 'POST' && !id) {
      const newId = uuid();
      const res: Res = { ...input, id: newId, type };
      if (type === 'room' || type === 'zone') {
        const gl = uuid();
        res.children ??= [];
        res.services = [{ rid: gl, rtype: 'grouped_light' }];
        o.groups[gl] = { rid: newId, rtype: type };
      }
      if (type === 'scene') res.status ??= { active: 'inactive' };
      all[newId] = res;
      await save(bridgeId, o);
      return ok([{ rid: newId, rtype: type }]);
    }
    const res = id ? all[id] : undefined;
    if (!res) return fail(404, `${type} ${id} not found`);
    if (method === 'DELETE') {
      delete all[id];
      for (const [gl, owner] of Object.entries(o.groups)) if (owner.rid === id) delete o.groups[gl];
      await save(bridgeId, o);
      return ok([{ rid: id, rtype: type }]);
    }
    if (method === 'PUT') {
      if (type === 'scene' && input.recall) {
        // A sandbox scene plays as its still look: each light set as the scene says.
        const actions = (res.actions ?? []) as { target: { rid: string; rtype: string }; action: Record<string, any> }[];
        await Promise.all(actions.filter((a) => a.target.rtype === 'light').map((a) => toLights(real, [a.target.rid], a.action)));
        return ok([{ rid: id, rtype: type }]);
      }
      if (type === 'smart_scene' && input.recall) return ok([{ rid: id, rtype: type }]);
      const { metadata, ...rest } = input;
      all[id] = { ...res, ...rest, ...(metadata ? { metadata: { ...res.metadata, ...metadata } } : {}) };
      await save(bridgeId, o);
      return ok([{ rid: id, rtype: type }]);
    }
    return fail(405, `${method} ${path} isn't supported`);
  }

  if (method === 'PUT' && type === 'grouped_light' && id && o.groups[id]) {
    const owner = o.groups[id];
    await toLights(real, lightsOf(o, o.res[owner.rtype]?.[owner.rid]), input);
    return ok([{ rid: id, rtype: 'grouped_light' }]);
  }

  if (method === 'PUT' && (type === 'device' || type === 'light') && id) {
    const { metadata, ...rest } = input;
    if (metadata && type === 'device') {
      o.meta[id] = { ...o.meta[id], ...metadata };
      await save(bridgeId, o);
    }
    // What's left is state (on, color, the identify blink): the real light takes it.
    if (Object.keys(rest).length) return real(path, 'PUT', JSON.stringify(rest));
    return ok([{ rid: id, rtype: type }]);
  }

  // Light state on real grouped lights (the whole home) is fine; anything else would change the bridge.
  if (method === 'PUT' && type === 'grouped_light') return real(path, 'PUT', body);
  return fail(403, `Glim Fresh doesn't change the bridge's configuration (${method} ${path})`);
}
