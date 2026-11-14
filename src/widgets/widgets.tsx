import { FlexWidget, OverlapWidget, SvgWidget, TextWidget, type TextWidgetStyle } from 'react-native-android-widget';

import type { Snapshot } from '../lib/hue/client';
import { averageBrightness, isLit, lightsOf } from '../lib/lights';
import { walledRooms } from '../lib/map/glow';
import { hitAreas } from '../lib/map/hitAreas';
import { capsWidth, labelSpot } from '../lib/map/labels';
import { fitPlan, type Plan } from '../lib/map/map';
import { iconSvg, jewelSvg, lightJewelSvg, planToSvg } from '../lib/map/svg';
import { moodMarkSvg } from '../lib/moodMarks';
import { moodRequests } from '../lib/moods';
import { GLASS, type WidgetBackground } from '../lib/weather/scene';
import { iconPath, type IconName } from '../ui/icons';
import { color, font } from '../ui/theme';
import type { MoodButton } from './moodButtons';
import type { Tile } from './tiles';

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
  // Turning on: no fade (Hue's default is 0.4 s), the light answers at once like a switch.
  // Turning off: Hue's own fade. An "off" with a set duration dims the light to its minimum on
  // the way out, and it then came back on at ~0% brightness.
  const body = on ? { on: { on }, dynamics: { duration: 0 } } : { on: { on } };
  return { ...extra, fastPath: path, fastBody: JSON.stringify(body), target: on ? 'on' : 'off' };
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

/** How a tile shows a room or a light, and what a tap on it does. */
type TileLook = {
  name: string;
  on: boolean;
  unreachable: boolean;
  /** Color of the jewel and the tint of the tile. */
  c: string;
  /** "62%", "ON", "OFF", or empty when unreachable (the jewel says it). */
  level: string;
  /** The jewel, drawn at `px`: a room's plain jewel, or a light's holding its type icon. */
  jewel: (px: number, stale: boolean) => string;
  /** The jewel holds an icon (a light): drawn a little bigger so it reads. */
  icon: boolean;
  click: { clickAction: string; clickActionData?: Record<string, string> };
  label: string;
};

function tileLook(tile: Tile, snapshot: Snapshot): TileLook {
  if (tile.light) {
    const l = tile.light;
    const on = isLit(l);
    const level = !l.reachable ? '' : !l.on ? 'OFF' : l.brightness === null ? 'ON' : `${l.brightness}%`;
    return {
      name: l.name,
      on,
      unreachable: !l.reachable,
      c: l.color,
      level,
      // The jewel takes about half the square, its glow the rest.
      jewel: (px, stale) => lightJewelSvg(l, { size: Math.round(px * 0.5), px, ground: GROUND, stale }),
      icon: true,
      click: { clickAction: 'FAST_TOGGLE_LIGHT', clickActionData: fastToggle(`light/${l.id}`, !l.on, { lightId: l.id }) },
      label: `${l.name}, ${!l.reachable ? 'unreachable' : on ? `on${l.brightness === null ? '' : `, ${l.brightness}%`}` : 'off'}`,
    };
  }
  const room = tile.room;
  const lights = lightsOf(room, snapshot);
  const lit = lights.filter(isLit);
  const on = lit.length > 0;
  const unreachable = lights.length > 0 && lights.every((l) => !l.reachable);
  const c = lit[0]?.color ?? color.champagne;
  const avg = averageBrightness(lit);
  const plug = lights.length > 0 && lights.every((l) => l.kind === 'onoff');
  return {
    name: room.name,
    on,
    unreachable,
    c,
    level: unreachable ? '' : !on ? 'OFF' : avg === null ? 'ON' : `${avg}%`,
    jewel: (px, stale) => jewelSvg({ color: c, on, plug, unreachable, stale, ground: GROUND, px }),
    icon: false,
    click: room.groupedLightId
      ? { clickAction: 'FAST_TOGGLE_ROOM', clickActionData: fastToggle(`grouped_light/${room.groupedLightId}`, !on, { roomId: room.id }) }
      : { clickAction: 'OPEN_APP' },
    label: `${room.name}, ${unreachable ? 'unreachable' : on ? `on${avg === null ? '' : `, ${avg}%`}` : 'off'}`,
  };
}

