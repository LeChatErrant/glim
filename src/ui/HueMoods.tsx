import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { effectLabel } from '../lib/effects';
import type { BridgeScene, Snapshot } from '../lib/hue/client';
import { hueMoodPlace, hueMoods, keepAsMood, sceneMarkColors, sceneMoodLights } from '../lib/hueMoods';
import { suggestGlyph } from '../lib/moodMarks';
import { moodLightColor, type Mood, type MoodLight } from '../lib/moods';
import { colorName, kelvinName } from '../lib/palette';
import { PillButton } from './controls';
import { Icon } from './icons';
import { ColorDot } from './LightControls';
import { MoodMark } from './MoodMark';
import { Display, Label, Txt } from './text';
import { color, hairline } from './theme';

/**
 * Moods from the Hue app (scenes stored on the bridge): a group on the Moods tab, and pills after
 * a room's own moods on its sheet. Tap applies (the bridge recalls it); "Keep as my mood" copies
 * it into a Glim mood, light by light, so it can be edited. Never called "scenes" on screen.
 */

const confirmKeep = (scene: BridgeScene, place: string, onKept: (moods: Mood[]) => void) =>
  Alert.alert(scene.name, `From the Hue app, for ${place}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Keep as my mood', onPress: () => keepAsMood(scene).then(onKept) },
  ]);

/** The Moods tab's "From the Hue app" group: a card per mood, by room or group. */
export function HueMoodsSection({ snapshot, onApply, onKept }: { snapshot: Snapshot | null; onApply: (scene: BridgeScene) => void; onKept: (moods: Mood[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = hueMoods(snapshot);
  if (!list.length) return null;
  return (
    <View style={{ marginTop: 32, gap: 10 }}>
      <Label tone="label">From the Hue app</Label>
      {list.map((sc) => (
        <HueMoodCard
          key={sc.id}
          scene={sc}
          snapshot={snapshot}
          expanded={open === sc.id}
          onApply={() => onApply(sc)}
          onExpand={() => setOpen(open === sc.id ? null : sc.id)}
          onKept={(moods) => {
            setOpen(null);
            onKept(moods);
          }}
        />
      ))}
      <Txt size={12} tone="muted" style={{ marginTop: 4 }}>
        Moods you made in the Hue app. Keep one as your own mood to change it here.
      </Txt>
    </View>
  );
}

function HueMoodCard({
  scene,
  snapshot,
  expanded,
  onApply,
  onExpand,
  onKept,
}: {
  scene: BridgeScene;
  snapshot: Snapshot | null;
  expanded: boolean;
  onApply: () => void;
  onExpand: () => void;
  onKept: (moods: Mood[]) => void;
}) {
  const place = hueMoodPlace(snapshot, scene);
  const showing = scene.active !== 'inactive';
  const kind = scene.living ? 'Living mood' : place;
  return (
    <View style={{ borderRadius: 22, borderWidth: 1, borderColor: hairline(expanded ? 0.14 : 0.1), backgroundColor: color.card, paddingVertical: 10, paddingLeft: 14, paddingRight: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        <Pressable
          onPress={onApply}
          onLongPress={() => confirmKeep(scene, place, onKept)}
          accessibilityRole="button"
          accessibilityLabel={`Apply ${scene.name}, ${place}, from the Hue app`}
          accessibilityHint="Long-press to keep it as your own mood"
          style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.6 : 1 })}
        >
          <MoodMark colors={sceneMarkColors(scene)} glyph={suggestGlyph(scene.name)} size={38} />
          <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
            <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 20 }}>
              {scene.name}
            </Display>
            <Label size={9} tone={showing ? 'champagne' : 'muted'} numberOfLines={1}>
              {showing ? `${scene.living ? 'Playing' : 'Showing'} · ${place}` : scene.living ? `${kind} · ${place}` : `${place} · tap to apply`}
            </Label>
          </View>
        </Pressable>
        <Pressable
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${expanded ? 'Hide' : 'Show'} the lights of ${scene.name}`}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        >
          <Icon name="chevronDown" size={14} tint={expanded ? color.champagne : color.muted} stroke={1.6} />
        </Pressable>
      </View>
      {expanded && (
        <>
          {sceneMoodLights(scene).map((m) => (
            <LightRow key={m.lightId} m={m} name={snapshot?.lights.find((l) => l.id === m.lightId)?.name ?? 'Removed light'} />
          ))}
          {scene.living && (
            <Txt size={12} tone="muted" style={{ paddingVertical: 8 }}>
              Plays slowly through its colors. As your own mood, it keeps the colors above, still.
            </Txt>
          )}
          <PillButton title="Keep as my mood" icon="add" kind="text" height={40} onPress={() => keepAsMood(scene).then(onKept)} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
        </>
      )}
    </View>
  );
}

function LightRow({ m, name }: { m: MoodLight; name: string }) {
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
    </View>
  );
}

/** A mood from the Hue app as a pill on a room or group sheet: tap applies, long-press keeps it as my mood. */
export function HueMoodPill({ scene, place, onPress, onKept }: { scene: BridgeScene; place: string; onPress: () => void; onKept: (moods: Mood[]) => void }) {
  const showing = scene.active !== 'inactive';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => confirmKeep(scene, place, onKept)}
      accessibilityRole="button"
      accessibilityLabel={`Mood ${scene.name}, from the Hue app`}
      accessibilityHint="Long-press to keep it as your own mood"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        height: 40,
        paddingLeft: 8,
        paddingRight: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: showing ? color.champagne : hairline(0.16),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <MoodMark colors={sceneMarkColors(scene)} glyph={suggestGlyph(scene.name)} size={24} />
      <Txt size={13} tone={showing ? 'champagne' : 'ivory'} numberOfLines={1} style={{ lineHeight: 17, maxWidth: 160 }}>
        {scene.name}
      </Txt>
    </Pressable>
  );
}
