import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { hasTemperature, mirekFor, planLightBrightness, planLightColor, planLightKelvin, planLightLook, planToggleLight, type Planned } from '../../lib/actions';
import { identifyLight, type Light, type Room, type Snapshot } from '../../lib/hue/client';
import { hexHueSat, KELVIN_MAX, KELVIN_MIN, kelvinTint, mirekToKelvin } from '../../lib/hue/color';
import { useHome } from '../../lib/hue/useHome';
import { isLit, lightShape, lightType, lightTypeLabel } from '../../lib/lights';
import { addRecentColor, colorName, formatKelvin, kelvinName, loadRecentColors, near, WHITE_PRESETS, type Swatch } from '../../lib/palette';
import { ConnectionBadge, Glow, IconButton, PillButton, type Connection } from '../../ui/controls';
import { Icon } from '../../ui/icons';
import { Brightness, ColorDot, Dial, ModeTabs, Orb, orbInk, PowerButton, ringColor, useThrottle } from '../../ui/LightControls';
import { FavoritesRow } from '../../ui/Favorites';
import { LightSetup } from '../../ui/LightSetup';
import { Display, Label, Txt } from '../../ui/text';
import { color, hairline } from '../../ui/theme';

type Act = (plan: (s: Snapshot) => Planned | null) => void;

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function LightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { snapshot, connection, act } = useHome();
  const light = snapshot?.lights.find((l) => l.id === id);
  const room = snapshot?.rooms.find((r) => r.lightIds.includes(id));

  return (
    <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {!snapshot ? null : !light ? (
        <View style={{ paddingHorizontal: 24, paddingTop: 22, gap: 24 }}>
          <IconButton icon="back" label="Back" onPress={goBack} />
          <Display size={30}>This light is gone</Display>
          <Txt tone="secondary">It may have been removed from the bridge.</Txt>
        </View>
      ) : light.kind === 'onoff' ? (
        <PlugView light={light} room={room} connection={connection} act={act} />
      ) : (
        <LightView light={light} room={room} act={act} />
      )}
    </View>
  );
}

/** Blinks the real light, and reports it for a moment. */
function useBlink(light: Light) {
  const [blinking, setBlinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const blink = () => {
    identifyLight(light.id).catch(() => null);
    setBlinking(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBlinking(false), 2200);
  };
  return { blinking, blink };
}

function Header({ center, right }: { center: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 22, paddingHorizontal: 24 }}>
      <IconButton icon="back" label="Back" onPress={goBack} />
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>{center}</View>
      {right ?? <View style={{ width: 40 }} />}
    </View>
  );
}

