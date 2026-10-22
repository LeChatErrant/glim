import { NativeModule, requireNativeModule } from 'expo';

declare class ArScanModule extends NativeModule<{}> {
  availability(): Promise<'supported' | 'supported_not_installed' | 'unsupported' | 'unknown'>;
}

export default requireNativeModule<ArScanModule>('ArScan');
