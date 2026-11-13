import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '../icons';
import { Display, Txt } from '../text';
import { color, hairline } from '../theme';

/** A Settings row: an icon, a title and a line under it; tappable when it leads somewhere. */
export function SettingsRow({ icon, title, sub, onPress, right }: { icon?: IconName; title: string; sub?: string; onPress?: () => void; right?: ReactNode }) {
  const body = (
    <>
      {icon && <Icon name={icon} size={18} tint={color.champagne} />}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Display size={17} weight={400} numberOfLines={1} style={{ lineHeight: 21 }}>
          {title}
        </Display>
        {!!sub && (
          <Txt size={13} tone="secondary" numberOfLines={2}>
            {sub}
          </Txt>
        )}
      </View>
      {right ?? (onPress ? <Icon name="chevronRight" size={14} tint={color.muted} /> : null)}
    </>
  );
  const style = { minHeight: 60, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: hairline(0.1) };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>
      {body}
    </Pressable>
  );
}
