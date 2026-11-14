import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { HueHttp } from '../../../modules/hue-http';
import type { Snapshot } from '../../lib/hue/client';
import { hueMoodPlace, hueMoods } from '../../lib/hueMoods';
import { useHome } from '../../lib/hue/useHome';
import { loadMap, type HomeMap } from '../../lib/map/map';
import { PRESET_CATEGORIES, PRESETS } from '../../lib/moodPresets';
import { loadMoods, type Mood } from '../../lib/moods';
import { loadBridgeRituals, type BridgeRitual } from '../../lib/rituals/rituals';
import { loadTileTarget, saveTileTarget, tileConfig, type TileTarget } from '../../lib/tile';
import { isShowing, itemKey, moodButtons, sleepItems } from '../../widgets/moodButtons';
import { PillButton, Section, TagButton } from '../controls';
import { Icon, type IconName } from '../icons';
import { Choice } from '../scan/parts';
import { Display, Label, Txt } from '../text';
import { color, hairline } from '../theme';
import { useSectionReady } from './parts';

const targetKey = (t: TileTarget) => (t.kind === 'home' ? 'home' : t.kind === 'mood' || t.kind === 'sleep' ? `${t.kind}:${itemKey(t.item)}` : `${t.kind}:${t.id}`);

/**
 * Settings → Quick Settings tile (Android): what the one Glim tile controls, a room, a group, the
 * whole home or a mood, with a preview of the tile. Long-pressing the tile opens this section
 * (glim://settings?section=tile). The tile itself is native (GlimTile.kt); src/lib/tile.ts feeds it.
 */
export function QuickTile() {
  const { snapshot } = useHome(15_000);
  const [target, setTarget] = useState<TileTarget | null>(null);
  const [data, setData] = useState<{ moods: Mood[]; map: HomeMap | null }>({ moods: [], map: null });
  const [added, setAdded] = useState(false);
  const [morePresets, setMorePresets] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [rituals, setRituals] = useState<{ list: BridgeRitual[]; fading: string[] | null }>({ list: [], fading: null });

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadTileTarget(), loadMoods(), loadMap()]).then(([t, moods, map]) => {
        setTarget(t);
        setData({ moods, map });
        if (t.kind === 'mood' && t.item.kind === 'preset') setMorePresets(true);
      });
      // Sleep fades the tile can start, and whether one runs now (for the preview).
      loadBridgeRituals()
        .then((b) => setRituals({ list: b.rituals, fading: b.sleepRun?.targets ?? null }))
        .catch(() => null);
      setAdded(HueHttp.isTileAdded?.() ?? false);
    }, []),
  );

  useSectionReady(Platform.OS !== 'android' || (!!target && !!snapshot));
  if (Platform.OS !== 'android' || !target || !snapshot) return null;

  const pick = (t: TileTarget) => {
    setTarget(t);
    saveTileTarget(t);
  };
  const chosen = targetKey(target);
  const chip = (t: TileTarget, label: string) => <Choice key={targetKey(t)} label={label} chosen={targetKey(t) === chosen} onPress={() => pick(t)} />;

  const add = async () => {
    setNote(null);
    const r = (await HueHttp.requestAddTile?.()) ?? -1;
    if (r === 1 || r === 2) setAdded(true);
    else if (r === 0) setNote('Not added. You can add it any time from Quick Settings.');
    else setNote('Swipe down twice from the top of the screen, tap the pen, then drag Glim into your tiles.');
  };

  const own = data.moods.filter((m) => !m.path && !m.recipe);
  const onMap = data.moods.filter((m) => m.path || m.recipe);
  const zones = snapshot.zones ?? [];
  const fromHue = hueMoods(snapshot);

  return (
    <Section title="Quick Settings tile">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <TilePreview target={target} snapshot={snapshot} moods={data.moods} map={data.map} fading={rituals.fading} />
        <Txt size={12} tone="muted" style={{ flex: 1 }}>
          Tap the tile to turn it on or off. Hold it to come back here.
        </Txt>
      </View>
      {!added && <PillButton title="Add to Quick Settings" icon="add" kind="primary" height={44} onPress={add} style={{ alignSelf: 'flex-start' }} />}
      {note && (
        <Txt size={13} tone="champagne">
          {note}
        </Txt>
      )}

      <Group title="Lights">
        {chip({ kind: 'home' }, 'All lights')}
        {snapshot.rooms.map((r) => chip({ kind: 'room', id: r.id }, r.name))}
        {zones.map((z) => chip({ kind: 'group', id: z.id }, z.name))}
      </Group>
      {!!own.length && <Group title="My moods">{own.map((m) => chip({ kind: 'mood', item: { kind: 'mood', id: m.id } }, m.name))}</Group>}
      {!!onMap.length && <Group title="On your map">{onMap.map((m) => chip({ kind: 'mood', item: { kind: 'mood', id: m.id } }, m.name))}</Group>}
      {!!fromHue.length && (
        <Group title="From the Hue app">{fromHue.map((sc) => chip({ kind: 'mood', item: { kind: 'scene', id: sc.id } }, `${sc.name} · ${hueMoodPlace(snapshot, sc)}`))}</Group>
      )}
      <Group title="Sleep fade">
        {(target.kind === 'sleep' && !sleepItems(snapshot, rituals.list).some((i) => itemKey(i) === itemKey(target.item)) ? [target.item, ...sleepItems(snapshot, rituals.list)] : sleepItems(snapshot, rituals.list)).map((i) =>
          chip({ kind: 'sleep', item: i }, `${i.name} · ${i.fadeMin} min`),
        )}
      </Group>
      {morePresets ? (
        PRESET_CATEGORIES.map((c) => (
          <Group key={c} title={c}>
            {PRESETS.filter((p) => p.category === c).map((p) => chip({ kind: 'mood', item: { kind: 'preset', id: p.id } }, p.name))}
          </Group>
        ))
      ) : (
        <View style={{ flexDirection: 'row' }}>
          <TagButton title="Preset moods" icon="moods" onPress={() => setMorePresets(true)} />
        </View>
      )}
      <Txt size={12} tone="muted">
        A mood’s tile is on while the lights look like it; tapping it then turns those lights off. Presets set the whole home. A sleep fade’s tile is on while it fades; tapping it then stops the fade and keeps the lights where they are.
      </Txt>
    </Section>
  );
}

