import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { kelvinTint } from '../lib/hue/color';
import { addFavorite, favoriteName, isFavorite, loadFavorites, removeFavorite, type Favorite, type Swatch } from '../lib/palette';
import { Icon } from './icons';
import { ColorDot } from './LightControls';
import { Label } from './text';
import { color, hairline } from './theme';

/** A color to apply: a color (hex) or a white (kelvin). */
export type ColorPick = { hex?: string; kelvin?: number };

const swatchOf = (p: ColorPick) => p.hex ?? kelvinTint(p.kelvin ?? 2700);

/**
 * The colors to pick from: your favorites first (with a star), then recent colors. "+" keeps the
 * current color as a favorite; long-press a recent color to keep it, a favorite to remove it.
 */
export function ColorRow({
  title,
  current,
  recents,
  selected,
  onPick,
  ground = color.ground,
  labelWidth,
}: {
  title: string;
  /** The color shown now, kept with "+"; null when there's none (off, plain white). */
  current: ColorPick | null;
  recents: Swatch[];
  selected: (p: ColorPick) => boolean;
  onPick: (p: ColorPick) => void;
  ground?: string;
  /** Label beside the row instead of above it (room sheet). */
  labelWidth?: number;
}) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  useEffect(() => {
    loadFavorites().then(setFavorites);
  }, []);

  const items: (ColorPick & { fav?: Favorite })[] = [
    ...favorites.map((f) => ({ hex: f.hex, kelvin: f.kelvin, fav: f })),
    ...recents.filter((r) => !isFavorite(favorites, { hex: r.hex })).map((r) => ({ hex: r.hex })),
  ];

  const hold = (item: ColorPick & { fav?: Favorite }) => {
    const name = favoriteName(item);
    if (item.fav) {
      const fav = item.fav;
      Alert.alert(`Remove ${name} from favorites?`, undefined, [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeFavorite(fav.id).then(setFavorites) },
      ]);
    } else {
      addFavorite(item).then(setFavorites);
    }
  };

  const canSave = !!current && !isFavorite(favorites, current);

  return (
    <View style={labelWidth ? { flexDirection: 'row', alignItems: 'center' } : { gap: 10 }}>
      <Label tone={labelWidth ? 'label' : 'muted'} style={labelWidth ? { width: labelWidth } : undefined}>
        {title}
      </Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: labelWidth ? 1 : undefined }} contentContainerStyle={{ gap: 10, alignItems: 'center', paddingRight: 8 }}>
        <Pressable
          onPress={() => current && addFavorite(current).then(setFavorites)}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Keep the current color as a favorite"
          hitSlop={4}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: hairline(0.35),
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !canSave ? 0.3 : pressed ? 0.6 : 1,
          })}
        >
          <Icon name="star" size={14} tint={color.secondary} />
        </Pressable>
        {items.map((item, i) => (
          <Pressable
            key={item.fav?.id ?? `${item.hex}-${i}`}
            onPress={() => onPick(item)}
            onLongPress={() => hold(item)}
            accessibilityRole="button"
            accessibilityLabel={`${favoriteName(item)}${item.fav ? ', favorite' : ''}`}
            accessibilityHint={item.fav ? 'Long-press to remove from favorites' : 'Long-press to keep as a favorite'}
            hitSlop={4}
          >
            <ColorDot hex={swatchOf(item)} size={36} selected={selected(item)} ground={ground} />
            {item.fav && (
              <View style={{ position: 'absolute', right: -3, bottom: -3, width: 16, height: 16, borderRadius: 8, backgroundColor: ground, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="star" size={10} tint={color.champagne} stroke={1.8} />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
