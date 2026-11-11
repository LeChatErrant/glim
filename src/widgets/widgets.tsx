import { FlexWidget, OverlapWidget, SvgWidget, TextWidget, type TextWidgetStyle } from 'react-native-android-widget';

import type { Room, Snapshot } from '../lib/hue/client';
import { averageBrightness, isLit, lightsOf } from '../lib/lights';
import { walledRooms } from '../lib/map/glow';
import { capsWidth, labelSpot } from '../lib/map/labels';
import { fitPlan, type Plan } from '../lib/map/map';
import { iconSvg, jewelSvg, planToSvg } from '../lib/map/svg';
import { color, font } from '../ui/theme';

// Nocturne on the home screen: near-black ground, ivory text, hairlines, one champagne accent.
// The only saturated colors are the lights. Canvas: "Widgets & tiles" page, WidgetCatalog board.
type Hex = `#${string}`;
type Rgba = `rgba(${number}, ${number}, ${number}, ${number})`;
export const GROUND: Hex = '#070708';
const IVORY = color.ivory as Hex;
const SECONDARY = color.secondary as Hex;
const MUTED = color.muted as Hex;
const LEVEL: Hex = '#C7BCAB';
const line = (a: number): Rgba => `rgba(242, 232, 216, ${a})`;

function tint(hex: string, a: number): Rgba {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** How fresh the state on a widget is. */
export type Freshness = { stale: boolean };

const caps = (size = 9, c: Hex | Rgba = SECONDARY): TextWidgetStyle => ({
  fontFamily: font.uiMedium,
  fontSize: size,
  letterSpacing: size * 0.16,
  color: c,
});

/** "21:42", in the phone's format. */
function clock(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Tap data for "fast" actions: the native widget provider sends `fastBody` to
 * `fastPath` on the bridge right away, then JS redraws. The target state is decided
 * here, from what the widget currently shows.
 */
function fastToggle(path: string, on: boolean, extra: Record<string, string>) {
  return { ...extra, fastPath: path, fastBody: JSON.stringify({ on: { on } }), target: on ? 'on' : 'off' };
}

const shell = {
  height: 'match_parent',
  width: 'match_parent',
  backgroundColor: GROUND,
  borderRadius: 24,
  borderWidth: 1,
  borderColor: line(0.09),
} as const;

/** Not paired, no map, no rooms: a dashed card that opens the app. */
export function SetupCard({ title, hint }: { title: string; hint: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        ...shell,
        backgroundColor: 'rgba(7, 7, 8, 0.6)',
        borderColor: line(0.3),
        borderStyle: 'dashed',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 12,
      }}
    >
      <SvgWidget svg={iconSvg('plan', color.champagne, 28)} style={{ width: 28, height: 28 }} />
      <TextWidget text={title} style={{ fontFamily: font.display, fontSize: 18, color: IVORY, marginTop: 10 }} />
      <TextWidget text={hint.toUpperCase()} maxLines={2} style={{ ...caps(9, MUTED), marginTop: 8, textAlign: 'center' }} />
    </FlexWidget>
  );
}

export const NotPaired = () => <SetupCard title="Tap to set up" hint="Pair your bridge in Glim" />;

/** "LAST KNOWN · 21:42" with the cloud-off icon, when the bridge can't be reached. */
function StaleBadge({ snapshot }: { snapshot: Snapshot }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', height: 18 }}>
      <SvgWidget svg={iconSvg('cloudOff', color.secondary, 12)} style={{ width: 12, height: 12 }} />
      <TextWidget text={`LAST KNOWN · ${clock(snapshot.fetchedAt)}`} style={{ ...caps(9, MUTED), marginLeft: 6 }} />
    </FlexWidget>
  );
}

