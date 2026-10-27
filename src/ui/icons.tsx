import Svg, { Path } from 'react-native-svg';

import { color } from './theme';

// Stroke icons from the Nocturne Foundations page (24×24, 1.5 stroke, round caps).
const PATHS = {
  power: 'M12 3.5v7.5M6.6 7.4a7.5 7.5 0 1 0 10.8 0',
  map: 'M3 4h11v9H3zM14 4h7v6h-7zM14 10h7v10h-7zM3 13h11v7H3z',
  rooms: 'M4 7h16M4 12h16M4 17h10',
  moods: 'M14 10a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM20 10a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM17 15a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  rituals: 'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0ZM12 7.5V12l3 2',
  sleep: 'M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10Z',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z',
  blink: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0M12 19h.01',
  cloud: 'M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18Z',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  rain: 'M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 14ZM8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3',
  storm: 'M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 14ZM12.5 15.5l-2 3h3l-2 3',
  snow: 'M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 14ZM8 18h.01M12 20h.01M16 18h.01',
  fog: 'M4 9h16M4 13h16M7 17h10',
  location: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11ZM14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  scan: 'M4 8h3l2-3h6l2 3h3v11H4ZM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
  edit: 'M4 20h4L19 9l-4-4L4 16Z',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  add: 'M12 5v14M5 12h14',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 5 7 7-7 7',
  back: 'm15 5-7 7 7 7',
  close: 'M6 6l12 12M18 6 6 18',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  bridge: 'M8.5 4h7A4.5 4.5 0 0 1 20 8.5v7a4.5 4.5 0 0 1-4.5 4.5h-7A4.5 4.5 0 0 1 4 15.5v-7A4.5 4.5 0 0 1 8.5 4ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
  warning: 'M12 3.5 2.8 19.5h18.4ZM12 10v4M12 16.8h.01',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z',
  rotate: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, tint = color.ivory, stroke = 1.5 }: { name: IconName; size?: number; tint?: string; stroke?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={PATHS[name]} stroke={tint} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
