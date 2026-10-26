import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { kelvinTint } from '../lib/hue/color';
import { inkOn } from '../lib/lightIcons';
import { addFavorite, favoriteName, loadFavorites, removeFavorite, type Favorite } from '../lib/palette';
import { Icon } from './icons';
import { ColorDot } from './LightControls';
import { Label, Txt } from './text';
import { color, font, hairline } from './theme';

/**
 * Saved looks, one tap to come back to them: "+" saves the current look (color or white, and
 * brightness), tap applies, long-press removes. Shared by every light and room of the bridge.
 */
export function FavoritesRow({
  current,
  onApply,
  ground = color.ground,
  title = 'Favorites',
}: {
  /** The look to save with "+"; null when there's nothing to save (light off). */
  current: Omit<Favorite, 'id'> | null;
  onApply: (f: Favorite) => void;
  ground?: string;
  title?: string;
}) {
  const [list, setList] = useState<Favorite[]>([]);
  useEffect(() => {
    loadFavorites().then(setList);
  }, []);

  const remove = (f: Favorite) =>
    Alert.alert('Remove this favorite?', favoriteName(f), [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeFavorite(f.id).then(setList) },
    ]);

  return (
    <View style={{ gap: 10 }}>
      <Label>{title}</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, alignItems: 'center', paddingRight: 8 }}>
        <Pressable
          onPress={() => current && addFavorite(current).then(setList)}
          disabled={!current}
          accessibilityRole="button"
          accessibilityLabel="Save this look as a favorite"
          hitSlop={4}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: hairline(0.35),
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !current ? 0.35 : pressed ? 0.6 : 1,
          })}
        >
          <Icon name="add" size={16} tint={color.secondary} />
        </Pressable>
        {list.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => onApply(f)}
            onLongPress={() => remove(f)}
            accessibilityRole="button"
            accessibilityLabel={`Favorite: ${favoriteName(f)}`}
            accessibilityHint="Long-press to remove"
            hitSlop={4}
            style={{ alignItems: 'center' }}
          >
            <ColorDot hex={f.hex ?? kelvinTint(f.kelvin ?? 2700)} ground={ground} />
            {/* Brightness on the dot, so two looks of the same color can be told apart. */}
            <Txt size={9} style={{ position: 'absolute', top: 13, fontFamily: font.uiMedium, lineHeight: 12, color: inkOn(f.hex ?? kelvinTint(f.kelvin ?? 2700)) }}>
              {f.brightness}
            </Txt>
          </Pressable>
        ))}
        {!list.length && (
          <Txt size={12} tone="muted" style={{ maxWidth: 220 }}>
            Tap + to keep this look and come back to it anytime.
          </Txt>
        )}
      </ScrollView>
    </View>
  );
}
