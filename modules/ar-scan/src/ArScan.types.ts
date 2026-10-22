import type { StyleProp, ViewStyle } from 'react-native';

/** A point on the floor in AR world coordinates, in meters. */
export type FloorPoint = { x: number; z: number };

export type ArStatus = {
  tracking: 'tracking' | 'paused' | 'stopped';
  /** ARCore tracking failure reason, e.g. "none", "insufficient_light", "excessive_motion". */
  reason: string;
  floorFound: boolean;
  aimingAtFloor: boolean;
  closesShape: boolean;
  camera?: FloorPoint;
  /** Radians, 0 = facing -Z in world space. */
  heading?: number;
  reticle?: FloorPoint;
};

export type ArCapture = FloorPoint & { rawX: number; rawZ: number; closesShape: boolean };

export type ArOverlay = {
  polylines: { points: FloorPoint[]; closed?: boolean; color?: string }[];
  markers: (FloorPoint & { color?: string; label?: string })[];
  /** Index of the polyline being drawn (for the rubber band and snapping). */
  activeIndex?: number;
};

export type ArScanViewProps = {
  overlay: ArOverlay;
  snapEnabled?: boolean;
  onStatus?: (status: ArStatus) => void;
  onError?: (error: { message: string; kind: string }) => void;
  style?: StyleProp<ViewStyle>;
};

export type ArScanHandle = { capture: () => Promise<ArCapture | null> };
