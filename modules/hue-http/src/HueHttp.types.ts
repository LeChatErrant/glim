export type { HueHttpRequest, HueHttpResponse } from './HueHttpModule';

/** The Quick Settings tile's target, ready for native taps (src/lib/tile.ts). */
export type TileConfig = { kind: 'room' | 'group' | 'home' | 'mood'; icon: 'room' | 'home' | 'mood' | 'sleep'; label: string; sub: string; lights: string[]; on: string; off: string };
