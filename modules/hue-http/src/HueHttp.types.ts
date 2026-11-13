export type { HueHttpRequest, HueHttpResponse } from './HueHttpModule';

/** The Quick Settings tile's target, ready for native taps (src/lib/tile.ts). */
export type TileConfig = {
  kind: 'room' | 'group' | 'home' | 'mood' | 'sleep';
  icon: 'room' | 'home' | 'mood' | 'sleep';
  label: string;
  sub: string;
  lights: string[];
  on: string;
  off: string;
  /** JSON: a path's auto-off ({ pathOff: { key, min, lights } }) or a sleep fade ({ sleep: { targets, fadeSec } }). */
  extra?: string;
};
