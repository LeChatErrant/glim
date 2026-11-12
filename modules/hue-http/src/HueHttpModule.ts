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
   * Plays SVG frames (one loop, `intervalMs` apart) under a widget's image: rendered natively at
   * `scale` px per dp, flipped by the launcher. Empty frames clear them. Missing in older builds.
   */
  setWidgetFrames?(options: {
    widgetId: number;
    frames: string[];
    intervalMs: number;
    width: number;
    height: number;
    scale: number;
    /** Lightning: an SVG shown at `flashSteps[i]` opacity for `flashMs` each, on its own strip. */
    flash?: string;
    flashSteps?: number[];
    flashMs?: number;
  }): Promise<void>;
  /** Starts live sync (widgets follow the bridge's event stream) if enabled and paired. */
  startLive(): Promise<void>;
  setLiveEnabled(on: boolean): Promise<void>;
  isLiveEnabled(): boolean;
}

export default requireNativeModule<HueHttpModule>('HueHttp');
