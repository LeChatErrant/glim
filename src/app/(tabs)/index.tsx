import { Redirect, router, useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { planAll, planLightBrightness, planToggleLight, planToggleRoom } from '../../lib/actions';
import { getBridge, syncFastConfig } from '../../lib/hue/bridge';
import { roomIsOn, type Light, type Snapshot } from '../../lib/hue/client';
import { useHome } from '../../lib/hue/useHome';
import { ambienceKelvin, averageBrightness, houseMood, isLit, lightLevel, lightShape, lightsOf, lightTypeLabel } from '../../lib/lights';
import { loadHiddenLights, loadMap, saveHiddenLights, saveMapRotation, toPlan, type HomeMap } from '../../lib/map/map';
import { useOutside, type Outside } from '../../lib/weather/source';
import { ConnectionBadge, Glow, IconButton, PillButton, Section, TagButton, type Connection } from '../../ui/controls';
import { FloorPlan, Jewel, LightMarker } from '../../ui/FloorPlan';
import { Icon, weatherIcon } from '../../ui/icons';
import { OutsideBack, OutsideFront } from '../../ui/Outside';
import { turnTo, useMapGestures } from '../../ui/MapGestures';
import { refreshAllWidgets } from '../../widgets/task-handler';
import { ChoiceRow } from '../../ui/scan/parts';
import { Display, Label, Txt } from '../../ui/text';
import { color, font, hairline, TAB_BAR_SPACE } from '../../ui/theme';

export default function Home() {
  const [paired, setPaired] = useState<boolean | null>(null);
  useEffect(() => {
    getBridge().then((b) => setPaired(!!b));
    syncFastConfig().catch(() => null);
  }, []);
  if (paired === null) return null;
  if (!paired) return <Redirect href="/pair" />;
  return <MapScreen />;
}

function MapScreen() {
  const insets = useSafeAreaInsets();
  const { snapshot, connection, act } = useHome();
  const [map, setMap] = useState<HomeMap | null | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [screen, setScreen] = useState({ w: 0, h: 0 });
  const [mapAt, setMapAt] = useState({ x: 0, y: 0 });
  const focused = useIsFocused();
  const { outside } = useOutside(focused);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; v: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const lastSent = useRef(0);

  useFocusEffect(
    useCallback(() => {
      loadMap().then(setMap);
      loadHiddenLights().then(setHidden);
    }, []),
  );

  const plan = useMemo(() => (map && map.rooms.length ? toPlan(map) : null), [map]);
  const turn = async (degrees: number) => {
    const next = await saveMapRotation(turnTo(map?.rotation ?? 0, degrees));
    if (next) setMap(next);
    refreshAllWidgets().catch(() => null);
  };
  const gestures = useMapGestures({ width: size.w, height: size.h, onTurn: turn });
  const lights = useMemo(() => {
    const all = snapshot?.lights ?? [];
    return drag ? all.map((l) => (l.id === drag.id ? { ...l, on: true, brightness: drag.v } : l)) : all;
  }, [snapshot, drag]);

  const onLightDrag = (id: string, v: number, done: boolean) => {
    setSelected(id);
    setDrag(done ? null : { id, v });
    // Live preview on the real light, without flooding the bridge.
    const now = Date.now();
    if (done || now - lastSent.current > 150) {
      lastSent.current = now;
      act((s) => planLightBrightness(s, id, v));
    }
  };

  const anyOn = lights.some(isLit);
  const selectedLight = lights.find((l) => l.id === selected);
  // Lights in a room drawn on the map but not placed in it (just added to that room...), unless set aside.
  // Lights in unmapped rooms, or in no room, aren't missing: their room isn't on the map either.
  const missing = map
    ? lights.filter((l) => l.roomId && map.rooms.some((r) => r.hueRoomId === l.roomId) && !map.lights.some((m) => m.lightId === l.id) && !hidden.includes(l.id))
    : [];
  const hideMissing = () => {
    const next = [...hidden, ...missing.map((l) => l.id)];
    setHidden(next);
    saveHiddenLights(next);
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }} onLayout={(e) => setScreen({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {outside && plan && size.w > 0 && screen.w > 0 && (
        <OutsideBack
          sky={outside.sky}
          width={screen.w}
          height={screen.h}
          plan={plan}
          lights={lights}
          mapBox={{ x: mapAt.x, y: mapAt.y, w: size.w, h: size.h }}
          view={gestures.view}
          twist={gestures.twist}
          active={focused}
        />
      )}
      <Ambient lights={lights} />
      <View style={{ paddingTop: insets.top + 22, paddingHorizontal: 24 }}>
        <Header connection={connection} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16 }}>
          <Display size={34} style={{ lineHeight: 38 }}>
            {plan || snapshot ? (connection === 'offline' ? 'The house was' : 'The house is') : ''}
            {'\n'}
            <Text style={{ color: color.champagne }}>{snapshot ? houseMood(lights) : ''}</Text>
          </Display>
          <View style={{ alignItems: 'flex-end', marginBottom: -6 }}>
            {snapshot && <TagButton title={anyOn ? 'All off' : 'All on'} icon="power" onPress={() => act((s) => planAll(s, !anyOn))} />}
            {plan && <TagButton title="Edit map" icon="edit" onPress={() => setEditing(true)} />}
          </View>
        </View>
        {outside && <WeatherPill outside={outside} />}
      </View>

      {map === undefined ? null : plan ? (
        <>
          <View
            style={{ flex: 1, marginTop: 12, marginHorizontal: 24, overflow: 'hidden' }}
            onLayout={(e) => {
              setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
              setMapAt({ x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y });
              gestures.measure(e);
            }}
            {...gestures.responder.panHandlers}
          >
            {size.w > 0 && (
              <View style={{ flex: 1, transform: [{ rotate: `${gestures.twist}deg` }] }}>
              <FloorPlan
                plan={plan}
                view={gestures.view}
                lights={lights}
                rooms={snapshot?.rooms ?? []}
                width={size.w}
                height={size.h}
                outdoorOpen={!!outside}
                windy={outside?.sky.weather === 'storm'}
                selectedId={selected}
                onLightPress={(id) => {
                  setSelected(id);
                  act((s) => planToggleLight(s, id));
                }}
                onLightDrag={onLightDrag}
                onRoomPress={(roomId) => {
                  setSelected(null);
                  act((s) => planToggleRoom(s, roomId));
                }}
                onBackgroundPress={() => setSelected(null)}
                onLightOpen={(id) => {
                  setSelected(id);
                  router.push(`/light/${id}`);
                }}
              />
              </View>
            )}
            {gestures.zoomed && (
              <View style={{ position: 'absolute', right: 0, bottom: 0 }}>
                <TagButton title="Fit" icon="fit" onPress={gestures.fit} />
              </View>
            )}
          </View>
          {outside && <OutsideFront sky={outside.sky} active={focused} />}
          {!selectedLight && missing.length > 0 && <MissingNote lights={missing} onPlace={() => setPlacing(true)} onHide={hideMissing} />}
          {selectedLight ? (
            <LightBar
              light={selectedLight}
              onOpen={() => router.push(`/light/${selectedLight.id}`)}
              onClose={() => setSelected(null)}
              style={{ marginBottom: insets.bottom + TAB_BAR_SPACE + 18 }}
            />
          ) : (
            <Stats lights={lights} style={{ marginBottom: insets.bottom + TAB_BAR_SPACE + 18 }} />
          )}
        </>
      ) : (
        <NoMap snapshot={snapshot} onToggleRoom={(id) => act((s) => planToggleRoom(s, id))} bottom={insets.bottom + TAB_BAR_SPACE + 16} />
      )}
      <PlaceChoice
        visible={placing}
        lights={missing}
        onClose={() => setPlacing(false)}
        onPick={(path) => {
          setPlacing(false);
          router.push(path);
        }}
      />
      <EditChoice
        visible={editing}
        onTurn={(d) => turn(d)}
        onClose={() => setEditing(false)}
        onPick={(path) => {
          setEditing(false);
          router.push(path);
        }}
      />
    </View>
  );
}