/** One room tile: jewel and level on top, name below. Tap toggles the room. */
function RoomTile({ room, snapshot, stale, width }: { room: Room; snapshot: Snapshot; stale: boolean; width: number }) {
  const lights = lightsOf(room, snapshot);
  const lit = lights.filter(isLit);
  const on = lit.length > 0;
  const unreachable = lights.length > 0 && lights.every((l) => !l.reachable);
  const c = lit[0]?.color ?? color.champagne;
  const avg = averageBrightness(lit);
  const level = unreachable ? '' : !on ? 'OFF' : avg === null ? 'ON' : `${avg}%`;
  const plug = lights.length > 0 && lights.every((l) => l.kind === 'onoff');
  const live = on && !stale;
  return (
    <FlexWidget
      clickAction={room.groupedLightId ? 'FAST_TOGGLE_ROOM' : 'OPEN_APP'}
      clickActionData={room.groupedLightId ? fastToggle(`grouped_light/${room.groupedLightId}`, !on, { roomId: room.id }) : undefined}
      accessibilityLabel={`${room.name}, ${unreachable ? 'unreachable' : on ? `on${avg === null ? '' : `, ${avg}%`}` : 'off'}`}
      style={{
        width,
        height: 'match_parent',
        marginHorizontal: 3,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: live ? tint(c, 0.24) : line(stale ? 0.07 : 0.1),
        backgroundColor: live ? tint(c, 0.08) : 'rgba(0, 0, 0, 0)',
        paddingLeft: 7,
        paddingRight: 10,
        paddingTop: 6,
        paddingBottom: 10,
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 'match_parent' }}>
        <SvgWidget svg={jewelSvg({ color: c, on, plug, unreachable, stale, ground: GROUND })} style={{ width: 24, height: 24 }} />
        <TextWidget text={level} style={caps(9, live ? LEVEL : MUTED)} />
      </FlexWidget>
      <TextWidget
        text={room.name}
        maxLines={1}
        truncate="END"
        style={{ fontFamily: font.displayRegular, fontSize: 14, color: live ? IVORY : SECONDARY, marginLeft: 5 }}
      />
    </FlexWidget>
  );
}

