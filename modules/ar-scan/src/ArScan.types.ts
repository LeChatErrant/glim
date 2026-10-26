import type { StyleProp, ViewStyle } from 'react-native';

/** A point on the floor in AR world coordinates, in meters. */
export type FloorPoint = { x: number; z: number };

export type ArStatus = {
  tracking: 'tracking' | 'paused' | 'stopped';
  /** ARCore tracking failure reason, e.g. "none", "insufficient_light", "excessive_motion". */
  reason: string;
  floorFound: boolean;
  aimingAtFloor: boolean;
  /** Object aim mode: the center ray hits a real surface (the light itself). */
  aimingAtObject: boolean;
  closesShape: boolean;
  camera?: FloorPoint;
  /** Radians, 0 = facing -Z in world space. */
  heading?: number;
  reticle?: FloorPoint;
};

/** In object aim mode with an object hit, x/z and rawX/rawZ are the floor point below it. */
export type ArCapture = FloorPoint & { rawX: number; rawZ: number; closesShape: boolean };

/** `floor`: aim at the floor (corners). `object`: point at anything, it lands on the floor below (lights). */
export type ArAimMode = 'floor' | 'object';

export type ArOverlay = {
  polylines: { points: FloorPoint[]; closed?: boolean; color?: string }[];
  /**
   * `edge`: when off screen, an arrow at the screen edge points to it.
   * `kind`: corners are diamonds with a number beside them, lights are jewels with a name pill.
   */
  markers: (FloorPoint & { color?: string; label?: string; edge?: boolean; kind?: 'corner' | 'light' })[];
  /** Index of the polyline being drawn (for the rubber band and snapping). */
  activeIndex?: number;
};

export type ArScanViewProps = {
  overlay: ArOverlay;
  snapEnabled?: boolean;
  aimMode?: ArAimMode;
  onStatus?: (status: ArStatus) => void;
  onError?: (error: { message: string; kind: string }) => void;
  style?: StyleProp<ViewStyle>;
};

export type ArScanHandle = { capture: () => Promise<ArCapture | null> };