/** The tile as Android draws it: champagne when on, an outline when off. */
function TilePreview({ target, snapshot, moods, map, fading }: { target: TileTarget; snapshot: Snapshot; moods: Mood[]; map: HomeMap | null; fading: string[] | null }) {
  const c = tileConfig(target, snapshot, moods, map);
  let on = false;
  let sub = c.sub;
  if (c.kind === 'sleep') {
    on = target.kind === 'sleep' && !!fading && target.item.targets.some((t) => fading.includes(t));
    if (on) sub = 'Fading';
  } else if (c.kind === 'mood') {
    const b = target.kind === 'mood' ? moodButtons([target.item], moods, snapshot, map)[0] : undefined;
    on = !!b && isShowing(snapshot, b);
  } else {
    const ids = new Set(c.lights);
    const lit = snapshot.lights.filter((l) => ids.has(l.id) && l.reachable && l.on).length;
    on = lit > 0;
    sub = lit === 0 ? 'Off' : lit === 1 ? '1 light on' : `${lit} lights on`;
  }
  const icon: IconName = c.icon === 'room' ? 'room' : c.icon === 'mood' ? 'moods' : c.icon === 'sleep' ? 'sleep' : 'allLights';
  const ink = on ? color.onChampagne : color.ivory;
  return (
    <View
      accessibilityLabel={`Tile preview: ${c.label}, ${on ? 'on' : 'off'}`}
      style={{
        width: 172,
        height: 68,
        borderRadius: 34,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        backgroundColor: on ? color.champagne : 'transparent',
        borderWidth: 1,
        borderColor: on ? color.champagne : hairline(0.16),
      }}
    >
      <Icon name={icon} size={22} tint={ink} />
      <View style={{ flex: 1 }}>
        <Display size={16} weight={400} numberOfLines={1} style={{ color: ink }}>
          {c.label}
        </Display>
        <Txt size={12} numberOfLines={1} style={{ color: on ? color.onChampagne : color.secondary, opacity: on ? 0.75 : 1 }}>
          {sub}
        </Txt>
      </View>
    </View>
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
