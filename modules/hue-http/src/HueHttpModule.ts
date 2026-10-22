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

declare class HueHttpModule extends NativeModule<{}> {
  request(options: HueHttpRequest): Promise<HueHttpResponse>;
}

export default requireNativeModule<HueHttpModule>('HueHttp');
