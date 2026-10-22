import * as SecureStore from 'expo-secure-store';

import { HueHttp } from '../../../modules/hue-http';

export type BridgeConfig = {
  ip: string;
  /** Bridge ID, lowercase. It's the CN of the bridge's certificate. */
  id: string;
  appKey: string;
  /** SHA-256 of the bridge certificate's public key, recorded at pairing. */
  pin: string;
};

const KEY = 'bridge';
let cached: BridgeConfig | null | undefined;

export async function getBridge(): Promise<BridgeConfig | null> {
  if (cached !== undefined) return cached;
  const raw = await SecureStore.getItemAsync(KEY);
  cached = raw ? (JSON.parse(raw) as BridgeConfig) : null;
  return cached;
}

export async function saveBridge(config: BridgeConfig) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(config));
  cached = config;
  await HueHttp.setFastConfig(config);
}

export async function forgetBridge() {
  await SecureStore.deleteItemAsync(KEY);
  cached = null;
  await HueHttp.setFastConfig(null);
}

/** Keeps the native copy used by widget fast taps in sync (e.g. after an app update). */
export async function syncFastConfig() {
  const b = await getBridge();
  await HueHttp.setFastConfig(b);
}

export type DiscoveredBridge = { id: string; ip: string; reachable: boolean };

/** Lists bridges registered on this network (Hue's discovery service), and checks each one locally. */
export async function discoverBridges(): Promise<DiscoveredBridge[]> {
  const res = await fetch('https://discovery.meethue.com');
  const list = (await res.json()) as { id: string; internalipaddress: string }[];
  return Promise.all(
    list.map(async (b) => {
      const id = b.id.toLowerCase();
      try {
        const r = await HueHttp.request({ url: `https://${b.internalipaddress}/api/config`, bridgeId: id, timeoutMs: 2500 });
        return { id, ip: b.internalipaddress, reachable: r.status === 200 };
      } catch {
        return { id, ip: b.internalipaddress, reachable: false };
      }
    }),
  );
}

export type PairResult = { ok: true; config: BridgeConfig } | { ok: false; reason: 'link_button' | 'error'; message?: string };

/** One pairing attempt. Succeeds only within 30 s of the bridge's link button being pressed. */
export async function pairOnce(bridge: { id: string; ip: string }): Promise<PairResult> {
  try {
    const r = await HueHttp.request({
      url: `https://${bridge.ip}/api`,
      method: 'POST',
      body: JSON.stringify({ devicetype: 'hue-lab#android', generateclientkey: true }),
      bridgeId: bridge.id,
      timeoutMs: 4000,
    });
    const body = JSON.parse(r.body) as { success?: { username: string }; error?: { type: number; description: string } }[];
    const first = body[0];
    if (first?.success) {
      return { ok: true, config: { ip: bridge.ip, id: bridge.id, appKey: first.success.username, pin: r.pin } };
    }
    if (first?.error?.type === 101) return { ok: false, reason: 'link_button' };
    return { ok: false, reason: 'error', message: first?.error?.description };
  } catch (e) {
    return { ok: false, reason: 'error', message: String(e) };
  }
}
