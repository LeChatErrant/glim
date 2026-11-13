import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hasTemperature } from '../lib/actions';
import { effectLabel, EFFECTS } from '../lib/effects';
import type { Light, Snapshot } from '../lib/hue/client';
import { hexHueSat, KELVIN_MAX, KELVIN_MIN, kelvinTint, mirekToKelvin } from '../lib/hue/color';
import { useHome } from '../lib/hue/useHome';
import { lightTypeLabel } from '../lib/lights';
import { canLive, LIVING_SPEEDS, livingSpeedLabel, putLiving, removeLiving } from '../lib/living';
import { loadMap, type HomeMap } from '../lib/map/map';
import { roomAt } from '../lib/map/spread';
import { PRESETS, presetLights, type Palette } from '../lib/moodPresets';
import {
  addMood,
  captureLights,
  deleteMood,
  isMapAware,
  loadMoods,
  moodLightColor,
  pathLights,
  planLights,
  planMood,
  suggestName,
  targetLights,
  updateMood,
  type MapRecipe,
  type Mood,
  type MoodLight,
  type PathRecipe,
} from '../lib/moods';
import { colorName, kelvinName, WHITE_PRESETS } from '../lib/palette';
import { tintHex, type Tint } from '../lib/tints';
import { IconButton, PillButton, Slider, Switch } from '../ui/controls';
import { EffectRow } from '../ui/Effects';
import { Icon } from '../ui/icons';
import { Dial, ModeTabs, Orb, ringColor } from '../ui/LightControls';
import { KIND_TITLES, MapMoodSheet, TintPicker, type MapMoodKind } from '../ui/MapMoodSheet';
import { ModalSheet } from '../ui/ModalSheet';
import { MoodMap, type MapTouch } from '../ui/MoodMap';
import { PathSheet } from '../ui/PathSheet';
import { Choice } from '../ui/scan/parts';
import { Display, Label, Txt } from '../ui/text';
import { color, font, hairline } from '../ui/theme';
import { useLivePreview } from '../ui/useLivePreview';

/**
 * The mood editor. A mood is made per light (each light its own on/off, color or white, and
 * brightness, on the map and as a list) or as a palette (1 to 5 colors and a brightness, spread
 * over the lights at each apply); map-aware moods open their own sheets from the third tab.
 * Options: the fade, and living (colors drift, played by the bridge). "Live on your lights"
 * makes the real lights follow the edit and puts them back when switched off or left.
 *
 * Params: `id` edits a mood; otherwise a new one for `target` (a room or group id; none = the
 * whole home), from the lights as they are now, or from a `preset` (palette mode).
 */

type Mode = 'lights' | 'palette' | 'map';
type Draft = {
  name: string;
  /** The name was typed (not the one suggested from the colors). */
  named: boolean;
  targetId: string | null;
  mode: Mode;
  lights: MoodLight[];
  palette: Palette;
  transition?: number;
  living: number | null;
};

const TRANSITIONS: { label: string; ms?: number }[] = [
  { label: 'Instant', ms: 0 },
  { label: 'Quick' },
  { label: '2 s', ms: 2000 },
  { label: '10 s', ms: 10_000 },
  { label: '1 min', ms: 60_000 },
];

const MAX_TONES = 5;
const NEW_TONES = ['#FF7A3D', '#7B3BF5', '#19E6A0', '#FF4F6A', '#00B4FF'];

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/moods'));

/** The colors of some mood lights as a palette (each color or white once, up to 5). */
function paletteFrom(lights: MoodLight[]): Palette {
  const on = lights.filter((m) => m.on && (m.hex || m.kelvin));
  const tones: Tint[] = [];
  for (const m of on) {
    const t = m.hex ? { hex: m.hex } : { kelvin: m.kelvin };
    if (!tones.some((x) => (x.hex && t.hex ? x.hex.toLowerCase() === t.hex.toLowerCase() : x.kelvin === t.kelvin && !x.hex && !t.hex))) tones.push(t);
  }
  const level = on.length ? Math.round(on.reduce((a, m) => a + (m.brightness ?? 100), 0) / on.length) : 70;
  return { tones: tones.length ? tones.slice(0, MAX_TONES) : [{ kelvin: 2700 }], brightness: Math.max(1, level) };
}

