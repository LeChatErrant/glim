import { NativeModule, requireNativeModule } from 'expo';

export type HueHttpRequest = {
  url: string;
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  bridgeId?: string;
  pin?: string;
  timeoutMs?: number;
};

export type HueHttpResponse = { status: number; body: string; pin: string; cn: string };

type Events = { onChange: () => void };

declare class HueHttpModule extends NativeModule<Events> {
  request(options: HueHttpRequest): Promise<HueHttpResponse>;
  /** Credentials the native widget provider uses for instant taps. Null clears them. */
  setFastConfig(config: { ip: string; id: string; appKey: string; pin: string } | null): Promise<void>;
  /**
   * Hue cloud token for widget taps away from home, and whether to try the cloud first (the app
   * is on the cloud route). Null clears it. Missing in builds older than cloud access.
   */
  setCloudConfig?(config: { accessToken: string; expiresAt: number; preferCloud: boolean } | null): Promise<void>;
  /**
   * A map widget's outside under its image (WidgetOutside.kt): `ground` and `over` SVGs, rendered
   * natively at `scale` px per dp, with animations between them (`low`) and above (`high`),
   * played by the launcher. Nothing clears it. Missing in older builds.
   */
  setWidgetOutside?(options: {
    widgetId: number;
    width: number;
    height: number;
    scale: number;
    ground?: string;
    over?: string;
    low: WidgetFx[];
    high: WidgetFx[];
  }): Promise<void>;
  /** Starts live sync (widgets follow the bridge's event stream) if enabled and paired. */
  startLive(): Promise<void>;
  setLiveEnabled(on: boolean): Promise<void>;
  isLiveEnabled(): boolean;
}

export default requireNativeModule<HueHttpModule>('HueHttp');

/**
 * One widget animation (scripts/widget-fx.mjs): a full field (`kind` only) or a placed one,
 * centered at `x`, `y`, `w` × `h` dp. `tint` (#AARRGGBB) recolors it.
 */
export type WidgetFx = { kind: string; x?: number; y?: number; w?: number; h?: number; tint?: string };
