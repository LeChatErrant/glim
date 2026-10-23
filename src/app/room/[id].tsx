import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hasTemperature, mirekFor, planRoomBrightness, planRoomColor, planRoomKelvin, planToggleRoom } from '../../lib/actions';
import { roomIsOn, type Light } from '../../lib/hue/client';
import { kelvinTint } from '../../lib/hue/color';
import { useHome } from '../../lib/hue/useHome';
import { isLit, lightLevel, lightShape, lightsOf } from '../../lib/lights';
import { formatKelvin, loadRecentColors, near, type Swatch } from '../../lib/palette';
import { Glow, Switch } from '../../ui/controls';
import { Jewel } from '../../ui/FloorPlan';
import { Icon } from '../../ui/icons';
import { Brightness, ColorDot, useThrottle } from '../../ui/LightControls';
import { Display, Label, Txt } from '../../ui/text';
import { color, hairline } from '../../ui/theme';

const ROOM_WHITES = [2200, 2700, 4000, 6500];

const close = () => (router.canGoBack() ? router.back() : router.replace('/rooms'));

/** A room's controls as a sheet over the screen it was opened from. */
export default function RoomSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { snapshot, act } = useHome();
  const throttle = useThrottle();
  const [recents, setRecents] = useState<Swatch[]>([]);
  useEffect(() => {
    loadRecentColors().then(setRecents);
  }, []);

  // Slides up on open, follows the finger down, closes past a threshold.
  const [y] = useState(() => new Animated.Value(height));
  useEffect(() => {
    Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 16 }).start();
  }, [y]);
  const dismiss = () => Animated.timing(y, { toValue: height, duration: 160, useNativeDriver: true }).start(close);
  const [drag] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 0.8) Animated.timing(y, { toValue: height, duration: 160, useNativeDriver: true }).start(close);
        else Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    }),
  );

  const room = snapshot?.rooms.find((r) => r.id === id);
  const lights = room && snapshot ? lightsOf(room, snapshot) : [];
  const lit = lights.filter(isLit);
  const anyOn = room && snapshot ? roomIsOn(room, snapshot.lights) : false;
  const dimmable = lights.filter((l) => l.brightness !== null);
  const pool = dimmable.filter(isLit).length ? dimmable.filter(isLit) : dimmable;
  const level = pool.length ? Math.round(pool.reduce((s, l) => s + (l.brightness ?? 0), 0) / pool.length) : 0;
  const colorLights = lights.filter((l) => l.kind === 'color');
  const whiteLights = lights.filter(hasTemperature);
  const lead = (lit.find((l) => l.kind !== 'onoff') ?? lit[0])?.color ?? color.muted;
  const litColor = colorLights.filter(isLit);
  const litWhite = whiteLights.filter(isLit);

  const countLine = !lights.length ? 'No lights yet' : anyOn ? `${lit.length} of ${lights.length} on` : lights.length === 1 ? 'Off' : 'All off';

  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={dismiss} accessibilityLabel="Close" style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(5,5,6,0.6)' }} />
      <Animated.View
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: height * 0.9,
          paddingTop: 26,
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 24,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          borderTopWidth: 1,
          borderColor: hairline(0.1),
          backgroundColor: color.sheet,
          overflow: 'hidden',
          transform: [{ translateY: y }],
        }}
      >
        {anyOn && <Glow tint={lead} cx={140} cy={10} rx={230} ry={160} alpha={0.11} />}
        <View {...drag.panHandlers}>
          <View style={{ position: 'absolute', alignSelf: 'center', top: -16, width: 36, height: 4, borderRadius: 2, backgroundColor: hairline(0.2) }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Display size={24} numberOfLines={1} style={{ lineHeight: 27 }}>
                {room?.name ?? (snapshot ? 'Room not found' : '')}
              </Display>
              <Txt size={13} tone="secondary" style={{ marginTop: 4, fontVariant: ['tabular-nums'] }}>
                {room ? countLine : ' '}
              </Txt>
            </View>
            {room && lights.length > 0 && <Switch big on={anyOn} label={`${room.name} lights`} onToggle={() => act((s) => planToggleRoom(s, room.id))} />}
          </View>
        </View>

        {room && dimmable.length > 0 && (
          <View style={{ marginTop: 18 }}>
            <Brightness
              big={46}
              title="Room brightness"
              ground={color.sheet}
              value={level}
              on={anyOn}
              tint={lead}
              onChange={(v) => throttle(() => act((s) => planRoomBrightness(s, room.id, v)))}
              onCommit={(v) => act((s) => planRoomBrightness(s, room.id, v))}
            />
          </View>
        )}

        {room && (colorLights.length > 0 || whiteLights.length > 0) && (
          <View style={{ marginTop: 10, gap: 6 }}>
            {colorLights.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Label tone="label" style={{ width: 58 }}>
                  Color
                </Label>
                <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between' }}>
                  {recents.map((s) => {
                    const sel = litColor.length > 0 && litColor.every((l) => l.mirek === null && near(l.color, s.hex));
                    return (
                      <Pressable
                        key={s.hex}
                        onPress={() => act((x) => planRoomColor(x, room.id, s.hex))}
                        accessibilityRole="button"
                        accessibilityLabel={`Make the color lights ${s.name.toLowerCase()}`}
                        style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <ColorDot hex={s.hex} size={30} selected={sel} ground={color.sheet} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
            {whiteLights.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Label tone="label" style={{ width: 58 }}>
                  White
                </Label>
                <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                  {ROOM_WHITES.map((k) => {
                    const sel = litWhite.length > 0 && litWhite.every((l) => l.mirek !== null && Math.abs(l.mirek - mirekFor(l, k)) <= 3);
                    const tint = kelvinTint(k);
                    return (
                      <Pressable
                        key={k}
                        onPress={() => act((s) => planRoomKelvin(s, room.id, k))}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sel }}
                        accessibilityLabel={`All whites to ${formatKelvin(k)} kelvin`}
                        style={({ pressed }) => ({
                          flex: 1,
                          height: 40,
                          borderRadius: 20,
                          borderWidth: 1,
                          borderColor: sel ? color.champagne : hairline(0.16),
                          backgroundColor: sel ? color.selected : 'transparent',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint, boxShadow: `0 0 6px 1px ${tint}` }} />
                        <Txt size={12} tone={sel ? 'ivory' : 'secondary'} numberOfLines={1} style={{ lineHeight: 15, fontVariant: ['tabular-nums'] }}>
                          {`${formatKelvin(k)} K`}
                        </Txt>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
            <ScopeNote lights={lights} />
          </View>
        )}

        {room && lights.length > 0 && (
          <View style={{ marginTop: 18, flexShrink: 1 }}>
            <Label tone="label">Lights</Label>
            <ScrollView style={{ marginTop: 4, flexGrow: 0 }}>
              {lights.map((l) => (
                <LightLink key={l.id} light={l} />
              ))}
            </ScrollView>
          </View>
        )}
        {room && !lights.length && (
          <Txt tone="secondary" style={{ marginTop: 18 }}>
            Place lights in this room from the map editor or a scan.
          </Txt>
        )}
      </Animated.View>
    </View>
  );
}

/** Says which lights the color and white rows reach: "Color for the 3 color lights, not the plug." */
function ScopeNote({ lights }: { lights: Light[] }) {
  const colors = lights.filter((l) => l.kind === 'color').length;
  const whites = lights.filter((l) => l.kind !== 'color' && hasTemperature(l)).length;
  const plugs = lights.filter((l) => l.kind === 'onoff').length;
  const plain = lights.length - colors - whites - plugs;
  if (colors === lights.length) return null;
  const the = (k: number, one: string) => (k === 1 ? `the ${one}` : `the ${k} ${one}s`);
  const reach = colors ? `Color for ${the(colors, 'color light')}${whites ? `, white also for ${the(whites, 'white light')}` : ''}` : `For ${the(whites, 'white light')}`;
  const skipped = [plugs && the(plugs, 'plug'), plain && the(plain, 'dimmable light')].filter(Boolean).join(' and ');
  return (
    <Txt size={12} tone="muted" style={{ marginLeft: 58, marginTop: 2 }}>
      {`${reach}${skipped ? `, not ${skipped}` : ''}.`}
    </Txt>
  );
}

function LightLink({ light }: { light: Light }) {
  const on = isLit(light);
  const level = lightLevel(light);
  return (
    <Pressable
      onPress={() => router.push(`/light/${light.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${light.name}, ${level}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, borderTopWidth: 1, borderTopColor: hairline(0.08), opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Jewel light={light} shape={lightShape(light.archetype)} ground={color.sheet} />
      </View>
      <Txt size={14} numberOfLines={1} style={{ flex: 1, lineHeight: 18 }}>
        {light.name}
      </Txt>
      <Txt size={13} tone={on ? 'secondary' : 'muted'} style={[{ fontVariant: ['tabular-nums'] }, !light.reachable && { color: color.warning }]}>
        {level}
      </Txt>
      <Icon name="chevronRight" size={14} tint={color.muted} stroke={1.6} />
    </Pressable>
  );
}
