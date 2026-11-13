/**
 * Sunrise and sunset for a place and a day (NOAA's simple solar position formula, within a minute
 * or two), in local clock minutes after midnight. Works offline, so a background task can tell
 * whether the sun has set without asking a weather service. Null when the sun doesn't rise or set
 * that day (polar day or night).
 */
export function sunTimes(lat: number, lon: number, date = new Date()): { rise: number; set: number } | null {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 864e5);
  const g = ((2 * Math.PI) / 365) * (day - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = Math.acos(cosH) / rad;
  // UTC minutes, then local: the device's offset for that day.
  const offset = -new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTimezoneOffset();
  const rise = 720 - 4 * (lon + ha) - eqTime + offset;
  const set = 720 - 4 * (lon - ha) - eqTime + offset;
  return { rise: Math.round(rise), set: Math.round(set) };
}
