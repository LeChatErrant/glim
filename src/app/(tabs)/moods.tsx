import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { effectLabel } from '../../lib/effects';
import { mirekToHex } from '../../lib/hue/color';
import type { Snapshot } from '../../lib/hue/client';
import { useHome } from '../../lib/hue/useHome';
import { planScene } from '../../lib/hueMoods';
import { loadMap, type HomeMap } from '../../lib/map/map';
import { PRESET_CATEGORIES, PRESETS, presetLights, type Preset } from '../../lib/moodPresets';
import {
  addMood,
  captureLights,
  deleteMood,
  isMapAware,
  loadMoods,
  moodLightColor,
  PATH_TONES,
  pathLights,
  planLights,
  planMood,
  recipeLights,
  suggestName,
  updateMood,
  type Mood,
  type MapRecipe,
  type MoodLight,
  type PathRecipe,
} from '../../lib/moods';
import { addFavorite, colorName, kelvinName } from '../../lib/palette';
import { PillButton } from '../../ui/controls';
import { Icon } from '../../ui/icons';
import { HueMoodsSection } from '../../ui/HueMoods';
import { ColorDot } from '../../ui/LightControls';
import { KIND_TITLES, MapMoodSheet, type MapMoodKind } from '../../ui/MapMoodSheet';
import { MoodDots } from '../../ui/MoodChips';
import { MoodMap } from '../../ui/MoodMap';
import { PathPreview, PathSheet } from '../../ui/PathSheet';
import { Choice } from '../../ui/scan/parts';
import { Display, Label, Txt } from '../../ui/text';
import { color, hairline, TAB_BAR_SPACE } from '../../ui/theme';

/**
 * Moods: the user's own (by room and group), paths (map-aware moods: a dim trail from one room to
 * another), and the preset library, applied to the whole home or a room or group picked under
 * "For". Tap applies; open a mood to see each light's color and keep one as a favorite; long-press
 * a preset to keep it as your own mood.
 */
