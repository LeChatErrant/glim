import type { WidgetInfo } from 'react-native-android-widget';

import { HueHttp } from '../../modules/hue-http';
import type { Light } from '../lib/hue/client';
import { fitPlan, type Plan } from '../lib/map/map';
import { houseGeom, widgetFrames } from '../lib/weather/scene';
import { clamp } from '../lib/weather/sky';
import type { Outside } from '../lib/weather/source';
import { GROUND, mapWidgetBox } from './widgets';

/**
 * Bitmap memory for one widget's frames, held by the launcher. Kept under what Android lets one
 * widget send inline (1.5 screens of pixels, ~15 MB on a phone), and big enough for 32 rain
 * frames near 1 px per dp.
 */
const BUDGET = 10_000_000;

/**
 * Animates a map widget's outside: the frames go to native code, which renders them and puts
 * them in a flipper under the widget's image, so the launcher plays the loop on its own.
 * Nothing (or `outside` null) clears it. Builds without the native side ignore this.
 */
export async function sendMapFrames(info: WidgetInfo, plan: Plan | null, lights: Light[], outside: Outside | null) {
  if (!HueHttp.setWidgetFrames) return;
  const base = { widgetId: info.widgetId, width: info.width, height: info.height };
  if (!outside || !plan) return HueHttp.setWidgetFrames({ ...base, frames: [], intervalMs: 1000, scale: 1 });
  const { box, pad, radius } = mapWidgetBox(info.width, info.height, true);
  const fit = fitPlan(plan, box.width, box.height, pad);
  const f = { scale: fit.scale, x: (u: number) => box.left + fit.x(u), y: (v: number) => box.top + fit.y(v) };
  const geom = houseGeom(plan, f, lights);
  const u = clamp(fit.scale / 30, 0.45, 1);
  const { frames, intervalMs } = widgetFrames(outside.sky, info.width, info.height, geom, { u, radius, ink: GROUND });
  const scale = clamp(Math.sqrt(BUDGET / (frames.length * info.width * info.height * 4)), 0.5, 1.5);
  return HueHttp.setWidgetFrames({ ...base, frames, intervalMs, scale });
}