function Header({ connection }: { connection: Connection }) {
  const now = useClock();
  const day = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(now);
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 }}>
      <Label tone="label">
        {day} · {time}
      </Label>
      <ConnectionBadge state={connection} />
    </View>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** "Light rain · 10°" under the headline; opens the weather settings. Marked when forced. */
function WeatherPill({ outside }: { outside: Outside }) {
  const { sky, label, temp, forcedWeather, forcedTime } = outside;
  const icon = weatherIcon(sky);
  const forced = forcedWeather || forcedTime;
  return (
    <Pressable
      onPress={() => router.navigate('/settings')}
      accessibilityRole="button"
      accessibilityLabel={`${label}${temp !== null ? `, ${temp} degrees` : ''}. Weather settings`}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 30,
        marginTop: 12,
        paddingLeft: 10,
        paddingRight: 12,
        borderRadius: 15,
        backgroundColor: 'rgba(5,5,6,0.38)',
        borderWidth: 1,
        borderColor: hairline(0.16),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={15} tint={color.champagne} stroke={1.6} />
      <Txt size={13}>{temp !== null ? `${label} · ${temp}°` : label}</Txt>
      {forced && <Label size={8} tone="champagne">{forcedTime && !forcedWeather ? 'Time set' : 'Set by hand'}</Label>}
    </Pressable>
  );
}

