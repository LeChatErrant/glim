import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { EFFECTS } from '../lib/effects';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

function Swatch({ id, size, on }: { id: string; size: number; on: boolean }) {
  const e = EFFECTS.find((x) => x.id === id);
  if (!e) return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: hairline(0.35) }} />;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={`fx-${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={e.swatch[0]} />
            <Stop offset="1" stopColor={e.swatch[1]} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#fx-${id})`} opacity={on ? 1 : 0.7} />
      </Svg>
    </View>
  );
}

/** The effects a light supports, as tiles (light screen): tap one to start it, "None" stops it. */
export function EffectGrid({ supported, current, onPick, width }: { supported: string[]; current?: string; onPick: (id: string) => void; width: number }) {
  const list = EFFECTS.filter((e) => supported.includes(e.id));
  const cols = 4;
  const tile = Math.floor((width - (cols - 1) * 8) / cols);
  const running = list.some((e) => e.id === current);
  return (
    <View style={{ width, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {[{ id: 'no_effect', label: 'None', hint: 'No effect' }, ...list].map((e) => {
        const sel = e.id === 'no_effect' ? !running : e.id === current;
        return (
          <Pressable
            key={e.id}
            onPress={() => onPick(e.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            accessibilityLabel={`${e.label}. ${e.hint}`}
            style={({ pressed }) => ({
              width: tile,
              height: 78,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: sel ? color.champagne : hairline(0.12),
              backgroundColor: sel ? color.selected : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Swatch id={e.id} size={26} on={sel} />
            <Txt size={11} tone={sel ? 'ivory' : 'secondary'} numberOfLines={1} style={{ lineHeight: 14 }}>
              {e.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Effects as a row of chips (room sheet): the effect runs on every light that has it. */
export function EffectRow({ current, onPick, labelWidth = 58 }: { current?: string; onPick: (id: string) => void; labelWidth?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Label tone="label" style={{ width: labelWidth }}>
        Effect
      </Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }} style={{ flex: 1 }}>
        {[{ id: 'no_effect', label: 'None' }, ...EFFECTS].map((e) => {
          const sel = e.id === 'no_effect' ? !current : e.id === current;
          return (
            <Pressable
              key={e.id}
              onPress={() => onPick(e.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: sel }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                height: 40,
                paddingHorizontal: 12,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: sel ? color.champagne : hairline(0.16),
                backgroundColor: sel ? color.selected : 'transparent',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              {e.id !== 'no_effect' && <Swatch id={e.id} size={12} on={sel} />}
              <Txt size={12} tone={sel ? 'ivory' : 'secondary'} style={{ lineHeight: 15 }}>
                {e.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
