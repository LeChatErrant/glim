import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { toggleLight, toggleRoom } from '../lib/actions';
import { cachedSnapshot } from '../lib/hue/client';
import { useSnapshot } from '../lib/hue/useSnapshot';
import { fitPlan, loadMap, toPlan, type HomeMap } from '../lib/map/map';
import { PLAN_COLORS } from '../lib/map/svg';
import { Body, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { refreshAllWidgets } from '../widgets/task-handler';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [map, setMap] = useState<HomeMap | null | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { snapshot, setSnapshot, refresh } = useSnapshot(2000);

  useFocusEffect(
    useCallback(() => {
      loadMap().then(setMap);
    }, []),
  );

  const plan = useMemo(() => (map ? toPlan(map) : null), [map]);

  async function run(action: () => Promise<unknown>) {
    const pending = action();
    setTimeout(() => cachedSnapshot().then((s) => s && setSnapshot(s)), 30);
    try {
      await pending;
    } finally {
      await refresh();
      refreshAllWidgets();
    }
  }

  if (map === undefined) return null;
  if (!plan) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
        <Body>Your map isn't set up yet.</Body>
        <Button title="Scan with camera" primary onPress={() => router.push('/scan')} />
        <Button title="Draw it by hand" onPress={() => router.push('/editor')} />
      </View>
    );
  }

  const f = size.w ? fitPlan(plan, size.w, size.h, 24) : null;
  const lights = snapshot?.lights ?? [];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {f && (
          <Svg width={size.w} height={size.h}>
            {plan.rooms.map((r) => {
              if (r.pts.length < 2) return null;
              const d = r.pts.map((p, i) => `${i ? 'L' : 'M'}${f.x(p.u)},${f.y(p.v)}`).join(' ') + ' Z';
              // Label at the top of the room, where it's less likely to sit under a light.
              const cx = r.pts.reduce((s, p) => s + f.x(p.u), 0) / r.pts.length;
              const cy = Math.min(...r.pts.map((p) => f.y(p.v))) + 22;
              return (
                <G key={r.id} onPress={r.hueRoomId ? () => run(() => toggleRoom(r.hueRoomId!)) : undefined}>
                  <Path
                    d={d}
                    fill={r.outdoor ? PLAN_COLORS.outdoorFill : PLAN_COLORS.roomFill}
                    stroke={PLAN_COLORS.wall}
                    strokeWidth={2}
                    strokeDasharray={r.outdoor ? '6 4' : undefined}
                  />
                  <SvgText x={cx} y={cy} fill={PLAN_COLORS.label} fontSize={13} textAnchor="middle">
                    {r.name}
                  </SvgText>
                </G>
              );
            })}
            {plan.lights.map((pl) => {
              const l = lights.find((x) => x.id === pl.lightId);
              if (!l) return null;
              const x = f.x(pl.u);
              const y = f.y(pl.v);
              return (
                <G key={pl.lightId} onPress={() => run(() => toggleLight(l.id))}>
                  {/* Invisible larger tap target. */}
                  <Circle cx={x} cy={y} r={26} fill="transparent" />
                  {l.on ? (
                    <>
                      <Circle cx={x} cy={y} r={14 + ((l.brightness ?? 100) / 100) * 14} fill={l.color} fillOpacity={0.25} />
                      <Circle cx={x} cy={y} r={11} fill={l.color} />
                    </>
                  ) : (
                    <Circle cx={x} cy={y} r={10} fill={PLAN_COLORS.off} stroke={PLAN_COLORS.offStroke} strokeWidth={2} />
                  )}
                  <SvgText x={x} y={y + 30} fill={theme.muted} fontSize={11} textAnchor="middle">
                    {l.name}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
        )}
      </View>
      <View style={{ padding: 16, paddingBottom: insets.bottom + 12, flexDirection: 'row', gap: 10 }}>
        <Button title="Edit" style={{ flex: 1 }} onPress={() => router.push('/editor')} />
        <Button title="Scan more" style={{ flex: 1 }} onPress={() => router.push('/scan')} />
      </View>
    </View>
  );
}