const tintOf = (m: MoodLight): Tint | undefined => (m.hex ? { hex: m.hex } : m.kelvin ? { kelvin: m.kelvin } : undefined);
const tintLabel = (t: Tint) => (t.hex ? colorName(t.hex) : kelvinName(t.kelvin ?? 2700));

/** A mood light as the light is now (used when a light joins the mood or is turned on in it). */
function fromLight(l: Light): MoodLight {
  return captureLights([{ ...l, reachable: true }])[0];
}

export default function MoodEditor() {
  const params = useLocalSearchParams<{ id?: string; target?: string; preset?: string }>();
  const insets = useSafeAreaInsets();
  const { snapshot, act } = useHome();
  const [map, setMap] = useState<HomeMap | null | undefined>(undefined);
  const [original, setOriginal] = useState<Mood | null | undefined>(params.id ? undefined : null);
  const [edited, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [mapSheet, setMapSheet] = useState<'path' | MapMoodKind | null>(null);

  useEffect(() => {
    loadMap().then(setMap);
    if (params.id) loadMoods().then((list) => setOriginal(list.find((m) => m.id === params.id) ?? null));
  }, [params.id]);

  const ready = !!snapshot;
  // The first draft, once the mood, the map and the lights are known; edits replace it.
  const initial = useMemo((): Draft | null => {
    if (edited || !snapshot || map === undefined || original === undefined) return null;
    const m = original;
    if (m) {
      return {
        name: m.name,
        named: true,
        targetId: m.targetId,
        mode: isMapAware(m) ? 'map' : m.palette ? 'palette' : 'lights',
        lights: m.lights,
        palette: m.palette ?? paletteFrom(m.lights),
        transition: m.transition,
        living: m.living ? m.living.speed : null,
      };
    }
    const targetId = params.target || null;
    const preset = PRESETS.find((p) => p.id === params.preset);
    const lights = captureLights(targetLights(snapshot, targetId));
    return {
      name: preset?.name ?? suggestName(lights),
      named: !!preset,
      targetId,
      mode: preset ? 'palette' : 'lights',
      lights,
      palette: preset ? { tones: preset.tones, brightness: preset.brightness, effect: preset.effect, white: preset.white } : paletteFrom(lights),
      living: null,
    };
    // Only once: later snapshots (polling) don't reset what was captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edited, ready, map, original, params.target, params.preset]);
  const draft = edited ?? initial;
  // A map-aware mood opens straight in its sheet.
  const sheet = mapSheet ?? (original && isMapAware(original) ? (original.path ? 'path' : original.recipe!.kind) : null);

  const shown = useMemo(() => {
    if (!snapshot || !draft) return [];
    return draft.mode === 'palette' ? presetLights(draft.palette, targetLights(snapshot, draft.targetId), map ?? null) : draft.lights;
  }, [snapshot, draft, map]);
  const preview = useLivePreview(snapshot, draft?.mode === 'map' ? [] : shown);

  if (!snapshot || !draft) return <View style={{ flex: 1, backgroundColor: color.ground }} />;
  if (params.id && !original)
    return (
      <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top + 22, paddingHorizontal: 24, gap: 24 }}>
        <IconButton icon="back" label="Back" onPress={goBack} />
        <Display size={30}>This mood is gone</Display>
      </View>
    );

  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const setLights = (lights: MoodLight[]) => setDraft({ ...draft, lights, ...(draft.named ? {} : { name: suggestName(lights) }) });
  const setPalette = (palette: Palette) => set({ palette });

  const lightsOfTarget = targetLights(snapshot, draft.targetId);
  const targetName =
    draft.targetId === null ? 'Whole home' : (snapshot.rooms.find((r) => r.id === draft.targetId)?.name ?? snapshot.zones?.find((z) => z.id === draft.targetId)?.name ?? 'Removed room');

  const changeTarget = (targetId: string | null) => {
    const now = targetLights(snapshot, targetId);
    const kept = new Map(draft.lights.map((m) => [m.lightId, m]));
    const lights = now.filter((l) => l.reachable).map((l) => kept.get(l.id) ?? fromLight(l));
    setDraft({ ...draft, targetId, lights, ...(draft.named ? {} : { name: suggestName(lights) }) });
  };

  const changeMode = (mode: Mode) => {
    if (mode === draft.mode) return;
    // Palette → per light: start from the palette as it falls on the lights, to fine-tune it.
    if (mode === 'lights' && draft.mode === 'palette') return set({ mode, lights: shown });
    if (mode === 'palette' && draft.mode === 'lights') return set({ mode, palette: paletteFrom(draft.lights) });
    set({ mode });
  };

  const save = async (asNew: boolean) => {
    if (saving) return;
    setSaving(true);
    const fields: Omit<Mood, 'id' | 'createdAt'> = {
      name: draft.name.trim() || suggestName(shown),
      targetId: draft.targetId,
      lights: draft.mode === 'palette' ? [] : draft.lights,
      palette: draft.mode === 'palette' ? draft.palette : undefined,
      transition: draft.transition,
    };
    const editing = original && !asNew ? original : null;
    let list = editing ? await updateMood(editing.id, { ...fields, palette: fields.palette, living: undefined }) : await addMood(fields);
    const saved = editing ? list.find((m) => m.id === editing.id)! : list[list.length - 1];
    // Living: the bridge scenes are made again from the saved look.
    if (editing) await removeLiving(editing.living);
    if (draft.living !== null) {
      let living: Mood['living'] = { speed: draft.living };
      try {
        living = await putLiving(snapshot, { ...saved, living }, map ?? null);
      } catch (e) {
        Alert.alert('Saved, but not living', `The bridge didn't take the living colors: ${(e as Error).message}`);
      }
      list = await updateMood(saved.id, { living });
    }
    // Previewing: the lights keep the mood, now with its fade and living colors.
    if (preview.live) {
      const m = list.find((x) => x.id === saved.id);
      if (m) act((s) => planMood(s, m, map ?? null));
      preview.keep();
    }
    goBack();
  };

  const remove = () =>
    original &&
    Alert.alert(`Delete ${original.name}?`, undefined, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteMood(original.id).then(goBack);
        },
      },
    ]);

  // Map-aware moods: their own sheets, saved from there.
  const saveMapMood = async (name: string, change: { path?: PathRecipe; recipe?: MapRecipe }) => {
    if (original && isMapAware(original)) await updateMood(original.id, { name, ...change });
    else await addMood({ name, targetId: null, lights: [], ...change });
    setMapSheet(null);
    goBack();
  };
  const closeMapSheet = () => {
    setMapSheet(null);
    if (original && isMapAware(original)) goBack();
  };

  const lit = shown.filter((m) => m.on);
  const livingOk = canLive(snapshot, shown);

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 14, paddingHorizontal: 24 }}>
        <IconButton icon="back" label="Back" onPress={goBack} />
        <Label tone="label" style={{ flex: 1, textAlign: 'center' }}>
          {original ? 'Edit mood' : 'New mood'}
        </Label>
        <PillButton title={saving ? 'Saving' : 'Save'} height={40} onPress={() => save(false)} disabled={saving || draft.mode === 'map'} style={{ borderColor: 'rgba(233,207,159,0.45)' }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: insets.bottom + 40, gap: 14 }} keyboardShouldPersistTaps="handled">
        <TextInput
          value={draft.name}
          onChangeText={(name) => set({ name, named: true })}
          placeholder={suggestName(shown)}
          placeholderTextColor={color.muted}
          selectionColor={color.champagne}
          accessibilityLabel="Mood name"
          style={{ fontFamily: font.display, fontSize: 28, color: color.ivory, paddingVertical: 4, borderBottomWidth: 1, borderStyle: 'dashed', borderBottomColor: hairline(0.22) }}
        />
        <TargetPicker snapshot={snapshot} targetId={draft.targetId} name={targetName} count={lightsOfTarget.length} onPick={changeTarget} />

        <ModeTabs
          tabs={[
            { id: 'lights', title: 'Per light' },
            { id: 'palette', title: 'Palette' },
            { id: 'map', title: 'On your map' },
          ]}
          value={draft.mode}
          onChange={changeMode}
        />

        {draft.mode === 'lights' && <PerLight snapshot={snapshot} map={map ?? null} lights={lightsOfTarget} mood={draft.lights} targetId={draft.targetId} onChange={setLights} />}
        {draft.mode === 'palette' && <PaletteEditor snapshot={snapshot} lights={lightsOfTarget} palette={draft.palette} shown={shown} onChange={setPalette} />}
        {draft.mode === 'map' && <MapKinds map={map ?? null} onPick={setMapSheet} />}

        {draft.mode !== 'map' && (
          <>
            <View style={{ borderTopWidth: 1, borderTopColor: hairline(0.1), paddingTop: 12, gap: 10 }}>
              <Label>Transition</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                {TRANSITIONS.map((t) => (
                  <Choice key={t.label} label={t.label} chosen={draft.transition === t.ms} onPress={() => set({ transition: t.ms })} />
                ))}
              </ScrollView>
              <Txt size={12} tone="muted">
                How long the lights take to change. Lights turned off go off at once.
              </Txt>
            </View>

            <ToggleRow
              title="Living"
              note={
                !livingOk
                  ? 'Needs a color on a color light: the colors drift across the lights.'
                  : draft.living === null
                    ? 'Each light keeps its color.'
                    : `The colors drift across the lights, ${livingSpeedLabel(draft.living).toLowerCase()}. Played by the bridge once saved, phone off too.`
              }
              on={draft.living !== null && livingOk}
              onToggle={() => livingOk && set({ living: draft.living === null ? LIVING_SPEEDS[0].speed : null })}
            >
              {draft.living !== null && livingOk && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {LIVING_SPEEDS.map((sp) => (
                    <Choice key={sp.id} label={sp.label} chosen={Math.abs((draft.living ?? 0) - sp.speed) < 0.01} onPress={() => set({ living: sp.speed })} />
                  ))}
                </View>
              )}
            </ToggleRow>

            <ToggleRow
              title="Live on your lights"
              note={preview.live ? `${lit.length} ${lit.length === 1 ? 'light follows' : 'lights follow'} each change. Switch off to put them back as they were.` : 'Try it on the real lights while you edit.'}
              on={preview.live}
              onToggle={preview.live ? preview.stop : preview.start}
              live={preview.live}
            />

            {original && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                <PillButton title="Save as new" onPress={() => save(true)} disabled={saving} height={44} />
                <PillButton title="Delete mood" kind="text" height={44} onPress={remove} />
              </View>
            )}
          </>
        )}
      </ScrollView>

      {sheet && map && sheet !== 'path' && (
        <MapMoodSheet
          kind={sheet}
          map={map}
          snapshot={snapshot}
          initial={original?.recipe && { name: original.name, recipe: original.recipe }}
          onSend={(lights) => act((s) => planLights(s, lights))}
          onSave={(name, recipe) => saveMapMood(name, { recipe })}
          onDelete={original && isMapAware(original) ? remove : undefined}
          onClose={closeMapSheet}
        />
      )}
      {sheet === 'path' && map && (
        <PathSheet
          map={map}
          snapshot={snapshot}
          initial={original?.path && { name: original.name, path: original.path }}
          onTry={(path) => act((s) => planLights(s, pathLights(s, path, map) ?? []))}
          onSave={(name, path) => saveMapMood(name, { path })}
          onDelete={original && isMapAware(original) ? remove : undefined}
          onClose={closeMapSheet}
        />
      )}
    </View>
  );
}

