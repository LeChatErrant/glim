import { FlexWidget, OverlapWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import type { Light, Snapshot } from '../lib/hue/client';
import { roomIsOn } from '../lib/hue/client';
import { fitPlan, type Plan } from '../lib/map/map';
import { planToSvg } from '../lib/map/svg';

type Hex = `#${string}`;
const BG: Hex = '#141418';
const TILE_OFF: Hex = '#26262c';
const TEXT: Hex = '#f2f2f5';
const MUTED: Hex = '#9a9aa3';

export function Message({ text }: { text: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: 24, justifyContent: 'center', alignItems: 'center', padding: 12 }}
    >
      <TextWidget text={text} style={{ color: MUTED, fontSize: 13, textAlign: 'center' }} />
    </FlexWidget>
  );
}

/** Grid of room tiles. Tap a tile to toggle the room. */
export function RoomsWidget({ snapshot, pendingRoomId }: { snapshot: Snapshot | null; pendingRoomId?: string }) {
  if (!snapshot) return <Message text="Open hue-lab to pair your bridge" />;
  const rooms = snapshot.rooms;
  const perRow = 3;
  const rows: (typeof rooms)[] = [];
  for (let i = 0; i < rooms.length; i += perRow) rows.push(rooms.slice(i, i + perRow));

  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: 24, padding: 8 }}>
      {rows.map((row, i) => (
        <FlexWidget key={i} style={{ flexDirection: 'row', width: 'match_parent', flex: 1 }}>
          {row.map((room) => {
            const lights = snapshot.lights.filter((l) => room.lightIds.includes(l.id));
            const on = roomIsOn(room, snapshot.lights);
            const color = (lights.find((l) => l.on && l.reachable)?.color ?? TILE_OFF) as Hex;
            return (
              <FlexWidget
                key={room.id}
                clickAction="TOGGLE_ROOM"
                clickActionData={{ roomId: room.id }}
                accessibilityLabel={`${room.name}, ${on ? 'on' : 'off'}`}
                style={{
                  flex: 1,
                  height: 'match_parent',
                  margin: 4,
                  borderRadius: 16,
                  backgroundColor: on ? color : TILE_OFF,
                  padding: 10,
                  justifyContent: 'space-between',
                  borderWidth: pendingRoomId === room.id ? 2 : 0,
                  borderColor: TEXT,
                }}
              >
                <TextWidget text={room.name} maxLines={2} style={{ color: on ? '#141418' : TEXT, fontSize: 13, fontWeight: '500' }} />
                <TextWidget
                  text={on ? `${lights.filter((l) => l.on && l.reachable).length}/${lights.length} on` : 'Off'}
                  style={{ color: on ? '#3a3a42' : MUTED, fontSize: 11 }}
                />
              </FlexWidget>
            );
          })}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

/** The floor plan. Tap a light to toggle it, tap elsewhere in a room to toggle the room. */
export function MapWidget({ snapshot, plan, width, height }: { snapshot: Snapshot | null; plan: Plan | null; width: number; height: number }) {
  if (!snapshot) return <Message text="Open hue-lab to pair your bridge" />;
  if (!plan) return <Message text="Scan your home in hue-lab to see the map here" />;
  const lights: Light[] = snapshot.lights;
  const f = fitPlan(plan, width, height, 14);
  const target = 44;

  return (
    <OverlapWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: 24 }}>
      <SvgWidget svg={planToSvg(plan, lights, width, height)} style={{ width, height }} />
      {plan.rooms
        .filter((r) => r.hueRoomId && r.pts.length > 2)
        .map((r) => {
          const xs = r.pts.map((p) => f.x(p.u));
          const ys = r.pts.map((p) => f.y(p.v));
          const left = Math.min(...xs);
          const top = Math.min(...ys);
          return (
            <FlexWidget
              key={r.id}
              clickAction="TOGGLE_ROOM"
              clickActionData={{ roomId: r.hueRoomId }}
              accessibilityLabel={`Toggle ${r.name}`}
              style={{ marginLeft: Math.round(left), marginTop: Math.round(top), width: Math.round(Math.max(...xs) - left), height: Math.round(Math.max(...ys) - top) }}
            />
          );
        })}
      {plan.lights.map((pl) => {
        const l = lights.find((x) => x.id === pl.lightId);
        if (!l) return null;
        return (
          <FlexWidget
            key={pl.lightId}
            clickAction="TOGGLE_LIGHT"
            clickActionData={{ lightId: pl.lightId }}
            accessibilityLabel={`${l.name}, ${l.on ? 'on' : 'off'}`}
            style={{
              marginLeft: Math.round(Math.max(0, f.x(pl.u) - target / 2)),
              marginTop: Math.round(Math.max(0, f.y(pl.v) - target / 2)),
              width: target,
              height: target,
            }}
          />
        );
      })}
    </OverlapWidget>
  );
}