export default function MoodsScreen() {
  const insets = useSafeAreaInsets();
  const { snapshot, act } = useHome();
  const [moods, setMoods] = useState<Mood[]>([]);
  const [map, setMap] = useState<HomeMap | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [presetTarget, setPresetTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ mood?: Mood; kind: 'path' | MapMoodKind } | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadMoods().then(setMoods);
      loadMap().then(setMap);
    }, []),
  );

  const apply = (m: Mood) => {
    act((s) => planMood(s, m, map));
    setApplied(m.id);
  };

  const targetName = (id: string | null) =>
    id === null ? 'Whole home' : (snapshot?.rooms.find((r) => r.id === id)?.name ?? snapshot?.zones?.find((z) => z.id === id)?.name ?? 'Removed room');
  const own = moods.filter((m) => !isMapAware(m));
  const mapMoods = moods.filter(isMapAware);
  const targets = [...new Set(own.map((m) => m.targetId))];
  const hasMap = !!map?.rooms.some((r) => r.points.length >= 3);

  // Presets go to the lights of the room or group picked under "For" (or the whole home).
  const presetLightsFor = (s: Snapshot, p: Preset): MoodLight[] => {
    const group = presetTarget && (s.rooms.find((r) => r.id === presetTarget) ?? s.zones?.find((z) => z.id === presetTarget));
    const lights = group ? s.lights.filter((l) => group.lightIds.includes(l.id)) : s.lights;
    return presetLights(p, lights, map);
  };
  const applyPreset = (p: Preset) => {
    act((s) => planLights(s, presetLightsFor(s, p)));
    setApplied(`preset:${p.id}`);
  };
  const keepPreset = (p: Preset) =>
    Alert.alert(p.name, presetTarget === null ? 'For the whole home' : `For ${targetName(presetTarget)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Keep as my mood',
        onPress: () => snapshot && addMood({ name: p.name, targetId: presetTarget, lights: presetLightsFor(snapshot, p) }).then(setMoods),
      },
    ]);

  const savePath = (name: string, path: PathRecipe) => {
    const m = editing?.mood;
    (m ? updateMood(m.id, { name, path }) : addMood({ name, targetId: null, lights: [], path })).then(setMoods);
    setEditing(null);
  };
  const saveRecipe = (name: string, recipe: MapRecipe) => {
    const m = editing?.mood;
    (m ? updateMood(m.id, { name, recipe }) : addMood({ name, targetId: null, lights: [], recipe })).then(setMoods);
    setEditing(null);
  };
  const deleteEditing = editing?.mood
    ? () => {
        const m = editing.mood!;
        setEditing(null);
        deleteMood(m.id).then(setMoods);
      }
    : undefined;
  const editMood = (m: Mood) => setEditing({ mood: m, kind: m.recipe?.kind ?? 'path' });

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + TAB_BAR_SPACE + 32 }}>
      <Display>Moods</Display>
      <Txt size={14} tone="secondary" style={{ marginTop: 6 }}>
        A look for your lights, light by light. Start from a preset, save your own from a room or a group, or shape one on your map.
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

      {targets.map((t) => (
        <View key={t ?? 'home'} style={{ marginTop: 26, gap: 10 }}>
          <Label tone="label">{targetName(t)}</Label>
          {own
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

      <HueMoodsSection snapshot={snapshot} onApply={(sc) => act((s) => planScene(s, sc))} onKept={setMoods} />

      <View style={{ marginTop: 32, gap: 10 }}>
        <Label tone="label">On your map</Label>
        {map &&
          mapMoods.map((m) =>
            m.path ? (
              <PathCard key={m.id} mood={m} map={map} snapshot={snapshot} applied={applied === m.id} onApply={() => apply(m)} onEdit={() => editMood(m)} />
            ) : (
              <RecipeCard key={m.id} mood={m} map={map} snapshot={snapshot} applied={applied === m.id} onApply={() => apply(m)} onEdit={() => editMood(m)} />
            ),
          )}
        {hasMap ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <DashedButton title="Night path" onPress={() => setEditing({ kind: 'path' })} />
            {(['sweep', 'spot', 'glow'] as const).map((k) => (
              <DashedButton key={k} title={KIND_TITLES[k]} onPress={() => setEditing({ kind: k })} />
            ))}
          </View>
        ) : (
          <Txt size={13} tone="muted">
            Moods that use where your lights are: a path lighting the way from one room to another, a gradient across the home, a spotlight, a color per room. Scan or draw your home on the Map tab first.
          </Txt>
        )}
      </View>

      <View style={{ marginTop: 32, gap: 12 }}>
        <Label tone="label">Presets</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center', paddingRight: 8 }}>
          <Label size={9}>For</Label>
          <Choice label="Whole home" chosen={presetTarget === null} onPress={() => setPresetTarget(null)} />
          {[...(snapshot?.rooms ?? []), ...(snapshot?.zones ?? [])]
            .filter((g) => g.lightIds.length)
            .map((g) => (
              <Choice key={g.id} label={g.name} chosen={presetTarget === g.id} onPress={() => setPresetTarget(g.id)} />
            ))}
        </ScrollView>
        {PRESET_CATEGORIES.map((c) => (
          <View key={c} style={{ gap: 8, marginTop: 6 }}>
            <Label size={9}>{c}</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PRESETS.filter((p) => p.category === c).map((p) => (
                <PresetPill key={p.id} preset={p} applied={applied === `preset:${p.id}`} onPress={() => applyPreset(p)} onLongPress={() => keepPreset(p)} />
              ))}
            </View>
          </View>
        ))}
        <Txt size={12} tone="muted" style={{ marginTop: 4 }}>
          Long-press a preset to keep it as your own mood. Smart plugs stay as they are.
        </Txt>
      </View>

      {editing && map && editing.kind !== 'path' && (
        <MapMoodSheet
          kind={editing.kind}
          map={map}
          snapshot={snapshot}
          initial={editing.mood?.recipe && { name: editing.mood.name, recipe: editing.mood.recipe }}
          onSend={(lights) => act((s) => planLights(s, lights))}
          onSave={saveRecipe}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && map && editing.kind === 'path' && (
        <PathSheet
          map={map}
          snapshot={snapshot}
          initial={editing.mood?.path && { name: editing.mood.name, path: editing.mood.path }}
          onTry={(path) => act((s) => planLights(s, pathLights(s, path, map) ?? []))}
          onSave={savePath}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
        />
      )}
    </ScrollView>
  );
}

/** A path: its route on a tiny map, its name; tap lights the way, the pencil edits it. */
function PathCard({
  mood,
  map,
  snapshot,
  applied,
  onApply,
  onEdit,
}: {
  mood: Mood;
  map: HomeMap;
  snapshot: Snapshot | null;
  applied: boolean;
  onApply: () => void;
  onEdit: () => void;
}) {
  const path = mood.path!;
  const lit = snapshot ? (pathLights(snapshot, path, map) ?? []).filter((m) => m.on).map((m) => m.lightId) : [];
  const tint = (PATH_TONES.find((t) => t.id === path.tone) ?? PATH_TONES[0]).hex;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: hairline(0.1), backgroundColor: color.card, padding: 8, paddingLeft: 10 }}>
      <Pressable
        onPress={onApply}
        onLongPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Light the path ${mood.name}`}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.6 : 1 })}
      >
        <PathPreview map={map} path={path} lit={lit} tint={tint} width={76} height={56} focus />
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 20 }}>
            {mood.name}
          </Display>
          <Label size={9} tone={applied ? 'champagne' : 'muted'}>
            {applied ? 'Lit' : lit.length ? `${lit.length} ${lit.length === 1 ? 'light' : 'lights'} · ${path.brightness}% · tap to light` : 'No light on the way'}
          </Label>
        </View>
      </Pressable>
      <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${mood.name}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="edit" size={15} tint={color.muted} stroke={1.6} />
      </Pressable>
    </View>
  );
}

