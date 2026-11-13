import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import type { BridgeScene, Light } from '../lib/hue/client';
import { addMood, captureLights, deleteMood, moodLightColor, suggestName, updateMood, type Mood } from '../lib/moods';
import { PillButton } from './controls';
import { HueMoodPill } from './HueMoods';
import { Icon } from './icons';
import { Field, ModalSheet } from './ModalSheet';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

/** A mood as a pill: a dot per light (its color, hollow when off) and the name. */
export function MoodPill({ mood, onPress, onLongPress }: { mood: Mood; onPress: () => void; onLongPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Mood ${mood.name}`}
      accessibilityHint={onLongPress ? 'Long-press for options' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: hairline(0.16),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <MoodDots mood={mood} />
      <Txt size={13} numberOfLines={1} style={{ lineHeight: 17, maxWidth: 160 }}>
        {mood.name}
      </Txt>
    </Pressable>
  );
}

export function MoodDots({ mood, size = 8 }: { mood: Mood; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: size * 0.6 }}>
      {mood.lights.slice(0, 6).map((m) => {
        const c = moodLightColor(m) ?? (m.on ? color.champagne : null);
        return (
          <View
            key={m.lightId}
            style={
              c
                ? { width: size, height: size, borderRadius: size / 2, backgroundColor: c, boxShadow: `0 0 ${size}px 1px ${c}88` }
                : { width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: hairline(0.45) }
            }
          />
        );
      })}
    </View>
  );
}

/**
 * The moods of a room or a group: tap to apply, long-press to update, rename or delete, and
 * "Save" keeps the lights as they are now (one red, one blue...) as a new mood. Its moods from the
 * Hue app (bridge scenes) follow; long-press one to keep it as my mood.
 */
export function MoodChips({
  targetId,
  lights,
  moods,
  onChange,
  onApply,
  hueMoods = [],
  place = '',
  onApplyHue,
}: {
  targetId: string;
  /** The lights of the room or group, as they are now. */
  lights: Light[];
  moods: Mood[];
  onChange: (moods: Mood[]) => void;
  onApply: (m: Mood) => void;
  /** Its moods from the Hue app. */
  hueMoods?: BridgeScene[];
  /** The room or group's name. */
  place?: string;
  onApplyHue?: (scene: BridgeScene) => void;
}) {
  const [naming, setNaming] = useState<{ mood?: Mood; name: string } | null>(null);
  const mine = moods.filter((m) => m.targetId === targetId);

  const options = (m: Mood) =>
    Alert.alert(m.name, undefined, [
      { text: 'Update with current lights', onPress: () => updateMood(m.id, { lights: captureLights(lights) }).then(onChange) },
      { text: 'Rename', onPress: () => setNaming({ mood: m, name: m.name }) },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMood(m.id).then(onChange) },
    ], { cancelable: true });

  const save = () => {
    if (!naming) return;
    const name = naming.name.trim() || suggestName(captureLights(lights));
    (naming.mood ? updateMood(naming.mood.id, { name }) : addMood({ name, targetId, lights: captureLights(lights) })).then(onChange);
    setNaming(null);
  };

  return (
    <View style={{ gap: 10 }}>
      <Label>Moods</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center', paddingRight: 8 }}>
        <Pressable
          onPress={() => setNaming({ name: suggestName(captureLights(lights)) })}
          disabled={!lights.length}
          accessibilityRole="button"
          accessibilityLabel="Save how these lights look now as a mood"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 40,
            paddingHorizontal: 14,
            borderRadius: 20,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: hairline(0.35),
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="add" size={14} tint={color.secondary} />
          <Txt size={13} tone="secondary" style={{ lineHeight: 17 }}>
            Save current look
          </Txt>
        </Pressable>
        {mine.map((m) => (
          <MoodPill key={m.id} mood={m} onPress={() => onApply(m)} onLongPress={() => options(m)} />
        ))}
        {hueMoods.map((sc) => (
          <HueMoodPill key={sc.id} scene={sc} place={place} onPress={() => onApplyHue?.(sc)} onKept={onChange} />
        ))}
      </ScrollView>
      {naming && (
        <ModalSheet visible title={naming.mood ? 'Rename mood' : 'New mood'} onClose={() => setNaming(null)}>
          {!naming.mood && (
            <Txt size={13} tone="secondary">
              Keeps every light as it is now: on or off, its color or white, its brightness.
            </Txt>
          )}
          <Field label="Name" value={naming.name} onChange={(name) => setNaming({ ...naming, name })} />
          <PillButton title="Save" kind="primary" onPress={save} />
        </ModalSheet>
      )}
    </View>
  );
}