/** The light's name; tap it to rename the light or say what it is. */
function LightName({ light, size, act }: { light: Light; size: number; act: Act }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setEditing(true)}
        accessibilityRole="button"
        accessibilityLabel={`${light.name}. Change name and type`}
        style={({ pressed }) => ({ marginTop: 22, paddingHorizontal: 24, alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <Display size={size} numberOfLines={2} style={{ textAlign: 'center', lineHeight: Math.round(size * 1.08) }}>
          {light.name}
        </Display>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="edit" size={10} tint={color.muted} stroke={1.6} />
          <Label size={9}>Name & type</Label>
        </View>
      </Pressable>
      {editing && <LightSetup light={light} visible onClose={() => setEditing(false)} act={act} />}
    </>
  );
}

function Unreachable({ light }: { light: Light }) {
  if (light.reachable) return null;
  return (
    <Txt size={13} style={{ color: color.warning, textAlign: 'center', marginTop: 8 }}>
      Unreachable. Check that it has power.
    </Txt>
  );
}

/** "Part of · Salon ›": opens the room sheet. */
function PartOf({ room }: { room: Room | undefined }) {
  if (!room) {
    return (
      <View style={{ gap: 3 }}>
        <Label>Part of</Label>
        <Txt size={14} tone="muted">
          No room
        </Txt>
      </View>
    );
  }
  return (
    <Pressable onPress={() => router.push(`/room/${room.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${room.name}`} style={({ pressed }) => ({ gap: 3, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Label>Part of</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Txt size={14}>{room.name}</Txt>
        <Icon name="chevronRight" size={12} tint={color.muted} stroke={1.6} />
      </View>
    </Pressable>
  );
}

function LightView({ light, room, act }: { light: Light; room: Room | undefined; act: Act }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const throttle = useThrottle();
  const { blinking, blink } = useBlink(light);
  const canColor = light.kind === 'color';
  const canWhite = hasTemperature(light);
  const [tab, setTab] = useState<'color' | 'white'>(canColor && light.mirek === null ? 'color' : 'white');
  const [recents, setRecents] = useState<Swatch[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => {
    loadRecentColors().then(setRecents);
  }, []);

  const on = isLit(light);
  const bri = light.brightness ?? 100;
  const dial = Math.max(200, Math.min(270, width - 120, height - insets.top - insets.bottom - 560));
  const ink = orbInk(on);
  const kelvin = light.mirek ? Math.max(KELVIN_MIN, Math.min(KELVIN_MAX, Math.round(mirekToKelvin(light.mirek) / 50) * 50)) : 2700;
  const hue = Math.round(hexHueSat(light.color).hue);

  const pickColor = (hex: string) => {
    act((s) => planLightColor(s, light.id, hex));
    addRecentColor(hex).then(setRecents);
  };

  let control: ReactNode;
  if (canColor && tab === 'color') {
    const h = preview ?? hue;
    const shownColor = preview === null ? light.color : ringColor(preview);
    control = (
      <Dial
        mode="hue"
        size={dial}
        value={hue}
        on={on}
        tint={light.color}
        label={`Color, ${colorName(shownColor)}`}
        onChange={(v) => {
          setPreview(v);
          throttle(() => act((s) => planLightColor(s, light.id, ringColor(v))));
        }}
        onCommit={(v) => {
          setPreview(null);
          pickColor(ringColor(v));
        }}
      >
        <Display size={24} weight={400} style={{ color: ink.strong, lineHeight: 26 }}>
          {on || preview !== null ? colorName(shownColor) : 'Off'}
        </Display>
        <Label style={{ color: ink.soft, letterSpacing: 2 }}>{on || preview !== null ? `${h}° · ${bri}%` : 'Tap power to turn on'}</Label>
      </Dial>
    );
  } else if (canWhite) {
    const k = preview ?? kelvin;
    const inWhite = light.mirek !== null;
    control = (
      <Dial
        mode="white"
        size={dial}
        value={kelvin}
        on={on}
        tint={inWhite ? kelvinTint(kelvin) : light.color}
        ticks={WHITE_PRESETS.map((p) => p.kelvin)}
        label={`White temperature, ${formatKelvin(k)} kelvin`}
        onChange={(v) => {
          setPreview(v);
          throttle(() => act((s) => planLightKelvin(s, light.id, v)));
        }}
        onCommit={(v) => {
          setPreview(null);
          act((s) => planLightKelvin(s, light.id, v));
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Display size={44} weight={200} style={{ color: ink.strong, lineHeight: 48, fontVariant: ['tabular-nums'] }}>
            {inWhite || preview !== null ? formatKelvin(k) : '—'}
          </Display>
          <Display size={18} style={{ color: ink.soft }}>
            K
          </Display>
        </View>
        <Display size={16} weight={400} style={{ color: ink.soft, lineHeight: 18 }}>
          {!on && preview === null ? 'Off' : inWhite || preview !== null ? kelvinName(k) : 'In color'}
        </Display>
      </Dial>
    );
  } else {
    // Dimmable white only: nothing to pick, the orb shows the level.
    control = (
      <View style={{ width: dial, height: dial, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
        {on && <Glow tint={light.color} cx={dial / 2} cy={dial / 2} rx={dial * 0.6} alpha={0.32} />}
        <Orb size={dial * 0.75} on={on} tint={light.color}>
          <Display size={24} weight={400} style={{ color: ink.strong, lineHeight: 26 }}>
            {on ? 'White' : 'Off'}
          </Display>
          <Label style={{ color: ink.soft, letterSpacing: 2 }}>{on ? `${bri}%` : 'Tap power to turn on'}</Label>
        </Orb>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {on && <Glow tint={light.color} cx={width / 2} cy={290} rx={350} alpha={0.06 + bri * 0.0016} />}
      <Header
        center={
          <Label tone={blinking ? 'champagne' : 'label'} numberOfLines={1}>
            {blinking ? 'Blinking' : `${room?.name ?? 'No room'} · ${lightTypeLabel(light)}`}
          </Label>
        }
        right={<IconButton icon="blink" label={`Make ${light.name} blink`} onPress={blink} />}
      />
      <LightName light={light} size={32} act={act} />
      <Unreachable light={light} />

      <View style={{ marginTop: light.reachable ? 30 : 14 }}>{control}</View>

      {canColor && canWhite ? (
        <View style={{ marginTop: 22 }}>
          <ModeTabs
            tabs={[
              { id: 'color', title: 'Color' },
              { id: 'white', title: 'White' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>
      ) : (
        <View style={{ height: 22 }} />
      )}

      <View style={{ paddingHorizontal: 28, marginTop: 18 }}>
        <Brightness
          value={bri}
          on={on}
          tint={light.color}
          onChange={(v) => throttle(() => act((s) => planLightBrightness(s, light.id, v)))}
          onCommit={(v) => act((s) => planLightBrightness(s, light.id, v))}
        />
      </View>

      <View style={{ paddingHorizontal: 28, marginTop: 16 }}>
        <FavoritesRow
          current={on ? { ...(light.mirek ? { kelvin } : canColor ? { hex: light.color } : {}), brightness: bri } : null}
          onApply={(f) => act((s) => planLightLook(s, light.id, f))}
        />
      </View>

      {canColor && tab === 'color' && (
        <View style={{ paddingHorizontal: 28, marginTop: 16, gap: 12 }}>
          <Label>Recent</Label>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {recents.map((s) => (
              <Pressable key={s.hex} onPress={() => act((x) => planLightColor(x, light.id, s.hex))} accessibilityRole="button" accessibilityLabel={s.name} hitSlop={4}>
                <ColorDot hex={s.hex} selected={on && light.mirek === null && near(light.color, s.hex)} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {canWhite && (tab === 'white' || !canColor) && (
        <View style={{ paddingHorizontal: 28, marginTop: 16, gap: 12 }}>
          <Label>Presets</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {WHITE_PRESETS.map((p) => {
              const sel = on && light.mirek !== null && Math.abs(light.mirek - mirekFor(light, p.kelvin)) <= 3;
              const tint = kelvinTint(p.kelvin);
              return (
                <Pressable
                  key={p.kelvin}
                  onPress={() => act((s) => planLightKelvin(s, light.id, p.kelvin))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={`${p.name}, ${formatKelvin(p.kelvin)} kelvin`}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 60,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: sel ? color.champagne : hairline(0.12),
                    backgroundColor: sel ? color.selected : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, marginBottom: 3, backgroundColor: tint, boxShadow: `0 0 8px 2px ${tint}88` }} />
                  <Txt size={12} style={{ lineHeight: 15 }}>
                    {p.name}
                  </Txt>
                  <Txt size={10} tone="muted" numberOfLines={1} style={{ lineHeight: 12, fontVariant: ['tabular-nums'] }}>
                    {`${formatKelvin(p.kelvin)} K`}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', marginHorizontal: 24, marginBottom: 28, paddingTop: 16 }}>
        <PartOf room={room} />
        <PowerButton on={on} label={on ? `Turn ${light.name} off` : `Turn ${light.name} on`} onPress={() => act((s) => planToggleLight(s, light.id))} />
      </View>
    </View>
  );
}

/** Smart plugs: on/off only, with a hero of what's plugged in. */
function PlugView({ light, room, connection, act }: { light: Light; room: Room | undefined; connection: Connection; act: Act }) {
  const { width } = useWindowDimensions();
  const { blinking, blink } = useBlink(light);
  const on = isLit(light);
  const shape = lightShape(light.archetype);
  const type = lightTypeLabel(light);
  const what = lightType(light.archetype) === 'plug' ? 'Smart plug' : `${type.replace(' · plug', '')} on a smart plug`;
  const tint = light.color;

  return (
    <View style={{ flex: 1 }}>
      {on && <Glow tint={tint} cx={width / 2} cy={240} rx={350} ry={320} alpha={0.18} />}
      <Header center={<ConnectionBadge state={connection} />} />
      <LightName light={light} size={34} act={act} />
      <Label size={9} tone="label" style={{ textAlign: 'center', marginTop: 10 }}>
        {`${room?.name ?? 'No room'} · ${what}`}
      </Label>
      <Unreachable light={light} />

      <PlugHero width={width - 48} on={on} tint={tint} garland={shape === 'string'} blinking={blinking} />

      <View style={{ alignItems: 'center', marginTop: 2 }}>
        <PowerButton size={88} on={on} glow={tint} label={on ? `Turn ${light.name} off` : `Turn ${light.name} on`} onPress={() => act((s) => planToggleLight(s, light.id))} />
        <Txt size={14} tone="secondary" style={{ marginTop: 16 }}>
          {on ? 'On' : 'Off · tap to turn on'}
        </Txt>
      </View>

      <View style={{ marginHorizontal: 24, marginTop: 26, borderTopWidth: 1, borderTopColor: hairline(0.1) }}>
        <Pressable
          disabled={!room}
          onPress={() => room && router.push(`/room/${room.id}`)}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 54, borderBottomWidth: 1, borderBottomColor: hairline(0.1), opacity: pressed ? 0.6 : 1 })}
        >
          <Txt size={14} tone="secondary" style={{ flex: 1 }}>
            Part of
          </Txt>
          <Txt size={14} tone={room ? 'ivory' : 'muted'}>
            {room?.name ?? 'No room'}
          </Txt>
          {room && <Icon name="chevronRight" size={14} tint={color.muted} stroke={1.6} />}
        </Pressable>
      </View>

      <View style={{ marginTop: 'auto', marginHorizontal: 24, marginBottom: 28 }}>
        <PillButton title={blinking ? 'Blinking' : 'Blink'} icon="blink" onPress={blink} />
      </View>
    </View>
  );
}

/** String lights hang as a garland of beads; anything else is one big diamond. Blinking makes them flicker. */
function PlugHero({ width, on, tint, garland, blinking }: { width: number; on: boolean; tint: string; garland: boolean; blinking: boolean }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!blinking) return;
    let n = 0;
    const t = setInterval(() => setPhase(++n), 280);
    return () => {
      clearInterval(t);
      setPhase(0);
    };
  }, [blinking]);

  const H = 196;
  const lit = (i: number) => on && (!blinking || (i + phase) % 2 === 0);
  const bead = (on: boolean, strong: boolean) =>
    on
      ? { backgroundColor: '#FFD08A', boxShadow: `0 0 ${strong ? 10 : 8}px ${strong ? 3 : 2}px ${tint}B3, 0 0 ${strong ? 26 : 20}px ${strong ? 10 : 7}px ${tint}38` }
      : { backgroundColor: '#1E1B18', borderWidth: 1, borderColor: hairline(0.26) };

  if (!garland) {
    return (
      <View style={{ width, height: H, marginTop: 16, marginLeft: 24, alignItems: 'center', justifyContent: 'center' }}>
        {on && <Glow tint={tint} cx={width / 2} cy={H / 2} rx={150} ry={95} alpha={0.2} />}
        <View style={{ width: 26, height: 26, transform: [{ rotate: '45deg' }], ...bead(lit(0), true) }} />
      </View>
    );
  }

  const N = 13;
  const beads = Array.from({ length: N }, (_, j) => {
    const t = (j + 1) / (N + 1);
    return { x: 10 + (width - 20) * t, y: 30 + 480 * t * (1 - t), strong: j % 3 === 0 };
  });
  return (
    <View style={{ width, height: H, marginTop: 16, marginLeft: 24 }}>
      {on && <Glow tint={tint} cx={width / 2} cy={135} rx={150} ry={95} alpha={0.2} />}
      <Svg width={width} height={H} style={{ position: 'absolute' }}>
        <Path d={`M10 30 Q${width / 2} 270 ${width - 10} 30`} fill="none" stroke={hairline(0.24)} strokeWidth={1} />
        <Path d={`M10 30 L4 22 M${width - 10} 30 L${width - 4} 22`} fill="none" stroke={hairline(0.24)} strokeWidth={1} strokeLinecap="round" />
      </Svg>
      {beads.map((b, i) => (
        <View key={i} style={{ position: 'absolute', left: b.x - 4.5, top: b.y + 5, width: 9, height: 9, borderRadius: 4.5, ...bead(lit(i + 1), b.strong) }} />
      ))}
    </View>
  );
}
