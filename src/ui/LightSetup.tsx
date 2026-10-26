import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { Planned } from '../lib/actions';
import { renameDevice, setDeviceArchetype, type Light, type Snapshot } from '../lib/hue/client';
import { LIGHT_ICON_PATHS } from '../lib/lightIcons';
import { isPlug, LIGHT_TYPES, lightType } from '../lib/lights';
import { PillButton } from './controls';
import { Field, ModalSheet } from './ModalSheet';
import { Label, Txt } from './text';
import { color, hairline } from './theme';

type Act = (plan: (s: Snapshot) => Planned | null) => void;

/**
 * "Name & type": rename a light and say what it is (a pendant, string lights on a plug...).
 * Both are written to the bridge, so the Hue app and other apps agree.
 */
export function LightSetup({ light, visible, onClose, act }: { light: Light; visible: boolean; onClose: () => void; act: Act }) {
  const [name, setName] = useState(light.name);
  const current = lightType(light.archetype);
  const [type, setType] = useState(current);
  const plug = isPlug(light);
  // A plug can hold anything; a lamp can't become a plug.
  const types = LIGHT_TYPES.filter((t) => plug || t.type !== 'plug');

  const save = () => {
    const newName = name.trim() || light.name;
    const archetype = type === current ? light.archetype : LIGHT_TYPES.find((t) => t.type === type)!.archetype;
    if (newName !== light.name || archetype !== light.archetype) {
      act((s) => ({
        next: { ...s, lights: s.lights.map((l) => (l.id === light.id ? { ...l, name: newName, archetype } : l)) },
        send: async () => {
          if (newName !== light.name) await renameDevice(light.deviceId, newName);
          if (archetype !== light.archetype) await setDeviceArchetype(light.deviceId, archetype);
        },
      }));
    }
    onClose();
  };

  return (
    <ModalSheet visible={visible} title="Name & type" onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} />
      <View style={{ gap: 10 }}>
        <Label>{plug ? "What's plugged in?" : 'What is it?'}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {types.map((t) => {
            const sel = t.type === type;
            return (
              <Pressable
                key={t.type}
                onPress={() => setType(t.type)}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={t.label}
                style={({ pressed }) => ({
                  width: '31.5%',
                  height: 72,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: sel ? color.champagne : hairline(0.12),
                  backgroundColor: sel ? color.selected : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path d={LIGHT_ICON_PATHS[t.type]} stroke={sel ? color.champagne : color.ivory} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Txt size={11} tone={sel ? 'ivory' : 'secondary'} numberOfLines={1} style={{ lineHeight: 14 }}>
                  {t.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>
        {plug && (
          <Txt size={12} tone="muted">
            {"It's a smart plug: it turns on and off. The type sets its icon and how it glows on the map."}
          </Txt>
        )}
      </View>
      <PillButton title="Save" kind="primary" onPress={save} style={{ marginTop: 6 }} />
    </ModalSheet>
  );
}