/** "Salon · 4 lights ›": tap to pick the whole home, a room or a group. */
function TargetPicker({ snapshot, targetId, name, count, onPick }: { snapshot: Snapshot; targetId: string | null; name: string; count: number; onPick: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8, marginTop: -6 }}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={`For ${name}, ${count} lights. Change`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
      >
        <Txt size={13} tone="secondary">
          {`${name} · ${count} ${count === 1 ? 'light' : 'lights'}`}
        </Txt>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevronRight" size={12} tint={color.secondary} stroke={1.6} />
        </View>
      </Pressable>
      {open && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          <Choice label="Whole home" chosen={targetId === null} onPress={() => onPick(null)} />
          {[...snapshot.rooms, ...(snapshot.zones ?? [])]
            .filter((g) => g.lightIds.length)
            .map((g) => (
              <Choice key={g.id} label={g.name} chosen={targetId === g.id} onPress={() => onPick(g.id)} />
            ))}
        </ScrollView>
      )}
    </View>
  );
}

function ToggleRow({ title, note, on, onToggle, live, children }: { title: string; note: string; on: boolean; onToggle: () => void; live?: boolean; children?: ReactNode }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: hairline(0.1), paddingTop: 8, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {live && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.connected }} />}
            <Txt size={14}>{title}</Txt>
          </View>
          <Txt size={12} tone="muted">
            {note}
          </Txt>
        </View>
        <Switch on={on} onToggle={onToggle} label={title} big />
      </View>
      {children}
    </View>
  );
}

