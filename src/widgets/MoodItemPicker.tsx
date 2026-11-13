import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { Snapshot } from '../lib/hue/client';
import { hueMoodPlace, hueMoods } from '../lib/hueMoods';
import { PRESET_CATEGORIES, PRESETS } from '../lib/moodPresets';
import { isMapAware, type Mood } from '../lib/moods';
import type { BridgeRitual } from '../lib/rituals/rituals';
import { ensureSleepPool } from '../lib/rituals/sleepNow';
import { Choice } from '../ui/scan/parts';
import { Label } from '../ui/text';
import { itemKey, sleepItems, type MoodItem, type SleepItem } from './moodButtons';

/**
 * Picks a widget's mood buttons, in the order tapped (numbered chips), up to `max`: my moods, the
 * ones on the map, moods from the Hue app, presets, sleep fades and All off. Shared by the Moods
 * widget and the Map widget's mood strip.
 */
export function MoodItemPicker({
  items,
  onChange,
  max,
  moods,
  snapshot,
  rituals,
  off = true,
}: {
  items: MoodItem[];
  onChange: (items: MoodItem[]) => void;
  max: number;
  moods: Mood[];
  snapshot: Snapshot | null;
  /** The Rituals tab's sleep fades, offered as buttons. */
  rituals: BridgeRitual[];
  /** Offer "All off" (the Map widget has its own). */
  off?: boolean;
}) {
  const keys = items.map(itemKey);
  const toggle = (i: MoodItem) => {
    const k = itemKey(i);
    if (keys.includes(k)) onChange(items.filter((x) => itemKey(x) !== k));
    else if (items.length < max) onChange([...items, i]);
  };
  const chip = (i: MoodItem, label: string) => {
    const at = keys.indexOf(itemKey(i));
    return <Choice key={itemKey(i)} label={at >= 0 ? `${at + 1} · ${label}` : label} chosen={at >= 0} onPress={() => toggle(i)} />;
  };
  const own = moods.filter((m) => !isMapAware(m));
  const onMap = moods.filter(isMapAware);
  const fromHue = hueMoods(snapshot);
  const sleeps = snapshot ? sleepItems(snapshot, rituals) : [];
  // A sleep fade picked before and changed since in the Rituals tab stays listed as picked.
  const sleepChoices = [...items.filter((i): i is SleepItem => i.kind === 'sleep' && !sleeps.some((x) => itemKey(x) === itemKey(i))), ...sleeps];

  return (
    <>
      {!!own.length && <Group title="My moods">{own.map((m) => chip({ kind: 'mood', id: m.id }, m.name))}</Group>}
      {!!onMap.length && <Group title="On your map">{onMap.map((m) => chip({ kind: 'mood', id: m.id }, m.name))}</Group>}
      {!!fromHue.length && (
        <Group title="From the Hue app">{fromHue.map((sc) => chip({ kind: 'scene', id: sc.id }, `${sc.name} · ${hueMoodPlace(snapshot, sc)}`))}</Group>
      )}
      {PRESET_CATEGORIES.map((c) => (
        <Group key={c} title={c}>
          {PRESETS.filter((p) => p.category === c).map((p) => chip({ kind: 'preset', id: p.id }, p.name))}
        </Group>
      ))}
      {!!sleepChoices.length && <Group title="Sleep fade">{sleepChoices.map((i) => chip(i, `${i.name} · ${i.fadeMin} min`))}</Group>}
      {off && <Group title="Other">{chip({ kind: 'off' }, 'All off')}</Group>}
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Label tone="label">{title}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

/** Before saving mood buttons: a sleep fade button needs what its tap changes on the bridge (made once). */
export async function prepareMoodItems(snapshot: Snapshot | null, items: MoodItem[]) {
  const targets = items.flatMap((i) => (i.kind === 'sleep' ? i.targets : []));
  if (snapshot && targets.length) await ensureSleepPool(snapshot, targets).catch(() => null);
}
