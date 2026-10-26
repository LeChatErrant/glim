import type { LightType } from './lights';

/**
 * Line icons for light types (24×24 grid, drawn with a 1.5–2 stroke, round caps). Shared by the
 * app (react-native-svg) and the widgets (SVG strings), so a light looks the same everywhere.
 * They must read at 12 px: few strokes, big shapes.
 */
export const LIGHT_ICON_PATHS: Record<LightType, string> = {
  pendant: 'M12 2.5v6M4.5 15.5A7.5 7 0 0 1 19.5 15.5ZM10 18.5a2 2 0 0 0 4 0',
  ceiling: 'M3.5 5.5h17M6 5.5a6 6 0 0 0 12 0M12 15v3M7.2 13.6l-1.6 2.2M16.8 13.6l1.6 2.2',
  bulb: 'M9.5 17.5h5M10.5 20.5h3M12 3.5a5.5 5.5 0 0 0-3.2 10c.6.4.9 1 .9 1.7v.3h4.6v-.3c0-.7.3-1.3.9-1.7A5.5 5.5 0 0 0 12 3.5Z',
  candle: 'M12 2.5c-1.8 2.2-2.5 3.6-2.5 5a2.5 2.5 0 0 0 5 0c0-1.4-.7-2.8-2.5-5ZM9.5 12.5h5v8h-5Z',
  spot: 'M9 3.5h6v6.5H9ZM9 10l-3.5 9.5M15 10l3.5 9.5',
  go: 'M4 17.5A8 8 0 0 1 20 17.5ZM6.5 20.5h11',
  table: 'M8 4h8l3 7.5H5ZM12 11.5v7.5M8.5 19.5h7',
  floor: 'M9 3h6l2 5.5H7ZM12 8.5v12.5M8.5 21h7',
  bar: 'M10 3.5h4v14h-4ZM12 17.5v3M8.5 20.5h7',
  strip: 'M3.5 11c2.8-4.5 5.7-4.5 8.5 0s5.7 4.5 8.5 0M3.5 16c2.8-4.5 5.7-4.5 8.5 0s5.7 4.5 8.5 0',
  string:
    'M2.5 5.5Q12 15.5 21.5 5.5M7.25 9.25v1.6M12 10.5v1.6M16.75 9.25v1.6' +
    'M8.65 12.25a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0ZM13.4 13.5a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0ZM18.15 12.25a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z',
  lantern: 'M4.5 4v16M4.5 10h3M7.5 7.5 12 4l4.5 3.5v9h-9Z',
  plug: 'M9 3.5v4.5M15 3.5v4.5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0ZM12 17v3.5',
};

/** Dark ink on bright light colors, ivory on deep ones (a deep blue). */
export function inkOn(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.5 ? 'rgba(24,14,6,0.82)' : 'rgba(255,246,230,0.92)';
}