/** Faint warm glow at the top of the screen that fades as lights turn off. */
function Ambient({ lights }: { lights: Light[] }) {
  const reachable = lights.filter((l) => l.reachable);
  const ratio = reachable.length ? reachable.filter((l) => l.on).length / reachable.length : 0;
  if (!ratio) return null;
  return <Glow tint="#FFB46B" cx={190} cy={40} rx={360} ry={300} alpha={0.05 + 0.1 * ratio} />;
}

function Stats({ lights, style }: { lights: Light[]; style?: object }) {
  const on = lights.filter(isLit).length;
  const avg = averageBrightness(lights);
  const k = ambienceKelvin(lights);
  const big = { fontFamily: font.display, fontSize: 22, color: color.ivory, fontVariant: ['tabular-nums' as const] };
  const unit = { color: color.muted };
  return (
    <View style={[{ flexDirection: 'row', marginHorizontal: 24, marginTop: 12, borderTopWidth: 1, borderTopColor: hairline(0.1) }, style]}>
      <Stat first label="Lights on">
        <Text style={big}>
          {on}
          <Text style={unit}>/{lights.length}</Text>
        </Text>
      </Stat>
      <Stat label="Average">
        <Text style={big}>
          {avg ?? '—'}
          {avg !== null && <Text style={unit}>%</Text>}
        </Text>
      </Stat>
      <Stat label="Ambience">
        <Text style={big}>
          {k ? String(k).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '—'}
          {k ? <Text style={unit}> K</Text> : null}
        </Text>
      </Stat>
    </View>
  );
}

