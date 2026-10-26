import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { distance } from '../../lib/map/geometry';
import { fitPlan, toPlan, type FloorPoint, type HomeMap, type MapRoom } from '../../lib/map/map';
import { PillButton } from '../controls';
import { Icon } from '../icons';
import { Display, Label, Txt } from '../text';
import { color, font, hairline } from '../theme';
import { CamButton, Sheet, Shutter, SideButton } from './parts';

/** A corner of a saved room. */
export type CornerRef = { roomId: string; index: number };

/**
 * Where a scan that continues a saved map starts: two corners of the saved map, picked on the
 * plan (any two, ideally far apart). The user marks both on the floor, which lines the camera up
 * with the map.
 */
export type Anchor = { first: CornerRef; second: CornerRef | null };

const cornerOf = (map: HomeMap, c: CornerRef) => map.rooms.find((r) => r.id === c.roomId)?.points[c.index];

export function anchorCorners(map: HomeMap, a: Anchor): [FloorPoint, FloorPoint] | null {
  const p1 = cornerOf(map, a.first);
  const p2 = a.second && cornerOf(map, a.second);
  return p1 && p2 ? [p1, p2] : null;
}

/** Corners closer than this are one corner (rooms share corners). */
const SAME_CORNER_M = 0.3;

/**
 * A tap on the plan: the first corner tapped is 1, the next is 2, a later one replaces 2.
 * Tapping a chosen corner again unpicks it.
 */
function tapCorner(map: HomeMap, anchor: Anchor | null, c: CornerRef): Anchor | null {
  const p = cornerOf(map, c);
  if (!p) return anchor;
  const isTapped = (r: CornerRef | null) => {
    const q = r && cornerOf(map, r);
    return !!q && distance(p, q) < SAME_CORNER_M;
  };
  if (!anchor) return { first: c, second: null };
  if (isTapped(anchor.first)) return anchor.second ? { first: anchor.second, second: null } : null;
  if (isTapped(anchor.second)) return { first: anchor.first, second: null };
  return { first: anchor.first, second: c };
}

/** The rooms the two corners belong to, for labels and the small plan. */
const anchorRooms = (map: HomeMap, a: Anchor) => [...new Set([a.first.roomId, a.second?.roomId].filter((id): id is string => !!id))].map((id) => map.rooms.find((r) => r.id === id)).filter((r): r is MapRoom => !!r);

/** Two marked corners this far from their distance on the map (or closer) are accepted. */
export const alignTolerance = (wall: number) => Math.max(0.4, wall * 0.25);

const fmt = (m: number) => `${m.toFixed(1)} m`;

/**
 * Step 1 of lining up: a full-screen plan of the saved map. Tap a corner of the room you're in;
 * the wall to the next corner is highlighted, with its length. The camera keeps finding the floor
 * behind this screen meanwhile.
 */
export function PickStart({
  map,
  anchor,
  onAnchor,
  onGo,
  onExit,
  onEditor,
}: {
  map: HomeMap;
  anchor: Anchor | null;
  onAnchor: (a: Anchor | null) => void;
  onGo: () => void;
  onExit: () => void;
  onEditor: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const ends = anchor ? anchorCorners(map, anchor) : null;
  const apart = ends ? distance(ends[0], ends[1]) : 0;
  const names = anchor ? anchorRooms(map, anchor).map((r) => r.name || 'Room').join(' · ') : '';

  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(5,5,6,0.96)', paddingTop: insets.top + 14, paddingBottom: insets.bottom + 22, paddingHorizontal: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <CamButton icon="close" label="Leave the scan" onPress={onExit} />
        <Label tone="label">Line up · step 1 of 3</Label>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ marginTop: 26, gap: 10 }}>
        <Display size={32} style={{ lineHeight: 35 }}>
          {'Where do you\n'}
          <Display size={32} style={{ color: color.champagne, lineHeight: 35 }}>
            start from?
          </Display>
        </Display>
        <Txt size={14} tone="secondary">
          Your phone doesn&apos;t know where it is on your map yet. Tap two corners you can see from here: you&apos;ll mark them on the floor.
        </Txt>
      </View>

      <View style={{ flex: 1, marginTop: 18, marginBottom: 14 }} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {box && <CornerPlan map={map} anchor={anchor} width={box.w} height={box.h} onPick={(r, i) => onAnchor(tapCorner(map, anchor, { roomId: r.id, index: i }))} />}
      </View>

      {ends && anchor?.second ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={15}>{`Corners 1 and 2 · ${fmt(apart)} apart`}</Txt>
            <Txt size={12} tone="muted">
              {names}
            </Txt>
          </View>
          <PillButton title="Swap" icon="rotate" height={40} onPress={() => onAnchor({ first: anchor.second!, second: anchor.first })} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.champagne, boxShadow: `0 0 8px 2px ${color.champagne}88` }} />
          <Txt size={15} tone="champagne">
            {anchor ? 'Now tap a second corner' : 'Tap a corner you can see'}
          </Txt>
        </View>
      )}
      <Txt size={12} tone="muted" style={{ marginTop: 6, marginBottom: 14 }}>
        Best: two corners far apart, both on the floor in sight (not behind a sofa). Tap a corner again to unpick it.
      </Txt>
      <PillButton title={ends ? "I'm there · mark corner 1" : 'Pick two corners first'} kind="primary" icon="target" disabled={!ends} onPress={onGo} />
      <PillButton title="Edit on screen instead" kind="text" onPress={onEditor} style={{ marginTop: 4 }} />
    </View>
  );
}

