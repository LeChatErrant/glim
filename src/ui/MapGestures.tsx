import { useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import type { PlanView } from '../lib/map/map';

const FIT: PlanView = { zoom: 1, x: 0, y: 0 };
const MAX_ZOOM = 6;

type Start = { view: PlanView; dist: number; angle: number; mid: { x: number; y: number } } | { view: PlanView; dist: 0 };

function twoFingers(e: GestureResponderEvent) {
  const [a, b] = e.nativeEvent.touches;
  return {
    dist: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
    angle: (Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX) * 180) / Math.PI,
    mid: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 },
  };
}

/**
 * Pinch to zoom, drag to pan (once zoomed) and twist to turn the map. Zoom and pan are live view
 * state; a twist is shown as a live rotation, then handed to `onTurn` on release (snapped to a
 * quarter turn when close) so the map's saved orientation changes.
 */
export function useMapGestures({ width, height, onTurn }: { width: number; height: number; onTurn: (degrees: number) => void }) {
  const [view, setView] = useState<PlanView>(FIT);
  const [twist, setTwist] = useState(0);
  const origin = useRef({ x: 0, y: 0 });
  const latest = useRef({ view, width, height, onTurn, twist });
  useLayoutEffect(() => {
    latest.current = { view, width, height, onTurn, twist };
  });
  const start = useRef<Start | null>(null);

  // The handlers only read refs when touched, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const zoomed = () => latest.current.view.zoom > 1.01;
    const clampPan = (v: PlanView): PlanView => {
      const { width: w, height: h } = latest.current;
      const mx = ((v.zoom - 1) * w) / 2 + 40;
      const my = ((v.zoom - 1) * h) / 2 + 40;
      return { zoom: v.zoom, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
    };
    const begin = (e: GestureResponderEvent) => {
      if (e.nativeEvent.touches.length >= 2) start.current = { view: latest.current.view, ...twoFingers(e) };
      else start.current = { view: latest.current.view, dist: 0 };
    };
    const wants = (e: GestureResponderEvent, dx: number, dy: number) =>
      e.nativeEvent.touches.length >= 2 || (zoomed() && Math.hypot(dx, dy) > 10);
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (e, g) => wants(e, g.dx, g.dy),
      onMoveShouldSetPanResponder: (e, g) => wants(e, g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: begin,
      onPanResponderMove: (e, g) => {
        const s = start.current;
        const two = e.nativeEvent.touches.length >= 2;
        // A finger was added or lifted: restart from the current view.
        if (!s || two !== ('mid' in s)) return begin(e);
        if ('mid' in s) {
          const now = twoFingers(e);
          const zoom = Math.max(1, Math.min(MAX_ZOOM, (s.view.zoom * now.dist) / s.dist));
          // Keep the point between the fingers under them (coordinates relative to the box center).
          const c = { x: origin.current.x + latest.current.width / 2, y: origin.current.y + latest.current.height / 2 };
          const k = zoom / s.view.zoom;
          setView(clampPan({ zoom, x: now.mid.x - c.x - (s.mid.x - c.x - s.view.x) * k, y: now.mid.y - c.y - (s.mid.y - c.y - s.view.y) * k }));
          let turn = now.angle - s.angle;
          if (turn > 180) turn -= 360;
          if (turn < -180) turn += 360;
          // A small wobble while pinching isn't a twist.
          setTwist(Math.abs(turn) > 8 ? turn : 0);
        } else {
          setView(clampPan({ ...s.view, x: s.view.x + g.dx, y: s.view.y + g.dy }));
        }
      },
      onPanResponderRelease: () => {
        start.current = null;
        const t = latest.current.twist;
        if (!t) return;
        setTwist(0);
        setView(FIT);
        latest.current.onTurn(t);
      },
      onPanResponderTerminate: () => {
        start.current = null;
        setTwist(0);
      },
    });
  });

  /** Pass to the map box's onLayout: pinches are anchored in window coordinates. */
  const measure = (e: LayoutChangeEvent) => {
    const target = e.currentTarget;
    if (typeof target !== 'number') target.measureInWindow((x: number, y: number) => (origin.current = { x, y }));
  };

  return { view, twist, fit: () => setView(FIT), zoomed: view.zoom > 1.01, measure, responder };
}

/** Saved orientation after a twist: snaps to a quarter turn within 12°, else to 5°. */
export function turnTo(current: number, twist: number) {
  const raw = current + twist;
  const quarter = Math.round(raw / 90) * 90;
  return Math.abs(raw - quarter) < 12 ? quarter : Math.round(raw / 5) * 5;
}
