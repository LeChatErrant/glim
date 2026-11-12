import { PixelRatio } from 'react-native';
import type { WidgetInfo } from 'react-native-android-widget';

import { HueHttp } from '../../modules/hue-http';
import type { Light } from '../lib/hue/client';
import { fitPlan, type Plan } from '../lib/map/map';
import { houseGeom, widgetOutside, type WidgetBackground } from '../lib/weather/scene';
import { clamp } from '../lib/weather/sky';
import type { Outside } from '../lib/weather/source';
import { GROUND, mapWidgetBox } from './widgets';

/** Bitmap memory for one widget's two still images, held by the launcher. */
const BUDGET = 8_000_000;

/**
 * Draws a map widget's outside: still ground and house layers rendered natively, with smooth
 * weather animations between and over them, played by the launcher. Nothing (or `outside` null)
 * clears it. Builds without the native side ignore this.
 */
export async function sendMapOutside(info: WidgetInfo, plan: Plan | null, lights: Light[], outside: Outside | null, background: WidgetBackground = 'black') {
  if (!HueHttp.setWidgetOutside) return;
  const base = { widgetId: info.widgetId, width: info.width, height: info.height, scale: 1 };
  if (!outside || !plan) return HueHttp.setWidgetOutside({ ...base, low: [], high: [] });
  const { box, pad, radius } = mapWidgetBox(info.width, info.height, true);
  const fit = fitPlan(plan, box.width, box.height, pad);
  const f = { scale: fit.scale, x: (u: number) => box.left + fit.x(u), y: (v: number) => box.top + fit.y(v) };
  const geom = houseGeom(plan, f, lights);
  const u = clamp(fit.scale / 30, 0.45, 1);
  const { ground, over, low, high } = widgetOutside(outside.sky, info.width, info.height, geom, { u, radius, ink: GROUND, background });
  // Sharp at the screen's density, within the budget.
  const scale = clamp(Math.min(PixelRatio.get(), Math.sqrt(BUDGET / (2 * info.width * info.height * 4))), 1, 3);
  return HueHttp.setWidgetOutside({ ...base, scale, ground, over, low, high });
}
