import AsyncStorage from '@react-native-async-storage/async-storage';

import { HueHttp } from '../../../modules/hue-http';
import type { BridgeConfig } from './bridge';
import { cloudRequest, freshCloud, getCloud, watchCloud } from './cloud';
import { SANDBOX, sandboxSend } from './sandbox';

/**
 * How requests reach the bridge: straight to it on the home network ("local"), or through Hue's
 * cloud when it doesn't answer ("cloud"). Same CLIP v2 requests either way. The route is kept
 * across app and widget starts, and checked again: while on the cloud, the bridge is tried now
 * and then, and the app goes back to it as soon as it answers.
 */
export type Route = 'local' | 'cloud';

const ROUTE_KEY = 'route';
const PROBE_EVERY_MS = 20_000;

let route: Route = 'local';
const loaded = AsyncStorage.getItem(ROUTE_KEY)
  .then((r) => {
    if (r === 'cloud') route = 'cloud';
  })
  .catch(() => null);
let lastProbe = 0;
let probing: Promise<void> | null = null;
const listeners = new Set<(r: Route) => void>();

export const currentRoute = () => route;

export function onRouteChange(l: (r: Route) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function setRoute(next: Route, bridgeId: string) {
  if (route === next) return;
  route = next;
  AsyncStorage.setItem(ROUTE_KEY, next).catch(() => null);
  listeners.forEach((l) => l(next));
  syncNativeCloud(bridgeId).catch(() => null);
}

/** Widget taps and live sync run in native code: give it the cloud token and the route to try first. */
export async function syncNativeCloud(bridgeId: string) {
  await loaded;
  const account = await freshCloud(bridgeId);
  await HueHttp.setCloudConfig?.(account ? { accessToken: account.accessToken, expiresAt: account.expiresAt, preferCloud: route === 'cloud' } : null);
}

watchCloud((bridgeId) => {
  syncNativeCloud(bridgeId).catch(() => null);
});

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE';

function local(bridge: BridgeConfig, path: string, method: Method, body: string | undefined, timeoutMs = 4000) {
  return HueHttp.request({
    url: `https://${bridge.ip}/clip/v2/resource/${path}`,
    method,
    headers: { 'hue-application-key': bridge.appKey },
    body,
    bridgeId: bridge.id,
    pin: bridge.pin,
    timeoutMs,
  });
}

/** While on the cloud: is the bridge reachable again (back home)? At most every 20 s unless forced. */
export function probeLocal(bridge: BridgeConfig, force = false) {
  if (route !== 'cloud' || probing || (!force && Date.now() - lastProbe < PROBE_EVERY_MS)) return probing ?? Promise.resolve();
  lastProbe = Date.now();
  probing = local(bridge, 'bridge', 'GET', undefined, 1500)
    .then((r) => {
      if (r.status === 200) setRoute('local', bridge.id);
    })
    .catch(() => {})
    .finally(() => {
      probing = null;
    });
  return probing;
}

/**
 * Sends a CLIP v2 request by the current route. If the bridge doesn't answer at all (not an error
 * reply) and cloud access is connected, switches to the cloud and sends it there.
 */
export async function send(bridge: BridgeConfig, path: string, method: Method, body?: string): Promise<{ status: number; body: string }> {
  // Glim Fresh: rooms, groups, scenes and behaviors live on the phone, the bridge only lends its lights.
  if (SANDBOX) return sandboxSend(bridge.id, path, method, body, (p, m, b) => local(bridge, p, m, b));
  await loaded;
  if (route === 'cloud') {
    probeLocal(bridge);
    if (await getCloud(bridge.id)) return cloudRequest(bridge, path, method, body);
    setRoute('local', bridge.id);
  }
  try {
    return await local(bridge, path, method, body);
  } catch (e) {
    // No answer from the bridge: probably away from home.
    if (!(await getCloud(bridge.id))) throw e;
    setRoute('cloud', bridge.id);
    return cloudRequest(bridge, path, method, body);
  }
}