/** Mode A: the map (tap a light to edit it), a short summary, and one row per light. */
function PerLight({
  snapshot,
  map,
  lights,
  mood,
  targetId,
  onChange,
}: {
  snapshot: Snapshot;
  map: HomeMap | null;
  lights: Light[];
  mood: MoodLight[];
  targetId: string | null;
  onChange: (lights: MoodLight[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(mood.map((m) => [m.lightId, m]));
  const placed = useMemo(() => {
    const ids = new Set(lights.map((l) => l.id));
    return map?.lights.filter((p) => ids.has(p.lightId)) ?? [];
  }, [map, lights]);
  // Frame the rooms these lights stand in (all of the home for the whole home).
  const frame = useMemo(() => {
    if (!map || targetId === null) return undefined;
    const rooms = new Set(placed.map((p) => roomAt(map, p)?.id).filter(Boolean));
    const pts = map.rooms.filter((r) => rooms.has(r.id)).flatMap((r) => r.points);
    return pts.length ? pts : placed.map((p) => ({ x: p.x, z: p.z }));
  }, [map, targetId, placed]);

  const put = (lightId: string, m: MoodLight | null) => {
    const rest = mood.filter((x) => x.lightId !== lightId);
    if (!m) return onChange(rest);
    // Keep the lights in their order in the target.
    const order = lights.map((l) => l.id);
    onChange([...rest, m].sort((a, b) => order.indexOf(a.lightId) - order.indexOf(b.lightId)));
  };

  const onTouch = ({ p, phase, moved }: MapTouch) => {
    if (phase !== 'end' || moved || !placed.length) return;
    const near = placed.reduce((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? b : a));
    if (Math.hypot(near.x - p.x, near.z - p.z) < 1.2) setOpen(near.lightId);
  };

  const on = mood.filter((m) => m.on);
  const avg = on.length ? Math.round(on.reduce((a, m) => a + (m.brightness ?? 100), 0) / on.length) : 0;

  return (
    <View style={{ gap: 6 }}>
      {map && placed.length > 0 && (
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: hairline(0.1), overflow: 'hidden' }}>
          <MoodMap map={map} lights={mood} height={200} selectedLight={open} frame={frame} onTouch={onTouch} />
        </View>
      )}
      <Label size={9} tone="muted" style={{ marginTop: 4 }}>
        {`${on.length} of ${lights.length} on${on.length ? ` · ${avg}% average` : ''}${placed.length ? ' · tap a light on the map' : ''}`}
      </Label>
      <View>
        {lights.map((l) => (
          <LightRow
            key={l.id}
            light={l}
            m={byId.get(l.id)}
            expanded={open === l.id}
            onPress={() => setOpen(open === l.id ? null : l.id)}
            onChange={(m) => put(l.id, m)}
          />
        ))}
      </View>
      {snapshot.lights.length > 0 && lights.length === 0 && (
        <Txt size={13} tone="muted">
          No light here. Pick another room or group above.
        </Txt>
      )}
    </View>
  );
}

/** What a mood light says, in words: "Ember · 60%", "Off", "Not in this mood". */
function describe(m: MoodLight | undefined) {
  if (!m) return { what: 'Left as it is', level: '' };
  if (!m.on) return { what: 'Off', level: '' };
  const what = m.effect ? (effectLabel(m.effect) ?? 'Effect') : m.hex ? colorName(m.hex) : m.kelvin ? kelvinName(m.kelvin) : 'On';
  return { what, level: m.brightness !== undefined ? `${m.brightness}%` : '' };
}

function LightRow({ light, m, expanded, onPress, onChange }: { light: Light; m?: MoodLight; expanded: boolean; onPress: () => void; onChange: (m: MoodLight | null) => void }) {
  const [tuning, setTuning] = useState(false);
  const c = m ? moodLightColor(m) : null;
  const { what, level } = describe(m);
  const plug = light.kind === 'onoff';
  const dims = light.brightness !== null;
  const supported = EFFECTS.filter((e) => light.effects?.includes(e.id)).map((e) => e.id);
  const base = m ?? fromLight(light);
  const turnOn = (): MoodLight => {
    if (base.on) return base;
    const now = fromLight({ ...light, on: true });
    return { ...now, brightness: dims ? (now.brightness ?? 100) : undefined };
  };
  const pick = (t: Tint) => onChange({ ...turnOn(), hex: t.hex, kelvin: t.hex ? undefined : t.kelvin, effect: undefined });

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: hairline(0.08), backgroundColor: expanded ? color.card : 'transparent', borderRadius: expanded ? 16 : 0 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${light.name}, ${what}${level ? ` ${level}` : ''}`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 10, opacity: pressed ? 0.6 : 1 })}
      >
        {c ? (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c, boxShadow: `0 0 0 2px ${color.ground}, 0 0 0 3px ${color.jewelRing}, 0 0 10px 2px ${c}` }} />
        ) : (
          <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderStyle: m ? 'solid' : 'dashed', borderColor: hairline(0.4) }} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={14} numberOfLines={1} style={{ lineHeight: 18 }}>
            {light.name}
          </Txt>
          <Txt size={12} tone="muted" numberOfLines={1} style={{ lineHeight: 16 }}>
            {light.reachable ? `${lightTypeLabel(light)} · ${what}` : `${what} · not reachable now`}
          </Txt>
        </View>
        <Display size={16} weight={300} style={{ width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
          {level}
        </Display>
      </Pressable>
      {expanded && (
        <View style={{ paddingHorizontal: 10, paddingBottom: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Choice label="On" chosen={!!m?.on} onPress={() => onChange(turnOn())} />
            <Choice label="Off" chosen={!!m && !m.on} onPress={() => onChange({ lightId: light.id, on: false })} />
            <Choice label="Leave as it is" chosen={!m} onPress={() => onChange(null)} />
          </View>
          {plug && (
            <Txt size={12} tone="muted">
              A plug only turns on and off.
            </Txt>
          )}
          {!plug && (light.kind === 'color' || hasTemperature(light)) && (
            <>
              <TintPicker current={m?.on && !m.effect ? tintOf(m) : undefined} onPick={pick} whitesOnly={light.kind !== 'color'} ground={color.card} />
              <PillButton title="Fine-tune the color" kind="text" height={36} icon="settings" onPress={() => setTuning(true)} style={{ alignSelf: 'flex-start', marginTop: -6 }} />
            </>
          )}
          {!plug && supported.length > 0 && (
            <EffectRow supported={supported} current={m?.on ? m.effect : undefined} onPick={(id) => onChange(id === 'no_effect' ? { ...turnOn(), effect: undefined } : { ...turnOn(), effect: id })} />
          )}
          {dims && (
            <View style={{ gap: 6 }}>
              <Label>{`Brightness · ${m?.on ? (m.brightness ?? 100) : 0}%`}</Label>
              <Slider
                value={m?.on ? (m.brightness ?? 100) : 1}
                tint={c ?? '#5A5650'}
                ground={color.card}
                label={`${light.name} brightness`}
                onChange={(brightness) => onChange({ ...turnOn(), brightness })}
                onCommit={(brightness) => onChange({ ...turnOn(), brightness })}
              />
            </View>
          )}
        </View>
      )}
      {tuning && <TuneSheet light={light} m={m?.on ? m : turnOn()} onPick={pick} onClose={() => setTuning(false)} />}
    </View>
  );
}

/** The light screen's dial, for an exact color or white. */
function TuneSheet({ light, m, onPick, onClose }: { light: Light; m: MoodLight; onPick: (t: Tint) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'hue' | 'white'>(m.hex && light.kind === 'color' ? 'hue' : 'white');
  const [hue, setHue] = useState(m.hex ? Math.round(hexHueSat(m.hex).hue) : 30);
  const [kelvin, setKelvin] = useState(m.kelvin ?? (light.mirek ? mirekToKelvin(light.mirek) : 2700));
  const tint = mode === 'hue' ? ringColor(hue) : kelvinTint(kelvin);
  return (
    <ModalSheet visible title={light.name} onClose={onClose}>
      {light.kind === 'color' && (
        <ModeTabs
          tabs={[
            { id: 'hue', title: 'Color' },
            { id: 'white', title: 'White' },
          ]}
          value={mode}
          onChange={setMode}
        />
      )}
      <Dial
        mode={mode}
        size={250}
        value={mode === 'hue' ? hue : Math.max(KELVIN_MIN, Math.min(KELVIN_MAX, kelvin))}
        on
        tint={tint}
        ticks={mode === 'white' ? WHITE_PRESETS.map((w) => w.kelvin) : []}
        label={mode === 'hue' ? 'Color' : 'White'}
        onChange={(v) => (mode === 'hue' ? setHue(v) : setKelvin(v))}
        onCommit={(v) => {
          if (mode === 'hue') {
            setHue(v);
            onPick({ hex: ringColor(v).toUpperCase() });
          } else {
            setKelvin(v);
            onPick({ kelvin: v });
          }
        }}
      >
        <Txt size={13} style={{ color: '#24160B' }}>
          {mode === 'hue' ? colorName(tint) : kelvinName(kelvin)}
        </Txt>
      </Dial>
      <PillButton title="Done" kind="primary" onPress={onClose} />
    </ModalSheet>
  );
}

/** Mode B: 1 to 5 colors and a brightness, spread over the lights; an effect for lights that have it. */
function PaletteEditor({ snapshot, lights, palette, shown, onChange }: { snapshot: Snapshot; lights: Light[]; palette: Palette; shown: MoodLight[]; onChange: (p: Palette) => void }) {
  const [sel, setSel] = useState(0);
  const i = Math.min(sel, palette.tones.length - 1);
  const tones = palette.tones;
  const supported = EFFECTS.filter((e) => lights.some((l) => l.effects?.includes(e.id))).map((e) => e.id);
  const byId = new Map(shown.map((m) => [m.lightId, m]));
  const n = tones.length;
  const D = [0, 112, 104, 96, 84, 72][n];
  const step = Math.round(D * 0.62);
  const pickTone = (t: Tint) => onChange({ ...palette, tones: tones.map((x, k) => (k === i ? { ...t, brightness: x.brightness } : x)) });

  return (
    <View style={{ gap: 14 }}>
      <View style={{ height: 140, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {tones.map((t, k) => (
          <Pressable
            key={k}
            onPress={() => setSel(k)}
            accessibilityRole="button"
            accessibilityState={{ selected: k === i }}
            accessibilityLabel={`Color ${k + 1}, ${tintLabel(t)}`}
            style={{ marginLeft: k ? step - D : 0, zIndex: k === i ? 2 : 1, borderRadius: D / 2, ...(k === i ? { boxShadow: `0 0 0 4px ${color.ground}, 0 0 0 5px ${color.champagne}` } : {}) }}
          >
            <Orb size={D} on tint={tintHex(t)} />
          </Pressable>
        ))}
        {n < MAX_TONES && (
          <Pressable
            onPress={() => {
              const used = new Set(tones.map((t) => t.hex));
              onChange({ ...palette, tones: [...tones, { hex: NEW_TONES.find((h) => !used.has(h)) ?? NEW_TONES[0] }] });
              setSel(n);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add a color"
            style={({ pressed }) => ({
              marginLeft: 16,
              width: 52,
              height: 52,
              borderRadius: 26,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: hairline(0.32),
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="add" size={16} tint={color.secondary} />
          </Pressable>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          <Label size={10}>{`Color ${i + 1} of ${n}`}</Label>
          <Display size={17} weight={400}>
            {tintLabel(tones[i])}
          </Display>
        </View>
        {n > 1 && (
          <PillButton
            title="Remove color"
            kind="text"
            height={32}
            onPress={() => {
              onChange({ ...palette, tones: tones.filter((_, k) => k !== i) });
              setSel(Math.max(0, i - 1));
            }}
          />
        )}
      </View>
      <TintPicker current={tones[i]} onPick={pickTone} ground={color.ground} />

      <View style={{ gap: 10, marginTop: 4 }}>
        <Label tone="label">{`Spread across ${shown.length} ${shown.length === 1 ? 'light' : 'lights'}`}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
          {lights.map((l) => {
            const m = byId.get(l.id);
            const c = m ? moodLightColor(m) : null;
            const sub = !m ? (l.kind === 'onoff' ? 'Plug, as it is' : 'Not reachable') : (describe(m).what);
            return (
              <View key={l.id} style={{ width: '25%', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                {c ? (
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c, boxShadow: `0 0 0 2px ${color.ground}, 0 0 0 3px ${color.jewelRing}, 0 0 10px 2px ${c}` }} />
                ) : (
                  <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderStyle: 'dashed', borderColor: hairline(0.4) }} />
                )}
                <Txt size={12} numberOfLines={2} style={{ textAlign: 'center', lineHeight: 15 }}>
                  {l.name}
                </Txt>
                <Txt size={11} tone="muted" numberOfLines={1} style={{ lineHeight: 14 }}>
                  {sub}
                </Txt>
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Label tone="label">Brightness</Label>
          <Display size={18} weight={300} style={{ fontVariant: ['tabular-nums'] }}>{`${palette.brightness}%`}</Display>
        </View>
        <Slider
          value={palette.brightness}
          tint={tintHex(tones[0])}
          ground={color.ground}
          label="Brightness"
          onChange={(brightness) => onChange({ ...palette, brightness, tones: tones.map(({ brightness: _, ...t }) => t) })}
          onCommit={(brightness) => onChange({ ...palette, brightness, tones: tones.map(({ brightness: _, ...t }) => t) })}
        />
      </View>
      {supported.length > 0 && (
        <View style={{ gap: 6 }}>
          <EffectRow supported={supported} current={palette.effect} onPick={(id) => onChange({ ...palette, effect: id === 'no_effect' ? undefined : id })} />
          {palette.effect && (
            <Txt size={12} tone="muted">
              {`Lights that can play ${effectLabel(palette.effect)?.toLowerCase()} play it; the others take the colors.`}
            </Txt>
          )}
        </View>
      )}
      {snapshot.lights.length > 0 && !shown.length && (
        <Txt size={13} tone="muted">
          No light here can take a color. Pick another room or group above.
        </Txt>
      )}
    </View>
  );
}

/** Mode C: the map-aware moods, each in its own sheet. */
function MapKinds({ map, onPick }: { map: HomeMap | null; onPick: (k: 'path' | MapMoodKind) => void }) {
  const hasMap = !!map?.rooms.some((r) => r.points.length >= 3);
  if (!hasMap)
    return (
      <Txt size={13} tone="muted">
        Moods that use where your lights are: a path lighting the way from one room to another, a gradient across the home, a spotlight, a color per room. Scan or draw your home on the Map tab first.
      </Txt>
    );
  const kinds: { id: 'path' | MapMoodKind; title: string; sub: string }[] = [
    { id: 'path', title: 'Night path', sub: 'A dim trail from one room to another.' },
    { id: 'sweep', title: KIND_TITLES.sweep, sub: 'Two or three colors across the home, along a direction.' },
    { id: 'spot', title: KIND_TITLES.spot, sub: 'Light around a point, brighter near it.' },
    { id: 'glow', title: KIND_TITLES.glow, sub: 'One color per room.' },
  ];
  return (
    <View>
      <Txt size={13} tone="secondary" style={{ marginBottom: 8 }}>
        Moods worked out from your map each time, so they follow its changes.
      </Txt>
      {kinds.map((k) => (
        <Pressable
          key={k.id}
          onPress={() => onPick(k.id)}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderTopWidth: 1, borderTopColor: hairline(0.08), opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={15}>{k.title}</Txt>
            <Txt size={12} tone="muted">
              {k.sub}
            </Txt>
          </View>
          <Icon name="chevronRight" size={13} tint={color.muted} stroke={1.6} />
        </Pressable>
      ))}
    </View>
  );
}