/**
 * The saved map with every corner tappable. The chosen corners are numbered 1 and 2, linked by
 * a champagne line (solid along a wall, dashed across a room). `marked`: corner 1 is already
 * marked on the floor (drawn filled).
 */
export function CornerPlan({
  map,
  anchor,
  width,
  height,
  onPick,
  marked,
  only,
}: {
  map: HomeMap;
  anchor: Anchor | null;
  width: number;
  height: number;
  onPick?: (room: MapRoom, index: number) => void;
  marked?: boolean;
  /** Draw only these rooms (the small plan in the aim sheet). */
  only?: string[];
}) {
  const shown: HomeMap = only ? { ...map, rooms: map.rooms.filter((r) => only.includes(r.id)), lights: [] } : { ...map, lights: [] };
  const plan = toPlan(shown);
  const small = width < 160;
  const f = fitPlan(plan, width, height, small ? 16 : 30);
  const at = (c: CornerRef | null | undefined) => (c ? plan.rooms.find((r) => r.id === c.roomId)?.pts[c.index] : undefined);
  const p1 = at(anchor?.first);
  const p2 = at(anchor?.second);
  const chosenRooms = [anchor?.first.roomId, anchor?.second?.roomId];
  // Two neighbours in one room: that's a wall, drawn solid.
  const alongWall = (() => {
    const a = anchor?.first;
    const b = anchor?.second;
    const room = a && plan.rooms.find((r) => r.id === a.roomId);
    if (!a || !b || !room || a.roomId !== b.roomId) return false;
    const n = room.pts.length;
    return (a.index + 1) % n === b.index || (b.index + 1) % n === a.index;
  })();

  function tap(x: number, y: number) {
    if (!onPick) return;
    let best: { room: MapRoom; i: number; d: number } | null = null;
    for (const r of plan.rooms) {
      r.pts.forEach((p, i) => {
        const d = Math.hypot(f.x(p.u) - x, f.y(p.v) - y);
        // On shared corners, a room already chosen wins.
        const bias = chosenRooms.includes(r.id) ? -4 : 0;
        if (d < 40 && (!best || d + bias < best.d)) best = { room: map.rooms.find((m) => m.id === r.id)!, i, d: d + bias };
      });
    }
    const hit = best as { room: MapRoom; i: number } | null;
    if (hit) onPick(hit.room, hit.i);
  }

  const center = (pts: { u: number; v: number }[]) => ({ u: pts.reduce((s, p) => s + p.u, 0) / pts.length, v: pts.reduce((s, p) => s + p.v, 0) / pts.length });
  const ring = small ? 7 : 11;

  return (
    <Pressable
      disabled={!onPick}
      onPress={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      accessibilityLabel="Your map. Tap a corner to start from it"
      style={{ width, height }}
    >
      <Svg width={width} height={height}>
        {plan.rooms.map((r) => {
          const chosen = chosenRooms.includes(r.id);
          return (
            <Polygon
              key={r.id}
              points={r.pts.map((p) => `${f.x(p.u)},${f.y(p.v)}`).join(' ')}
              fill={chosen ? 'rgba(233,207,159,0.07)' : r.outdoor ? color.floorOutdoor : color.floor}
              stroke={chosen ? 'rgba(233,207,159,0.55)' : hairline(0.3)}
              strokeWidth={1}
              strokeDasharray={r.outdoor ? '3 4' : undefined}
              strokeLinejoin="round"
            />
          );
        })}
        {!small &&
          plan.rooms.map((r) => {
            const c = center(r.pts);
            return (
              <SvgText
                key={`n-${r.id}`}
                x={f.x(c.u)}
                y={f.y(c.v) + 4}
                fill={chosenRooms.includes(r.id) ? color.champagne : color.muted}
                fontFamily={font.ui}
                fontSize={11}
                textAnchor="middle"
              >
                {r.name || 'Room'}
              </SvgText>
            );
          })}
        {p1 && p2 && (
          <Line
            x1={f.x(p1.u)}
            y1={f.y(p1.v)}
            x2={f.x(p2.u)}
            y2={f.y(p2.v)}
            stroke={color.champagne}
            strokeWidth={alongWall ? (small ? 2.5 : 3.5) : 1.5}
            strokeDasharray={alongWall ? undefined : '4 5'}
            strokeLinecap="round"
          />
        )}
        {/* Every corner is a target: small diamonds, so it reads as "tap one of these". */}
        {onPick &&
          plan.rooms.flatMap((r) =>
            r.pts.map((p, i) => {
              const x = f.x(p.u);
              const y = f.y(p.v);
              // Chosen corners (and corners of other rooms on the same spot) get a numbered ring instead.
              if ([p1, p2].some((q) => q && Math.hypot(f.x(q.u) - x, f.y(q.v) - y) < 3)) return null;
              return <Rect key={`${r.id}-${i}`} x={x - 4} y={y - 4} width={8} height={8} fill={color.ground} stroke={hairline(0.7)} strokeWidth={1.2} transform={`rotate(45 ${x} ${y})`} />;
            }),
          )}
        {[p1, p2].map((p, k) =>
          p ? (
            <G key={`end-${k}`}>
              <Circle cx={f.x(p.u)} cy={f.y(p.v)} r={ring} fill={k === 0 && marked ? color.champagne : color.ground} stroke={color.champagne} strokeWidth={1.5} />
              <SvgText x={f.x(p.u)} y={f.y(p.v) + (small ? 3.5 : 4.5)} fill={k === 0 && marked ? color.onChampagne : color.champagne} fontFamily={font.uiMedium} fontSize={small ? 9 : 12} textAnchor="middle">
                {k === 0 && marked ? '✓' : String(k + 1)}
              </SvgText>
            </G>
          ) : null,
        )}
      </Svg>
    </Pressable>
  );
}

/**
 * Steps 2 and 3 of lining up, over the camera: aim at corner 1, then corner 2. For corner 2,
 * the live distance from corner 1 says when the reticle is about the right wall length away.
 */
export function AimSheet({
  map,
  anchor,
  first,
  reticle,
  canMark,
  onMark,
  onBack,
}: {
  map: HomeMap;
  anchor: Anchor;
  /** Where corner 1 was marked (AR coordinates), once it is. */
  first: FloorPoint | null;
  reticle?: FloorPoint;
  canMark: boolean;
  onMark: () => void;
  onBack: () => void;
}) {
  const target = first ? anchor.second : anchor.first;
  const room = target ? map.rooms.find((r) => r.id === target.roomId) : undefined;
  const ends = anchorCorners(map, anchor);
  const wall = ends ? distance(ends[0], ends[1]) : 0;
  const now = first && reticle ? distance(first, reticle) : null;
  const ok = now !== null && Math.abs(now - wall) <= alignTolerance(wall);

  return (
    <Sheet>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 6, alignItems: 'center' }}>
        <View style={{ width: 96, height: 96, borderRadius: 18, borderWidth: 1, borderColor: hairline(0.12), overflow: 'hidden' }}>
          <CornerPlan map={map} anchor={anchor} width={96} height={96} only={anchorRooms(map, anchor).map((r) => r.id)} marked={!!first} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Label tone="label">{`${room?.name || 'Room'} · corner ${first ? 2 : 1} of 2`}</Label>
          {!first ? (
            <Txt size={13} tone="secondary">
              Stand back a little. Put the visor on corner 1, right where the walls meet the floor.
            </Txt>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Display size={30} weight={300} style={{ color: ok ? color.champagne : color.ivory, lineHeight: 34, fontVariant: ['tabular-nums'] }}>
                  {now === null ? '—' : fmt(now)}
                </Display>
                <Txt size={13} tone="muted">{`of ${fmt(wall)}`}</Txt>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {ok && <Icon name="check" size={12} tint={color.champagne} stroke={2} />}
                <Txt size={12} tone={ok ? 'champagne' : 'muted'}>
                  {now === null ? 'Aim at the floor' : ok ? 'About right. Aim at corner 2 and mark it' : now < wall ? 'Corner 2 is further' : 'Past it? Corner 2 is closer'}
                </Txt>
              </View>
            </>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
        <SideButton title={first ? 'Redo 1' : 'Back'} icon={first ? 'undo' : 'back'} onPress={onBack} />
        <Shutter icon="target" label={first ? 'Mark corner 2' : 'Mark corner 1'} disabled={!canMark} onPress={onMark} />
        <View style={{ width: 104 }} />
      </View>
    </Sheet>
  );
}
