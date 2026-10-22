import { requireNativeView } from 'expo';
import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { ArCapture, ArScanHandle, ArScanViewProps, ArStatus } from './ArScan.types';

type NativeProps = {
  overlayJson: string;
  snapEnabled: boolean;
  onStatus?: (e: { nativeEvent: ArStatus }) => void;
  onError?: (e: { nativeEvent: { message: string; kind: string } }) => void;
  style?: StyleProp<ViewStyle>;
};

type NativeRef = { capture: () => Promise<ArCapture | null> };

const NativeView = requireNativeView<NativeProps>('ArScan') as unknown as React.ComponentType<
  NativeProps & { ref?: React.Ref<NativeRef> }
>;

export default function ArScanView({ ref, overlay, snapEnabled = true, onStatus, onError, style }: ArScanViewProps & { ref?: React.Ref<ArScanHandle> }) {
  const nativeRef = React.useRef<NativeRef>(null);
  React.useImperativeHandle(ref, () => ({ capture: () => nativeRef.current?.capture() ?? Promise.resolve(null) }), []);
  const overlayJson = React.useMemo(() => JSON.stringify(overlay), [overlay]);
  return (
    <NativeView
      ref={nativeRef}
      overlayJson={overlayJson}
      snapEnabled={snapEnabled}
      onStatus={onStatus && ((e) => onStatus(e.nativeEvent))}
      onError={onError && ((e) => onError(e.nativeEvent))}
      style={style}
    />
  );
}