/** One tile: jewel and level on top, name below. Tap toggles the room or light. */
function GridTile({ look, stale, width }: { look: TileLook; stale: boolean; width: number }) {
  const live = look.on && !stale;
  return (
    <FlexWidget
      {...look.click}
      accessibilityLabel={look.label}
      style={{
        width,
        height: 'match_parent',
        marginHorizontal: 3,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: live ? tint(look.c, 0.24) : line(stale ? 0.07 : 0.1),
        backgroundColor: live ? tint(look.c, 0.08) : 'rgba(0, 0, 0, 0)',
        paddingLeft: 7,
        paddingRight: 10,
        paddingTop: 6,
        paddingBottom: 10,
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 'match_parent' }}>
        <SvgWidget svg={look.jewel(look.icon ? 28 : 24, stale)} style={look.icon ? { width: 28, height: 28, marginLeft: -2, marginVertical: -2 } : { width: 24, height: 24 }} />
        <TextWidget text={look.level} style={caps(9, live ? LEVEL : MUTED)} />
      </FlexWidget>
      <TextWidget
        text={look.name}
        maxLines={1}
        truncate="END"
        style={{ fontFamily: font.displayRegular, fontSize: 14, color: live ? IVORY : SECONDARY, marginLeft: 5 }}
      />
    </FlexWidget>
  );
}

/**
 * Tiles in balanced rows, about 80 dp wide and at least 44 dp tall; extra tiles don't fit and are
 * left out. A plain function returning the rows: the widget library can't render a fragment.
 */
function tileRows({ tiles, snapshot, width, height, stale, top = 0 }: { tiles: Tile[]; snapshot: Snapshot; width: number; height: number; stale: boolean; top?: number }) {
  const maxCols = Math.max(2, Math.floor((width - 8) / 80));
  const maxRows = Math.max(1, Math.floor((height - 8 - top) / 50));
  const shown = tiles.slice(0, maxCols * maxRows);
  const rowCount = Math.ceil(shown.length / maxCols);
  const cols = Math.ceil(shown.length / rowCount);
  const rows = Array.from({ length: rowCount }, (_, i) => shown.slice(i * cols, i * cols + cols));
  // Explicit widths: flex weights only share the space left after each tile's content.
  const tileWidth = Math.floor((width - 10) / cols) - 6;
  return rows.map((row, i) => (
    <FlexWidget key={i} style={{ flexDirection: 'row', width: 'match_parent', flex: 1, marginVertical: 3 }}>
      {row.map((t) => (
        <GridTile key={t.key} look={tileLook(t, snapshot)} stale={stale} width={tileWidth} />
      ))}
    </FlexWidget>
  ));
}

/** Grid of room tiles. Tap a tile to toggle the room. */
export function RoomsWidget({ snapshot, width, height, stale }: { snapshot: Snapshot | null; width: number; height: number } & Freshness) {
  if (!snapshot) return <NotPaired />;
  if (!snapshot.rooms.length) return <SetupCard title="No rooms yet" hint="Create rooms in Glim" />;
  const top = stale ? 22 : 0;
  const tiles = snapshot.rooms.map((room): Tile => ({ key: room.id, room }));
  return (
    <FlexWidget style={{ ...shell, borderColor: line(stale ? 0.07 : 0.09), padding: 4 }}>
      {stale && (
        <FlexWidget style={{ paddingLeft: 10, paddingTop: 4, height: top }}>
          <StaleBadge snapshot={snapshot} />
        </FlexWidget>
      )}
      {tileRows({ tiles, snapshot, width, height, stale, top })}
    </FlexWidget>
  );
}

/** Rooms and lights picked by the user, in their order (4×1: 4 tiles, 4×2: 8). Tap a tile to toggle it. */
export function GridWidget({ snapshot, tiles, width, height, stale }: { snapshot: Snapshot | null; tiles: Tile[]; width: number; height: number } & Freshness) {
  if (!snapshot) return <NotPaired />;
  if (!tiles.length) return <SetupCard title="Nothing to show" hint="Long-press to pick rooms and lights" />;
  const top = stale ? 22 : 0;
  return (
    <FlexWidget style={{ ...shell, borderColor: line(stale ? 0.07 : 0.09), padding: 4 }}>
      {stale && (
        <FlexWidget style={{ paddingLeft: 10, paddingTop: 4, height: top }}>
          <StaleBadge snapshot={snapshot} />
        </FlexWidget>
      )}
      {tileRows({ tiles, snapshot, width, height, stale, top })}
    </FlexWidget>
  );
}

