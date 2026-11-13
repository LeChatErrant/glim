/**
 * Switches for pieces that wait on a test. Both passed on 2026-11-13 and are on:
 * - Arriving and leaving home (geofence logic tested with simulated crossings on the real lights;
 *   a real crossing needs "Allow all the time", granted by the maintainer).
 * - After sleep: the level reset a minute after a sleep fade (lights otherwise come back at ~1%).
 */
export const ARRIVE_READY = true;
export const AFTER_SLEEP_READY = true;
