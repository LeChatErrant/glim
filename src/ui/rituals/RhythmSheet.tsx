import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { mirekToHex } from '../../lib/hue/color';
import type { Snapshot } from '../../lib/hue/client';
import { RHYTHM_PRESETS, sortPoints, valueAt, type RhythmPoint, type RhythmRitual } from '../../lib/rituals/rhythm';
import { fmtClock } from '../../lib/rituals/time';
import { PillButton, Slider } from '../controls';
import { Field, ModalSheet } from '../ModalSheet';
import { Choice } from '../scan/parts';
import { Label, Txt } from '../text';
import { color, hairline } from '../theme';
import { Block, SwitchRow, TargetChips } from './parts';

const K_MIN = 2200;
const K_MAX = 6500;
const H = 170;
export const kelvinHex = (k: number) => mirekToHex(1_000_000 / k);

/**
 * Day rhythm: the curve of white over 24 hours (cool and bright by day, warm and low at night).
 * Pick a preset or drag a point (sideways: when; up and down: how cool); the point picked shows
 * its brightness.
 */
export function RhythmSheet({
  isNew,
  initial,
  snapshot,
  onSave,
  onDelete,
  onClose,
}: {
  isNew: boolean;
  initial: RhythmRitual;
  snapshot: Snapshot | null;
  onSave: (r: RhythmRitual) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [r, setR] = useState(initial);
  const [picked, setPicked] = useState(0);
  const set = (c: Partial<RhythmRitual>) => setR((x) => ({ ...x, ...c }));
  const pts = r.points;
  const pt = pts[picked] ?? pts[0];
  const setPoint = (i: number, c: Partial<RhythmPoint>) => set({ preset: 'custom', points: pts.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const now = valueAt(pts, nowMin);
  const lightCount = new Set(
    r.targets.flatMap((t) => (snapshot?.rooms.find((x) => x.id === t) ?? snapshot?.zones?.find((x) => x.id === t))?.lightIds ?? []).filter((id) => snapshot?.lights.find((l) => l.id === id)?.kind !== 'onoff'),
  ).size;
  return (
    <ModalSheet visible title={isNew ? 'New day rhythm' : 'Day rhythm'} onClose={onClose}>
      <Txt size={13} tone="secondary">
        Cool and bright by day, warm and low at night. Drag a point to make it yours.
      </Txt>
      <Curve points={pts} picked={picked} onPick={setPicked} onMove={setPoint} nowMin={nowMin} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Label size={9}>{`Now ${fmtClock(nowMin)}`}</Label>
        <Txt size={12} tone="secondary">{`${now.kelvin} K · ${now.brightness}%`}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {RHYTHM_PRESETS.map((p) => (
          <Choice key={p.id} label={p.name} chosen={r.preset === p.id} onPress={() => set({ preset: p.id, points: p.points })} />
        ))}
        {r.preset === 'custom' && <Choice label="Yours" chosen onPress={() => null} />}
      </View>
      {pt && (
        <Block label={`Point at ${fmtClock(pt.at)} · ${pt.kelvin} K · ${pt.brightness}%`}>
          <Slider value={pt.brightness} min={5} max={100} tint={kelvinHex(pt.kelvin)} ground={color.sheet} label="Brightness at this point" onChange={(brightness) => setPoint(picked, { brightness })} onCommit={(brightness) => setPoint(picked, { brightness })} />
        </Block>
      )}
      <Block label={`Lights · ${lightCount} ${lightCount === 1 ? 'light' : 'lights'}`}>
        <TargetChips snapshot={snapshot} targets={r.targets} onChange={(targets) => set({ targets })} />
      </Block>
      <Txt size={12} tone="muted">
        Lights follow the curve while you leave them be. Changing them by hand pauses it until you turn the room on again from Glim. Runs on your bridge, even with your phone off.
      </Txt>
      <Field label="Name" value={r.name} onChange={(name) => set({ name })} />
      <SwitchRow title="On" on={r.enabled} onToggle={() => set({ enabled: !r.enabled })} />
      <PillButton title="Save" kind="primary" disabled={!r.targets.length} onPress={() => onSave({ ...r, name: r.name.trim() || 'Day rhythm', points: sortPoints(r.points) })} />
      {onDelete && <PillButton title="Delete day rhythm" kind="text" height={40} onPress={onDelete} style={{ alignSelf: 'flex-start' }} />}
    </ModalSheet>
  );
}

/** The curve: white temperature over the day, filled with its own colors, a handle per point. */
function Curve({
  points,
  picked,
  onPick,
  onMove,
  nowMin,
}: {
  points: RhythmPoint[];
  picked: number;
  onPick: (i: number) => void;
  onMove: (i: number, c: Partial<RhythmPoint>) => void;
  nowMin: number;
}) {
  const [w, setW] = useState(0);
  const x = (at: number) => (at / 1440) * w;
  const y = (k: number) => 10 + (1 - (k - K_MIN) / (K_MAX - K_MIN)) * (H - 20);
  const line = useMemo(() => {
    if (!w) return '';
    const parts: string[] = [];
    for (let m = 0; m <= 1440; m += 10) parts.push(`${m ? 'L' : 'M'}${x(m).toFixed(1)},${y(valueAt(points, m % 1440).kelvin).toFixed(1)}`);
    return parts.join('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, w]);

  // Drag: the handlers read the latest values from a ref, never during render.
  const latest = useRef({ w, points, onMove, onPick });
  useLayoutEffect(() => {
    latest.current = { w, points, onMove, onPick };
  });
  const start = useRef<{ i: number; at: number; kelvin: number } | null>(null);
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { w: ww, points: pp, onPick: pick } = latest.current;
        if (!ww) return;
        const tx = e.nativeEvent.locationX;
        const ty = e.nativeEvent.locationY;
        // The nearest handle to the finger.
        let best = 0;
        let bestD = Infinity;
        pp.forEach((p, i) => {
          const dx = (p.at / 1440) * ww - tx;
          const dy = 10 + (1 - (p.kelvin - K_MIN) / (K_MAX - K_MIN)) * (H - 20) - ty;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        start.current = { i: best, at: pp[best].at, kelvin: pp[best].kelvin };
        pick(best);
      },
      onPanResponderMove: (_, g) => {
        const s = start.current;
        const { w: ww, onMove: move } = latest.current;
        if (!s || !ww) return;
        const at = Math.round(Math.max(0, Math.min(1425, s.at + (g.dx / ww) * 1440)) / 15) * 15;
        const kelvin = Math.round(Math.max(K_MIN, Math.min(K_MAX, s.kelvin - (g.dy / (H - 20)) * (K_MAX - K_MIN))) / 100) * 100;
        move(s.i, { at, kelvin });
      },
      onPanResponderRelease: () => {
        start.current = null;
      },
    }),
  );

  return (
    <View>
      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={{ height: H, borderRadius: 14, borderWidth: 1, borderColor: hairline(0.08) }}
        accessible
        accessibilityLabel="Day rhythm curve. Drag a point to change it."
        {...responder.panHandlers}
      >
        {w > 0 && (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="rhythmFill" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={kelvinHex(K_MAX)} stopOpacity={0.28} />
                <Stop offset="0.6" stopColor={kelvinHex(3500)} stopOpacity={0.16} />
                <Stop offset="1" stopColor={kelvinHex(K_MIN)} stopOpacity={0.05} />
              </LinearGradient>
              <LinearGradient id="rhythmLine" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={kelvinHex(K_MAX)} />
                <Stop offset="1" stopColor={kelvinHex(K_MIN)} />
              </LinearGradient>
            </Defs>
            {[6, 12, 18].map((hh) => (
              <Line key={hh} x1={x(hh * 60)} x2={x(hh * 60)} y1={0} y2={H} stroke={hairline(0.06)} strokeWidth={1} />
            ))}
            <Path d={`${line}L${w},${H}L0,${H}Z`} fill="url(#rhythmFill)" />
            <Path d={line} stroke="url(#rhythmLine)" strokeWidth={1.6} fill="none" />
            <Line x1={x(nowMin)} x2={x(nowMin)} y1={0} y2={H} stroke={color.champagne} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 4" />
            {points.map((p, i) => (
              <Circle
                key={i}
                cx={x(p.at)}
                cy={y(p.kelvin)}
                r={i === picked ? 8 : 6}
                fill={kelvinHex(p.kelvin)}
                stroke={i === picked ? color.champagne : color.ground}
                strokeWidth={i === picked ? 2 : 3}
              />
            ))}
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {['0', '6', '12', '18', '24'].map((t) => (
          <Label key={t} size={9}>
            {t}
          </Label>
        ))}
      </View>
    </View>
  );
}