/**
 * One room or light (1×1): one big jewel and its name in small capitals. The whole widget is the
 * toggle. Offline: muted, with a small cloud-off mark in place of nothing.
 */
export function LightWidget({ snapshot, tile, width, height, stale }: { snapshot: Snapshot | null; tile: Tile | null; width: number; height: number } & Freshness) {
  if (!snapshot || !tile) {
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        style={{ ...shell, backgroundColor: 'rgba(7, 7, 8, 0.6)', borderColor: line(0.3), borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', padding: 6 }}
      >
        <SvgWidget svg={iconSvg('plan', color.champagne, 20)} style={{ width: 20, height: 20 }} />
        <TextWidget text={snapshot ? 'SET UP' : 'PAIR'} style={{ ...caps(8, MUTED), marginTop: 7 }} />
      </FlexWidget>
    );
  }
  const look = tileLook(tile, snapshot);
  const live = look.on && !stale;
  // The jewel and its glow: as big as the cell allows, leaving room for the name.
  const px = Math.max(28, Math.min(48, Math.min(width - 16, height - 34)));
  return (
    <FlexWidget
      {...look.click}
      accessibilityLabel={look.label}
      style={{
        ...shell,
        borderColor: live ? tint(look.c, 0.2) : line(stale ? 0.07 : 0.09),
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
      }}
    >
      <SvgWidget svg={look.jewel(px, stale)} style={{ width: px, height: px }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        {stale && <SvgWidget svg={iconSvg('cloudOff', color.secondary, 9)} style={{ width: 9, height: 9, marginRight: 3 }} />}
        <TextWidget
          text={look.name.toUpperCase()}
          maxLines={1}
          truncate="END"
          style={{ ...caps(8.5, live ? IVORY : SECONDARY), letterSpacing: 8.5 * 0.14, textAlign: 'center' }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

/** "Home" (or the room zoomed into) and "8 OF 9 ON" / "ALL OFF" / "LAST KNOWN · 21:42". */
function HomeTitle({
  snapshot,
  stale,
  size,
  title = 'Home',
  lightIds,
  shadow = false,
}: {
  snapshot: Snapshot;
  stale: boolean;
  size: number;
  title?: string;
  lightIds?: string[];
  shadow?: boolean;
}) {
  const sh = shadow ? SHADOW : {};
  const reachable = snapshot.lights.filter((l) => l.reachable && (!lightIds || lightIds.includes(l.id)));
  const lit = reachable.filter((l) => l.on).length;
  const sub = stale ? `LAST KNOWN · ${clock(snapshot.fetchedAt)}` : lit ? `${lit} OF ${reachable.length} ON` : 'ALL OFF';
  return (
    <FlexWidget style={{ flexDirection: 'column' }}>
      <TextWidget text={title} maxLines={1} truncate="END" style={{ fontFamily: font.display, fontSize: size, color: stale ? SECONDARY : IVORY, ...sh }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        {stale && <SvgWidget svg={iconSvg('cloudOff', color.secondary, 11)} style={{ width: 11, height: 11, marginRight: 5 }} />}
        <TextWidget text={sub} style={shadow ? { ...caps(9, line(0.9)), ...CAPS_SHADOW } : caps(9, stale ? MUTED : SECONDARY)} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** "All off" when something is lit, "All on" otherwise. Sent natively when the home group is known. */
function AllButton({ snapshot, pill, shadow = false }: { snapshot: Snapshot; pill: boolean; shadow?: boolean }) {
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
        ...(pill ? { borderRadius: 19, borderWidth: 1, borderColor: line(0.14), ...(shadow ? { backgroundColor: 'rgba(7, 7, 8, 0.45)' as Rgba } : {}) } : {}),
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
      <TextWidget text={anyOn ? 'ALL OFF' : 'ALL ON'} style={{ ...caps(9, shadow ? line(0.9) : SECONDARY), marginLeft: 9, ...(shadow ? CAPS_SHADOW : {}) }} />
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

/** The weather in a Map widget's corner: its icon, and the temperature (or its name when forced). */
export type WidgetWeather = { icon: IconName; text: string; temp: boolean };

/** Soft shadow under text over a see-through widget (small text turns ivory too), so it reads on any wallpaper. */
const SHADOW = { textShadowColor: 'rgba(0, 0, 0, 0.6)' as Rgba, textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } };
/** A tighter one for small capitals (a wide shadow smudges them). */
const CAPS_SHADOW = { ...SHADOW, textShadowColor: 'rgba(0, 0, 0, 0.5)' as Rgba, textShadowRadius: 2 };

/** The weather, top left: a small icon and a bigger "11°" in Jost light. */
function WeatherCorner({ weather, shadow }: { weather: WidgetWeather; shadow: boolean }) {
  const ink = line(0.86);
  const icon =
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${ink}" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPath(weather.icon)}"/></svg>`;
  return (
    <FlexWidget style={{ marginLeft: 18, marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
      <SvgWidget svg={icon} style={{ width: 22, height: 22 }} />
      <TextWidget
        text={weather.text}
        maxLines={1}
        style={{ fontFamily: font.display, fontSize: weather.temp ? 26 : 17, color: ink, marginLeft: 8, ...(shadow ? SHADOW : {}) }}
      />
    </FlexWidget>
  );
}

export function MapWidget({
  snapshot,
  plan,
  width,
  height,
  stale,
  outside = false,
  background = 'black',
  weather,
}: {
  snapshot: Snapshot | null;
  plan: Plan | null;
  width: number;
  height: number;
  /** The weather is drawn underneath (native frames): leave the ground see-through. */
  outside?: boolean;
  /** Black, see-through, or a smoked card (drawn with the outside when there is one). */
  background?: WidgetBackground;
  /** Shown top left when the weather is on. */
  weather?: WidgetWeather | null;
} & Freshness) {
  if (!snapshot) return <NotPaired />;
  if (!plan) return <SetupCard title="Tap to set up" hint="Map · scan or draw your home" />;
  const lights = snapshot.lights;
  const { wide, box, pad } = mapWidgetBox(width, height, outside);
  const f = fitPlan(plan, box.width, box.height, pad);
  const X = (u: number) => box.left + f.x(u);
  const Y = (v: number) => box.top + f.y(v);
  const walled = walledRooms(plan);
  const outlines = plan.rooms.filter((r) => r.pts.length > 2);
  const hitRooms = outlines.flatMap((r) => {
    const room = snapshot.rooms.find((x) => x.id === r.hueRoomId);
    return room?.groupedLightId ? [{ id: room.id, pts: r.pts.map((p) => ({ x: X(p.u), y: Y(p.v) })) }] : [];
  });
  const hitLights = plan.lights.flatMap((pl) => {
    const l = lights.find((x) => x.id === pl.lightId);
    return l ? [{ id: l.id, x: X(pl.u), y: Y(pl.v), roomId: l.roomId }] : [];
  });
  const showLabels = box.height >= 200;
  const markers = plan.lights.map((l) => ({ x: X(l.u), y: Y(l.v) }));
  const clear = background === 'transparent';
  // With the outside, its ground image carries the background (this image lies over it).
  const backgroundColor = outside || clear ? ('#00000000' as Hex) : background === 'glass' ? (GLASS as Rgba) : GROUND;

  // The whole widget opens the app; the tap areas below lie over it. Its id ("0-0") sorts before
  // theirs, so the library adds it first, at the bottom of the stack: only taps outside every room
  // and light reach it.
  return (
    <OverlapWidget
      clickAction="OPEN_APP"
      style={{ ...shell, backgroundColor, borderColor: line(stale ? 0.07 : 0.09), ...(clear ? { borderWidth: 0 } : {}) }}
    >
      <SvgWidget
        svg={planToSvg(plan, lights, box.width, box.height, { padding: pad, ground: GROUND, stale, outdoorOpen: outside })}
        style={{ width: box.width, height: box.height, marginLeft: box.left, marginTop: box.top }}
      />
      {/* The widget library can't take a null child: skipped items return [] through flatMap. */}
      {showLabels &&
        outlines.flatMap((r) => {
          const xs = r.pts.map((p) => X(p.u));
          const w = Math.max(...xs) - Math.min(...xs);
          if (w < 56) return [];
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
      {/* Tap areas: rectangles that never overlap (see hitAreas), a light's around it, its room's elsewhere. */}
      {hitAreas(box, hitRooms, hitLights).flatMap((a, i) => {
        if (a.target.kind === 'light') {
          const l = lights.find((x) => x.id === a.target.id);
          if (!l) return [];
          return (
            <FlexWidget
              key={`h${i}`}
              clickAction="FAST_TOGGLE_LIGHT"
              clickActionData={fastToggle(`light/${l.id}`, !l.on, { lightId: l.id })}
              accessibilityLabel={`${l.name}, ${!l.reachable ? 'unreachable' : l.on ? 'on' : 'off'}`}
              style={{ marginLeft: a.x, marginTop: a.y, width: a.w, height: a.h }}
            />
          );
        }
        const room = snapshot.rooms.find((x) => x.id === a.target.id);
        if (!room?.groupedLightId) return [];
        const on = lightsOf(room, snapshot).some(isLit);
        return (
          <FlexWidget
            key={`h${i}`}
            clickAction="FAST_TOGGLE_ROOM"
            clickActionData={fastToggle(`grouped_light/${room.groupedLightId}`, !on, { roomId: room.id })}
            accessibilityLabel={`${room.name}, ${on ? 'on' : 'off'}`}
            style={{ marginLeft: a.x, marginTop: a.y, width: a.w, height: a.h }}
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
          <HomeTitle snapshot={snapshot} stale={stale} size={22} shadow={clear} />
          <AllButton snapshot={snapshot} pill={false} shadow={clear} />
        </FlexWidget>
      ) : (
        []
      )}
      {wide ? (
        []
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
          <HomeTitle snapshot={snapshot} stale={stale} size={18} shadow={clear} />
          <AllButton snapshot={snapshot} pill shadow={clear} />
        </FlexWidget>
      )}
      {weather ? <WeatherCorner weather={weather} shadow={clear} /> : []}
    </OverlapWidget>
  );
}

/** The night path mark: a dashed trail through three glowing dots. Drawn as SVG: widgets can't blur a view. */
function pathMarkSvg(dots: string[], stale: boolean) {
  const h = 14;
  const a = stale ? 0.5 : 1;
  const c = dots[0] ?? color.champagne;
  const pts = [
    [6, 10],
    [22, 4],
    [40, 9],
  ];
  const glow = pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="url(#g)"/><circle cx="${x}" cy="${y}" r="2" fill="${c}" opacity="${a}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="${h}" viewBox="0 0 46 ${h}">` +
    `<defs><radialGradient id="g"><stop offset="0" stop-color="${c}" stop-opacity="${0.6 * a}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>` +
    `<path d="M6 10 Q14 2 22 4 T40 9" fill="none" stroke="${color.champagne}" stroke-opacity="${0.6 * a}" stroke-width="1" stroke-dasharray="2 3" stroke-linecap="round"/>` +
    `${glow}</svg>`
  );
}

/** The moon for a sleep fade button. */
const moonSvg = (c: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPath('sleep')}"/></svg>`;

/** The power mark for "All off". */
const powerSvg = (c: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"><path d="${iconPath('power')}"/></svg>`;

export type MoodTile = MoodButton & { showing: boolean };

/** What tapping a mood button does: start a sleep fade, all off, or apply the mood (natively when it can). */
function moodClick(b: MoodTile, snapshot: Snapshot) {
  const off = b.lights === null;
  const home = snapshot.homeGroupId;
  // A mood from the Hue app is one scene recall; the others, a request per light.
  const batch = b.request ? JSON.stringify([b.request]) : b.lights?.length ? JSON.stringify(moodRequests(snapshot, b.lights, b.opts)) : null;
  const click = b.sleep
    ? {
        // Native code starts the fade (or stops the one running), like the Rituals tab (GlimSleep.kt).
        clickAction: b.showing ? 'FAST_SLEEP_STOP' : 'FAST_SLEEP',
        clickActionData: { fastSleep: JSON.stringify({ targets: b.sleep.targets, fadeSec: b.sleep.fadeMin * 60 }), moodKey: b.key },
      }
    : off
    ? home
      ? { clickAction: 'FAST_TOGGLE_ALL', clickActionData: fastToggle(`grouped_light/${home}`, false, { all: 'home' }) }
      : { clickAction: 'TOGGLE_ALL', clickActionData: { target: 'off' } }
    : batch
      ? {
          clickAction: 'FAST_APPLY_MOOD',
          // A path that turns itself off carries its alarm (PathOff.kt): set from native code with the tap.
          clickActionData: b.off
            ? { fastBatch: batch, moodKey: b.key, fastOffKey: b.off.key, fastOffMin: String(b.off.min), fastOffLights: JSON.stringify(b.off.lights) }
            : { fastBatch: batch, moodKey: b.key },
        }
      : { clickAction: 'OPEN_APP' };
  return click;
}

/** A mood button's mark size (dp). */
const MARK = 20;

/** A mood button's mark: the mood's mark, the night path mark, a moon (sleep fade) or power (All off). */
function moodMark(b: MoodTile, stale: boolean) {
  const live = b.showing && !stale;
  const off = b.lights === null;
  const path = b.path;
  const dots = b.dots;
  if (b.sleep || off) return { svg: b.sleep ? moonSvg(live ? color.champagne : color.secondary) : powerSvg(live ? color.champagne : color.secondary), width: 14, height: 14 };
  if (path) return { svg: pathMarkSvg(dots, stale), width: 46, height: 14 };
  // A mood's mark: its glyph over a pool of its colors, or its colors as orbs.
  return { svg: moodMarkSvg({ colors: dots, glyph: b.glyph ?? null, size: MARK, faded: stale }), width: MARK, height: MARK };
}

/** One mood button: its colors on top, its name below. Champagne edge while the lights look like it. */
function MoodButtonTile({ b, snapshot, stale, width, lines }: { b: MoodTile; snapshot: Snapshot; stale: boolean; width: number; lines: 1 | 2 }) {
  const click = moodClick(b, snapshot);
  const live = b.showing && !stale;
  const { svg: dotSvg, width: dotW, height: dotH } = moodMark(b, stale);
  return (
    <FlexWidget
      {...click}
      accessibilityLabel={`${b.name}${live ? ', on now' : ''}`}
      style={{
        width,
        height: 'match_parent',
        marginHorizontal: 3,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: live ? tint(color.champagne, 0.55) : line(stale ? 0.07 : 0.1),
        backgroundColor: live ? tint(color.champagne, 0.06) : 'rgba(0, 0, 0, 0)',
        paddingHorizontal: 11,
        paddingTop: 9,
        paddingBottom: 9,
        justifyContent: 'space-between',
      }}
    >
      <SvgWidget svg={dotSvg} style={{ width: dotW, height: dotH }} />
      <TextWidget
        text={b.name}
        maxLines={lines}
        truncate="END"
        style={{ fontFamily: font.displayRegular, fontSize: lines === 2 ? 13 : 14, color: live ? (color.champagne as Hex) : stale ? SECONDARY : IVORY }}
      />
    </FlexWidget>
  );
}

/** How many mood buttons a widget of this size fits: about 76 dp wide and 52 dp tall each. */
export function moodSlots(width: number, height: number) {
  const cols = Math.max(1, Math.min(4, Math.floor((width - 8) / 76)));
  const rows = Math.max(1, Math.min(4, Math.floor((height - 8) / 52)));
  return { cols, rows };
}

/** Mood buttons: tap one to apply it. "All off" stays the last button when they don't all fit. */
export function MoodsWidget({ snapshot, buttons, width, height, stale }: { snapshot: Snapshot | null; buttons: MoodTile[]; width: number; height: number } & Freshness) {
  if (!snapshot) return <NotPaired />;
  if (!buttons.length) return <SetupCard title="No moods yet" hint="Long-press to pick moods" />;
  const { cols: maxCols, rows: maxRows } = moodSlots(width, height);
  const cap = maxCols * maxRows;
  const offAt = buttons.findIndex((b) => b.lights === null);
  const fits = buttons.length <= cap ? buttons : offAt >= 0 ? [...buttons.filter((b) => b.lights !== null).slice(0, cap - 1), buttons[offAt]] : buttons.slice(0, cap);
  const rowCount = Math.ceil(fits.length / maxCols);
  const cols = Math.ceil(fits.length / rowCount);
  const rows = Array.from({ length: rowCount }, (_, i) => fits.slice(i * cols, i * cols + cols));
  const tileWidth = Math.floor((width - 10) / cols) - 6;
  // Long names ("Warm white & lagoon") wrap on a second line when the tiles are tall enough.
  const lines = (height - 8) / rowCount - 6 >= 64 ? 2 : 1;
  return (
    <FlexWidget style={{ ...shell, borderColor: line(stale ? 0.07 : 0.09), padding: 4 }}>
      {rows.map((row, i) => (
        <FlexWidget key={i} style={{ flexDirection: 'row', width: 'match_parent', flex: 1, marginVertical: 3 }}>
          {row.map((b) => (
            <MoodButtonTile key={b.key} b={b} snapshot={snapshot} stale={stale} width={tileWidth} lines={lines} />
          ))}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}
