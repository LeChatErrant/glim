import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { effectLabel } from '../../lib/effects';
import type { Snapshot } from '../../lib/hue/client';
import { useHome } from '../../lib/hue/useHome';
import { addMood, captureLights, deleteMood, loadMoods, moodLightColor, planMood, suggestName, type Mood, type MoodLight } from '../../lib/moods';
import { addFavorite, colorName, kelvinName } from '../../lib/palette';
import { PillButton } from '../../ui/controls';
import { Icon } from '../../ui/icons';
import { ColorDot } from '../../ui/LightControls';
import { MoodDots } from '../../ui/MoodChips';
import { Display, Label, Txt } from '../../ui/text';
import { color, hairline, TAB_BAR_SPACE } from '../../ui/theme';

/**
 * Every saved mood, by room and group. Tap applies it; open one to see each light's color and keep
 * one as a favorite. Moods are saved from a room or group sheet ("Save current look"), or here for the
 * whole home.
 */
export default function MoodsScreen() {
  const insets = useSafeAreaInsets();
  const { snapshot, act } = useHome();
  const [moods, setMoods] = useState<Mood[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadMoods().then(setMoods);
    }, []),
  );

  const apply = (m: Mood) => {
    act((s) => planMood(s, m));
    setApplied(m.id);
  };

  const targetName = (id: string | null) =>
    id === null ? 'Whole home' : (snapshot?.rooms.find((r) => r.id === id)?.name ?? snapshot?.zones?.find((z) => z.id === id)?.name ?? 'Removed room');
  const targets = [...new Set(moods.map((m) => m.targetId))];

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + TAB_BAR_SPACE + 32 }}>
      <Display>Moods</Display>
      <Txt size={14} tone="secondary" style={{ marginTop: 6 }}>
        A look for your lights, light by light. Save one from a room or a group, or for the whole home.
      </Txt>
      <PillButton
        title="Save the whole home as a mood"
        icon="add"
        height={44}
        disabled={!snapshot?.lights.length}
        style={{ marginTop: 18, alignSelf: 'flex-start' }}
        onPress={() => {
          if (!snapshot) return;
          const lights = captureLights(snapshot.lights);
          addMood({ name: suggestName(lights), targetId: null, lights }).then(setMoods);
        }}
      />

      {!moods.length && (
        <View style={{ marginTop: 40, gap: 10 }}>
          <Label tone="label">No moods yet</Label>
          <Txt tone="secondary">Open a room or a group, set its lights the way you like, then tap “Save current look”.</Txt>
        </View>
      )}

      {targets.map((t) => (
        <View key={t ?? 'home'} style={{ marginTop: 26, gap: 10 }}>
          <Label tone="label">{targetName(t)}</Label>
          {moods
            .filter((m) => m.targetId === t)
            .map((m) => (
              <MoodCard
                key={m.id}
                mood={m}
                snapshot={snapshot}
                expanded={open === m.id}
                applied={applied === m.id}
                onApply={() => apply(m)}
                onExpand={() => setOpen(open === m.id ? null : m.id)}
                onDelete={() =>
                  Alert.alert(`Delete ${m.name}?`, undefined, [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteMood(m.id).then(setMoods) },
                  ])
                }
              />
            ))}
        </View>
      ))}
    </ScrollView>
  );
}

function MoodCard({
  mood,
  snapshot,
  expanded,
  applied,
  onApply,
  onExpand,
  onDelete,
}: {
  mood: Mood;
  snapshot: Snapshot | null;
  expanded: boolean;
  applied: boolean;
  onApply: () => void;
  onExpand: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={{ borderRadius: 22, borderWidth: 1, borderColor: hairline(expanded ? 0.14 : 0.1), backgroundColor: color.card, paddingVertical: 10, paddingLeft: 18, paddingRight: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        <Pressable onPress={onApply} accessibilityRole="button" accessibilityLabel={`Apply ${mood.name}`} style={({ pressed }) => ({ flex: 1, minWidth: 0, gap: 7, opacity: pressed ? 0.6 : 1 })}>
          <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 20 }}>
            {mood.name}
          </Display>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MoodDots mood={mood} size={7} />
            <Label size={9} tone={applied ? 'champagne' : 'muted'}>
              {applied ? 'Applied' : `${mood.lights.length} ${mood.lights.length === 1 ? 'light' : 'lights'} · tap to apply`}
            </Label>
          </View>
        </Pressable>
        <Pressable
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${expanded ? 'Hide' : 'Show'} the lights of ${mood.name}`}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        >
          <Icon name="chevronDown" size={14} tint={expanded ? color.champagne : color.muted} stroke={1.6} />
        </Pressable>
      </View>
      {expanded && (
        <>
          {mood.lights.map((m) => (
            <MoodLightRow key={m.lightId} m={m} name={snapshot?.lights.find((l) => l.id === m.lightId)?.name ?? 'Removed light'} />
          ))}
          <PillButton title="Delete mood" kind="text" height={40} onPress={onDelete} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
        </>
      )}
    </View>
  );
}

/** One light of a mood: its color, and a star to keep that color as a favorite. */
function MoodLightRow({ m, name }: { m: MoodLight; name: string }) {
  const [kept, setKept] = useState(false);
  const c = moodLightColor(m);
  const what = !m.on ? 'Off' : m.effect ? (effectLabel(m.effect) ?? 'Effect') : m.hex ? colorName(m.hex) : m.kelvin ? kelvinName(m.kelvin) : 'On';
  const level = m.on && m.brightness !== undefined ? ` · ${m.brightness}%` : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, borderTopWidth: 1, borderTopColor: hairline(0.08) }}>
      {c ? <ColorDot hex={c} size={24} ground={color.card} /> : <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: hairline(0.35) }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={14} numberOfLines={1} style={{ lineHeight: 18 }}>
          {name}
        </Txt>
        <Txt size={12} tone="muted" style={{ lineHeight: 16 }}>
          {what + level}
        </Txt>
      </View>
      {c && !m.effect && (
        <Pressable
          onPress={() => {
            addFavorite({ hex: m.hex, kelvin: m.kelvin }).then(() => setKept(true));
          }}
          accessibilityRole="button"
          accessibilityLabel={`Keep ${what} as a favorite color`}
          style={({ pressed }) => ({ height: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name="star" size={14} tint={kept ? color.champagne : color.secondary} />
          <Label size={9} tone={kept ? 'champagne' : 'secondary'}>
            {kept ? 'Saved' : 'Favorite'}
          </Label>
        </Pressable>
      )}
    </View>
  );
}