/** The light tapped on the map, under it (never over it): name, type, level, Open, close. */
function LightBar({ light, onOpen, onClose, style }: { light: Light; onOpen: () => void; onClose: () => void; style?: object }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, marginTop: 12, paddingTop: 12, minHeight: 62, borderTopWidth: 1, borderTopColor: hairline(0.1) }, style]}>
      <LightMarker light={light} size={30} glow={false} />
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${light.name}`} style={({ pressed }) => ({ flex: 1, minWidth: 0, opacity: pressed ? 0.6 : 1 })}>
        <Txt size={15} medium numberOfLines={1} style={{ lineHeight: 20 }}>
          {light.name}
        </Txt>
        <Txt size={12} tone="muted" numberOfLines={1} style={{ lineHeight: 16 }}>
          {`${lightTypeLabel(light)} · `}
          <Text style={{ color: light.reachable ? color.champagne : color.warning }}>{lightLevel(light)}</Text>
        </Txt>
      </Pressable>
      <PillButton title="Open" height={40} onPress={onOpen} />
      <IconButton icon="close" label="Close" onPress={onClose} />
    </View>
  );
}

function Stat({ label, first, children }: { label: string; first?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, paddingTop: 12, paddingLeft: first ? 0 : 14, borderLeftWidth: first ? 0 : 1, borderLeftColor: hairline(0.1), gap: 3 }}>
      {children}
      <Label size={9}>{label}</Label>
    </View>
  );
}

/** Map not set up yet: invite to scan, with the rooms still one tap away. */
function NoMap({ snapshot, onToggleRoom, bottom }: { snapshot: Snapshot | null; onToggleRoom: (id: string) => void; bottom: number }) {
  const lights = snapshot?.lights ?? [];
  const on = lights.filter(isLit).length;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 36, paddingBottom: bottom, gap: 28 }}>
      <View style={{ gap: 12 }}>
        <Display size={30}>Your map starts here</Display>
        <Txt tone="secondary">Scan your home in about 3 minutes, or draw it yourself.</Txt>
        {lights.length > 0 && <Label tone="label">{lights.length} lights waiting for a place</Label>}
      </View>
      <View style={{ gap: 10 }}>
        <PillButton title="Scan with camera" kind="primary" icon="scan" onPress={() => router.push('/scan')} />
        <PillButton title="Draw it myself" icon="edit" onPress={() => router.push('/editor')} />
      </View>
      {snapshot && snapshot.rooms.length > 0 && (
        <Section title="Meanwhile, your rooms" right={<Label>{`${on} of ${lights.length} on`}</Label>}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {snapshot.rooms.map((room) => {
              const roomOn = roomIsOn(room, lights);
              const tint = lightsOf(room, snapshot).find(isLit)?.color;
              return (
                <Pressable
                  key={room.id}
                  onPress={() => onToggleRoom(room.id)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: roomOn }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    height: 40,
                    paddingHorizontal: 14,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: roomOn ? 'rgba(233,207,159,0.5)' : hairline(0.16),
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={
                      roomOn && tint
                        ? { width: 8, height: 8, borderRadius: 4, backgroundColor: tint, boxShadow: `0 0 8px 2px ${tint}` }
                        : { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: hairline(0.55) }
                    }
                  />
                  <Txt size={13} style={{ lineHeight: 18 }}>
                    {room.name}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </Section>
      )}
    </ScrollView>
  );
}

/** "Hue Play 1 and Hue Play 2 aren't on your map": lights the map doesn't show yet. */
function MissingNote({ lights, onPlace, onHide }: { lights: Light[]; onPlace: () => void; onHide: () => void }) {
  const names = lights.length === 1 ? lights[0].name : lights.length === 2 ? `${lights[0].name} and ${lights[1].name}` : `${lights.length} lights`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, marginTop: 12, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(233,207,159,0.4)' }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {lights.slice(0, 3).map((l) => (
          <Jewel key={l.id} light={l} shape={lightShape(l.archetype)} size={8} ground={color.ground} />
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={13} numberOfLines={2} style={{ lineHeight: 17 }}>
          {`${names} ${lights.length === 1 ? "isn't" : "aren't"} on your map`}
        </Txt>
        <Pressable onPress={onHide} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start' }}>
          <Txt size={12} tone="muted" style={{ lineHeight: 17 }}>
            Not now
          </Txt>
        </Pressable>
      </View>
      <PillButton title="Place" kind="primary" height={40} onPress={onPlace} />
    </View>
  );
}

/** Place missing lights: point at them in AR (they blink), or drop them on screen in their room. */
function PlaceChoice({ visible, lights, onClose, onPick }: { visible: boolean; lights: Light[]; onClose: () => void; onPick: (path: '/scan' | '/editor?place=1') => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(5,5,6,0.6)' }} />
      <View style={{ backgroundColor: color.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: hairline(0.1), paddingTop: 22, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }}>
        <Display size={24}>{lights.length === 1 ? `Place ${lights[0].name}` : `Place ${lights.length} lights`}</Display>
        <Txt size={13} tone="secondary" style={{ marginTop: 6, marginBottom: 12 }}>
          {lights.map((l) => l.name).join(', ')}
        </Txt>
        <ChoiceRow icon="edit" title="On screen" sub="Each one lands in its room. Drag it where it really is" onPress={() => onPick('/editor?place=1')} />
        <ChoiceRow icon="scan" title="With the camera" sub="Line up with your map, then point at each light as it blinks" onPress={() => onPick('/scan')} />
      </View>
    </Modal>
  );
}

/** Edit map: walk through it with the camera, or fix it on screen. */
function EditChoice({ visible, onClose, onPick, onTurn }: { visible: boolean; onClose: () => void; onPick: (path: '/scan' | '/editor') => void; onTurn: (degrees: number) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(5,5,6,0.6)' }} />
      <View
        style={{
          backgroundColor: color.sheet,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          borderTopWidth: 1,
          borderColor: hairline(0.1),
          paddingTop: 22,
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Display size={24} style={{ marginBottom: 12 }}>
          Edit your map
        </Display>
        <ChoiceRow icon="scan" title="Walk through it in AR" sub="Add rooms, redraw one, move lights where they are" onPress={() => onPick('/scan')} />
        <ChoiceRow icon="edit" title="Edit on screen" sub="Drag corners and lights, draw rooms by hand" onPress={() => onPick('/editor')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, borderTopWidth: 1, borderTopColor: hairline(0.08) }}>
          <View style={{ flex: 1 }}>
            <Display size={17} weight={400} style={{ lineHeight: 21 }}>
              Turn the map
            </Display>
            <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
              Or twist it with two fingers. Pinch to zoom
            </Txt>
          </View>
          <PillButton title="Left" height={40} onPress={() => onTurn(-90)} />
          <PillButton title="Right" height={40} onPress={() => onTurn(90)} />
        </View>
      </View>
    </Modal>
  );
}