/** The map points a recipe's small preview frames: the rooms it covers, the spotlight's circle. */
function recipeFrame(map: HomeMap, r: MapRecipe) {
  if (r.kind === 'spot') return [-1, 1].flatMap((dx) => [-1, 1].map((dz) => ({ x: r.at.x + dx * r.radius, z: r.at.z + dz * r.radius })));
  const ids = r.kind === 'sweep' ? r.rooms : r.rooms.map((x) => x.id);
  return ids ? map.rooms.filter((m) => ids.includes(m.id)).flatMap((m) => m.points) : undefined;
}

/** A gradient sweep, spotlight or room glow: its look on a tiny map, its name; tap applies, the pencil edits it. */
function RecipeCard({
  mood,
  map,
  snapshot,
  applied,
  onApply,
  onEdit,
}: {
  mood: Mood;
  map: HomeMap;
  snapshot: Snapshot | null;
  applied: boolean;
  onApply: () => void;
  onEdit: () => void;
}) {
  const recipe = mood.recipe!;
  const lights = snapshot ? (recipeLights(snapshot, recipe, map) ?? []) : [];
  const lit = lights.filter((m) => m.on).length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: hairline(0.1), backgroundColor: color.card, padding: 8, paddingLeft: 10 }}>
      <Pressable
        onPress={onApply}
        onLongPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Apply ${mood.name}`}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.6 : 1 })}
      >
        <MoodMap map={map} recipe={recipe} lights={lights} width={76} height={56} frame={recipeFrame(map, recipe)} />
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 20 }}>
            {mood.name}
          </Display>
          <Label size={9} tone={applied ? 'champagne' : 'muted'} numberOfLines={1}>
            {applied ? 'Applied' : lit ? `${KIND_TITLES[recipe.kind]} · ${lit} ${lit === 1 ? 'light' : 'lights'} · tap to apply` : `${KIND_TITLES[recipe.kind]} · no light`}
          </Label>
        </View>
      </Pressable>
      <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${mood.name}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="edit" size={15} tint={color.muted} stroke={1.6} />
      </Pressable>
    </View>
  );
}

/** A preset as a pill: a dot per color and the name; champagne edge once applied. */
function PresetPill({ preset, applied, onPress, onLongPress }: { preset: Preset; applied: boolean; onPress: () => void; onLongPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Preset ${preset.name}`}
      accessibilityHint="Long-press to keep it as your own mood"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: applied ? color.champagne : hairline(0.16),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {preset.tones.slice(0, 4).map((t, i) => {
          const c = t.hex ?? mirekToHex(1_000_000 / (t.kelvin ?? 2700));
          return <View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c, boxShadow: `0 0 7px 1px ${c}88` }} />;
        })}
      </View>
      <Txt size={13} tone={applied ? 'champagne' : 'ivory'} style={{ lineHeight: 17 }}>
        {preset.name}
      </Txt>
    </Pressable>
  );
}

function DashedButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 44,
        paddingHorizontal: 16,
        alignSelf: 'flex-start',
        borderRadius: 22,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: hairline(0.35),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="add" size={14} tint={color.secondary} />
      <Txt size={13} tone="secondary" style={{ lineHeight: 17 }}>
        {title}
      </Txt>
    </Pressable>
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