/** Grid of room tiles. Tap a tile to toggle the room. */
export function RoomsWidget({ snapshot, width, height, stale }: { snapshot: Snapshot | null; width: number; height: number } & Freshness) {
  if (!snapshot) return <NotPaired />;
  if (!snapshot.rooms.length) return <SetupCard title="No rooms yet" hint="Create rooms in Glim" />;
  const top = stale ? 22 : 0;
  // Balanced rows, about 80 dp per tile, at least 44 dp tall; extra rooms don't fit and are left out.
  const maxCols = Math.max(2, Math.floor((width - 8) / 80));
  const maxRows = Math.max(1, Math.floor((height - 8 - top) / 50));
  const rooms = snapshot.rooms.slice(0, maxCols * maxRows);
  const rowCount = Math.ceil(rooms.length / maxCols);
  const cols = Math.ceil(rooms.length / rowCount);
  const rows = Array.from({ length: rowCount }, (_, i) => rooms.slice(i * cols, i * cols + cols));
  // Explicit widths: flex weights only share the space left after each tile's content.
  const tileWidth = Math.floor((width - 10) / cols) - 6;

  return (
    <FlexWidget style={{ ...shell, borderColor: line(stale ? 0.07 : 0.09), padding: 4 }}>
      {stale && (
        <FlexWidget style={{ paddingLeft: 10, paddingTop: 4, height: top }}>
          <StaleBadge snapshot={snapshot} />
        </FlexWidget>
      )}
      {rows.map((row, i) => (
        <FlexWidget key={i} style={{ flexDirection: 'row', width: 'match_parent', flex: 1, marginVertical: 3 }}>
          {row.map((room) => (
            <RoomTile key={room.id} room={room} snapshot={snapshot} stale={stale} width={tileWidth} />
          ))}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

/** "Home" (or the room zoomed into) and "8 OF 9 ON" / "ALL OFF" / "LAST KNOWN · 21:42". */
function HomeTitle({ snapshot, stale, size, title = 'Home', lightIds }: { snapshot: Snapshot; stale: boolean; size: number; title?: string; lightIds?: string[] }) {
  const reachable = snapshot.lights.filter((l) => l.reachable && (!lightIds || lightIds.includes(l.id)));
  const lit = reachable.filter((l) => l.on).length;
  const sub = stale ? `LAST KNOWN · ${clock(snapshot.fetchedAt)}` : lit ? `${lit} OF ${reachable.length} ON` : 'ALL OFF';
  return (
    <FlexWidget style={{ flexDirection: 'column' }}>
      <TextWidget text={title} maxLines={1} truncate="END" style={{ fontFamily: font.display, fontSize: size, color: stale ? SECONDARY : IVORY }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        {stale && <SvgWidget svg={iconSvg('cloudOff', color.secondary, 11)} style={{ width: 11, height: 11, marginRight: 5 }} />}
        <TextWidget text={sub} style={caps(9, stale ? MUTED : SECONDARY)} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** "All off" when something is lit, "All on" otherwise. Sent natively when the home group is known. */
function AllButton({ snapshot, pill }: { snapshot: Snapshot; pill: boolean }) {
  const anyOn = snapshot.lights.some(isLit);
  const target = !anyOn;
  const fast = !!snapshot.homeGroupId;
  return (
    <FlexWidget
      clickAction={fast ? 'FAST_TOGGLE_ALL' : 'TOGGLE_ALL'}
      clickActionData={fast ? fastToggle(`grouped_light/${snapshot.homeGroupId}`, target, { all: 'home' }) : { target: target ? 'on' : 'off' }}
      accessibilityLabel={anyOn ? 'Turn all lights off' : 'Turn all lights on'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: pill ? 38 : 36,
        paddingHorizontal: pill ? 14 : 0,
        ...(pill ? { borderRadius: 19, borderWidth: 1, borderColor: line(0.14) } : {}),
      }}
    >
      <FlexWidget
        style={{
          width: 9,
          height: 9,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: anyOn ? (color.muted as Hex) : (color.champagne as Hex),
          ...(anyOn ? {} : { backgroundColor: color.champagne as Hex }),
        }}
      />
      <TextWidget text={anyOn ? 'ALL OFF' : 'ALL ON'} style={{ ...caps(9, SECONDARY), marginLeft: 9 }} />
    </FlexWidget>
  );
}

/**
 * The floor plan with live light pools. Tap a light to toggle it, tap elsewhere in a room to
 * toggle the room. Wide sizes (4×2) get a side panel, taller ones a bar below the plan.
 */
/**
 * Where the plan sits in a map widget: left half when wide (4×2), above a bar otherwise. With
 * the outside drawn (`outside`), the plan sits further in, so the clear zone around the house
 * and its fade have room.
 */
export function mapWidgetBox(width: number, height: number, outside = false) {
  const wide = width / height >= 1.6;
  const box = wide
    ? { left: 9, top: 8, width: Math.round(width * 0.52), height: height - 16 }
    : { left: 12, top: 10, width: width - 24, height: height - 10 - 58 };
  return { wide, box, pad: outside ? (wide ? 22 : 30) : 6, radius: 24 };
}

export function MapWidget({
  snapshot,
  plan,
  width,
  height,
  stale,
  outside = false,
}: {
  snapshot: Snapshot | null;
  plan: Plan | null;
  width: number;
  height: number;
  /** The weather is drawn underneath (native frames): leave the ground see-through. */
  outside?: boolean;
} & Freshness) {
  if (!snapshot) return <NotPaired />;
  if (!plan) return <SetupCard title="Tap to set up" hint="Map · scan or draw your home" />;
  const lights = snapshot.lights;
  const { wide, box, pad } = mapWidgetBox(width, height, outside);
  const f = fitPlan(plan, box.width, box.height, pad);
  const X = (u: number) => box.left + f.x(u);
  const Y = (v: number) => box.top + f.y(v);
  const target = 40;
  const walled = walledRooms(plan);
  const outlines = plan.rooms.filter((r) => r.pts.length > 2);
  const showLabels = box.height >= 200;
  const markers = plan.lights.map((l) => ({ x: X(l.u), y: Y(l.v) }));

  return (
    <OverlapWidget style={{ ...shell, borderColor: line(stale ? 0.07 : 0.09), ...(outside ? { backgroundColor: '#00000000' as Hex } : {}) }}>
      <SvgWidget
        svg={planToSvg(plan, lights, box.width, box.height, { padding: pad, ground: GROUND, stale, outdoorOpen: outside })}
        style={{ width: box.width, height: box.height, marginLeft: box.left, marginTop: box.top }}
      />
      {showLabels &&
        outlines.map((r) => {
          const xs = r.pts.map((p) => X(p.u));
          const w = Math.max(...xs) - Math.min(...xs);
          if (w < 56) return null;
          const zone = !walled.includes(r);
          const name = (snapshot.rooms.find((x) => x.id === r.hueRoomId)?.name ?? r.name).toUpperCase();
          const size = zone || !r.hueRoomId ? 8 : 9;
          const spot = labelSpot(
            r.pts.map((p) => ({ x: X(p.u), y: Y(p.v) })),
            markers,
            Math.min(capsWidth(name, size), w - 14),
            size + 4,
            zone ? 5 : 8,
            13,
          );
          return (
            <FlexWidget key={`l${r.id}`} style={{ marginLeft: Math.round(spot.x), marginTop: Math.round(spot.y), width: Math.round(w - 14) }}>
              <TextWidget text={name} maxLines={1} truncate="END" style={caps(size, line(r.hueRoomId && !zone ? 0.82 : 0.6))} />
            </FlexWidget>
          );
        })}
      {outlines
        .filter((r) => r.hueRoomId)
        .map((r) => {
          const room = snapshot.rooms.find((x) => x.id === r.hueRoomId);
          if (!room?.groupedLightId) return null;
          const xs = r.pts.map((p) => X(p.u));
          const ys = r.pts.map((p) => Y(p.v));
          const left = Math.min(...xs);
          const top = Math.min(...ys);
          const on = lightsOf(room, snapshot).some(isLit);
          return (
            <FlexWidget
              key={r.id}
              clickAction="FAST_TOGGLE_ROOM"
              clickActionData={fastToggle(`grouped_light/${room.groupedLightId}`, !on, { roomId: room.id })}
              accessibilityLabel={`${room.name}, ${on ? 'on' : 'off'}`}
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
            clickAction="FAST_TOGGLE_LIGHT"
            clickActionData={fastToggle(`light/${l.id}`, !l.on, { lightId: l.id })}
            accessibilityLabel={`${l.name}, ${!l.reachable ? 'unreachable' : l.on ? 'on' : 'off'}`}
            style={{
              marginLeft: Math.round(Math.max(0, X(pl.u) - target / 2)),
              marginTop: Math.round(Math.max(0, Y(pl.v) - target / 2)),
              width: target,
              height: target,
            }}
          />
        );
      })}
      {wide ? (
        <FlexWidget
          style={{
            marginLeft: box.left + box.width + 14,
            marginTop: 12,
            width: width - (box.left + box.width + 14) - 12,
            height: height - 20,
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <HomeTitle snapshot={snapshot} stale={stale} size={22} />
          <AllButton snapshot={snapshot} pill={false} />
        </FlexWidget>
      ) : (
        <FlexWidget
          style={{
            marginLeft: 16,
            marginTop: height - 52,
            width: width - 30,
            height: 42,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <HomeTitle snapshot={snapshot} stale={stale} size={18} />
          <AllButton snapshot={snapshot} pill />
        </FlexWidget>
      )}
    </OverlapWidget>
  );
}
