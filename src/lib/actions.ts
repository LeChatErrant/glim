import { cachedSnapshot, patchCachedSnapshot, setLight, setRoom, type Snapshot } from './hue/client';

/**
 * Light actions shared by the app and the widgets: apply locally first (so the UI and
 * widgets update instantly), then send to the bridge.
 */

export async function toggleLight(lightId: string): Promise<Snapshot | null> {
  const s = await cachedSnapshot();
  const light = s?.lights.find((l) => l.id === lightId);
  if (!light) return s;
  const on = !light.on;
  const next = await patchCachedSnapshot((snap) => ({
    ...snap,
    lights: snap.lights.map((l) => (l.id === lightId ? { ...l, on } : l)),
  }));
  await setLight(lightId, { on });
  return next;
}

export async function toggleRoom(roomId: string): Promise<Snapshot | null> {
  const s = await cachedSnapshot();
  const room = s?.rooms.find((r) => r.id === roomId);
  if (!s || !room?.groupedLightId) return s;
  const on = !s.lights.some((l) => room.lightIds.includes(l.id) && l.on);
  const next = await patchCachedSnapshot((snap) => ({
    ...snap,
    lights: snap.lights.map((l) => (room.lightIds.includes(l.id) ? { ...l, on } : l)),
  }));
  await setRoom(room.groupedLightId, { on });
  return next;
}

export async function setRoomBrightness(roomId: string, brightness: number) {
  const s = await cachedSnapshot();
  const room = s?.rooms.find((r) => r.id === roomId);
  if (!room?.groupedLightId) return;
  await patchCachedSnapshot((snap) => ({
    ...snap,
    lights: snap.lights.map((l) => (room.lightIds.includes(l.id) && l.brightness !== null ? { ...l, on: true, brightness } : l)),
  }));
  await setRoom(room.groupedLightId, { on: true, brightness });
}

export async function setLightBrightness(lightId: string, brightness: number) {
  await patchCachedSnapshot((snap) => ({
    ...snap,
    lights: snap.lights.map((l) => (l.id === lightId ? { ...l, on: true, brightness } : l)),
  }));
  await setLight(lightId, { on: true, brightness });
}
