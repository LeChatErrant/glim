import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';

import type { BridgeConfig } from './bridge';

/**
 * Control from anywhere: the Hue Remote API (Hue's cloud), same CLIP v2 requests as the bridge.
 * The user signs in with their Hue account (OAuth2). The client secret never ships in the app: our
 * server (EAS Hosting API routes, src/app/api/hue/) starts the sign-in and swaps codes for tokens.
 * Requests also carry the bridge app key from pairing: the same key works through the cloud.
 */

/** Our token server, e.g. https://glim.expo.app. Empty in builds without cloud access. */
const SERVER = String(Constants.expoConfig?.extra?.cloudServer ?? '').replace(/\/$/, '');
export const cloudConfigured = SERVER.length > 0;

const REMOTE = 'https://api.meethue.com/route';
/** Where our server sends the browser back to (src/app/away.tsx). */
export const RETURN_PATH = 'away';

export type CloudAccount = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** When the Hue account was connected, and when its tokens were last renewed (ms). */
  connectedAt?: number;
  refreshedAt?: number;
};

const key = (bridgeId: string) => `cloud.${bridgeId}`;
const STATE_KEY = 'cloudSignInState';
const cache = new Map<string, CloudAccount | null>();
const watchers = new Set<(bridgeId: string, account: CloudAccount | null) => void>();

/** Hue account tokens for this bridge, or null when cloud access isn't connected. */
export async function getCloud(bridgeId: string): Promise<CloudAccount | null> {
  if (cache.has(bridgeId)) return cache.get(bridgeId)!;
  const raw = await SecureStore.getItemAsync(key(bridgeId));
  const account = raw ? (JSON.parse(raw) as CloudAccount) : null;
  cache.set(bridgeId, account);
  return account;
}

async function saveCloud(bridgeId: string, account: CloudAccount | null) {
  if (account) await SecureStore.setItemAsync(key(bridgeId), JSON.stringify(account));
  else await SecureStore.deleteItemAsync(key(bridgeId));
  cache.set(bridgeId, account);
  watchers.forEach((w) => w(bridgeId, account));
}

/** Called whenever tokens change (sign-in, refresh, sign-out). */
export function watchCloud(w: (bridgeId: string, account: CloudAccount | null) => void) {
  watchers.add(w);
  return () => watchers.delete(w);
}

export function disconnectCloud(bridgeId: string) {
  return saveCloud(bridgeId, null);
}

function randomState() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Opens Hue's sign-in page in the browser. It comes back to the app at /away with a code. */
export async function startCloudSignIn() {
  const state = randomState();
  await AsyncStorage.setItem(STATE_KEY, state);
  await Linking.openURL(`${SERVER}/api/hue/login?state=${state}`);
}

type TokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  access_token_expires_in?: number | string;
  error?: string;
  error_description?: string;
};

class SignedOut extends Error {}

async function tokens(grant: { code: string } | { refresh_token: string }): Promise<CloudAccount> {
  const res = await fetch(`${SERVER}/api/hue/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(grant),
  });
  const json = (await res.json().catch(() => ({}))) as TokenJson;
  if (!res.ok || !json.access_token || !json.refresh_token) {
    const message = json.error_description || json.error || `Hue sign-in failed (HTTP ${res.status})`;
    // A refresh token Hue no longer accepts (revoked, or unused for months): sign in again.
    throw json.error === 'invalid_grant' ? new SignedOut(message) : new Error(message);
  }
  const seconds = Number(json.expires_in ?? json.access_token_expires_in ?? 604800);
  const now = Date.now();
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: now + seconds * 1000, connectedAt: now, refreshedAt: now };
}

/** Finishes the sign-in with the code Hue sent back, and checks the account reaches this bridge. */
export async function finishCloudSignIn(bridge: BridgeConfig, code: string, state: string) {
  const expected = await AsyncStorage.getItem(STATE_KEY);
  if (!expected || state !== expected) throw new Error("This sign-in wasn't started from here. Try again.");
  await AsyncStorage.removeItem(STATE_KEY);
  const account = await tokens({ code });
  const r = await remote(bridge, account.accessToken, 'bridge', 'GET');
  const id = (JSON.parse(r.body || '{}') as { data?: { bridge_id?: string }[] }).data?.[0]?.bridge_id?.toLowerCase();
  if (r.status >= 400 || !id) throw new Error(`Hue's cloud can't reach your bridge (HTTP ${r.status}).`);
  if (id !== bridge.id) throw new Error('This Hue account reaches another bridge, not this one.');
  await saveCloud(bridge.id, account);
}

const refreshing = new Map<string, Promise<CloudAccount>>();

/** Tokens last a week: refresh ahead of time, once for concurrent callers. */
async function refresh(bridgeId: string, account: CloudAccount): Promise<CloudAccount> {
  let p = refreshing.get(bridgeId);
  if (!p) {
    p = tokens({ refresh_token: account.refreshToken })
      .then(async (fresh) => {
        const next = { ...fresh, connectedAt: account.connectedAt };
        await saveCloud(bridgeId, next);
        return next;
      })
      .catch(async (e) => {
        if (e instanceof SignedOut) await saveCloud(bridgeId, null);
        throw e;
      })
      .finally(() => refreshing.delete(bridgeId));
    refreshing.set(bridgeId, p);
  }
  return p;
}

/**
 * The account with a token good for a while: renewed when it has less than 2 days left. Native
 * code (widget taps, live sync away from home) uses the token without being able to renew it, and
 * the app may not run for days.
 */
export async function freshCloud(bridgeId: string): Promise<CloudAccount | null> {
  const account = await getCloud(bridgeId);
  if (!account || account.expiresAt - Date.now() > 2 * 24 * 3600_000) return account;
  return refresh(bridgeId, account).catch(() => getCloud(bridgeId));
}

async function remote(bridge: BridgeConfig, accessToken: string, path: string, method: string, body?: string) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const res = await fetch(`${REMOTE}/clip/v2/resource/${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'hue-application-key': bridge.appKey, 'Content-Type': 'application/json' },
      body,
      signal: abort.signal,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** A CLIP v2 request through Hue's cloud. Throws if cloud access isn't connected. */
export async function cloudRequest(bridge: BridgeConfig, path: string, method: string, body?: string) {
  let account = await getCloud(bridge.id);
  if (!account) throw new Error('Cloud access is not connected');
  if (account.expiresAt - Date.now() < 10 * 60_000) account = await refresh(bridge.id, account);
  let r = await remote(bridge, account.accessToken, path, method, body);
  if (r.status === 401) {
    account = await refresh(bridge.id, account);
    r = await remote(bridge, account.accessToken, path, method, body);
  }
  return r;
}
