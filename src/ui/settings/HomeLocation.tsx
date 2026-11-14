import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, AppState, Linking, View } from 'react-native';

import { locationAccess, syncGeofence } from '../../lib/rituals/arrive';
import { loadRitualSettings, saveRitualSettings, type RitualSettings } from '../../lib/rituals/store';
import { cachedRituals, rememberSettings } from '../../lib/rituals/view';
import { PillButton, Section } from '../controls';
import { HomeSheet } from '../rituals/ArriveSheet';
import { SettingsRow, useSectionReady } from './parts';

/** Last access read, so the section shows at once on the next visit. */
let lastAccess: 'all' | 'foreground' | 'none' | null = null;

const ACCESS = {
  all: 'Allowed all the time',
  foreground: 'Only while using Glim. Arriving home needs “Allow all the time”.',
  none: 'Off for Glim. Arriving home needs “Allow all the time”.',
};

/**
 * Settings → Home location: the circle around home that Arriving and Leaving home watch (set here
 * or in their sheets, from where the phone is), the location access it needs, and forgetting it.
 */
export function HomeLocation() {
  const [s, setS] = useState<RitualSettings | null>(() => cachedRituals()?.settings ?? null);
  const [access, setAccess] = useState<keyof typeof ACCESS | null>(lastAccess);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    loadRitualSettings().then(setS);
    locationAccess()
      .catch(() => 'none' as const)
      .then((a) => setAccess((lastAccess = a)));
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
      // Coming back from Android's settings: the access may have changed.
      const sub = AppState.addEventListener('change', (st) => st === 'active' && load());
      return () => sub.remove();
    }, [load]),
  );
  useSectionReady(!!s && !!access);
  if (!s || !access) return null;

  const uses = [s.arrive.enabled && 'Arriving home', s.leave.enabled && 'Leaving home'].filter(Boolean).join(' and ');
  const forget = () =>
    Alert.alert('Forget your home’s location?', 'Arriving and Leaving home turn off. You can set it again here, while you’re home.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: async () => {
          const next = await saveRitualSettings({ home: null, arrive: { ...s.arrive, enabled: false }, leave: { enabled: false } });
          setS(next);
          rememberSettings(next);
          await syncGeofence().catch(() => null);
        },
      },
    ]);

  return (
    <Section title="Home location">
      <View>
        <SettingsRow
          icon="location"
          title={s.home ? `Set · ${s.home.radius} m around home` : 'Not set'}
          sub={s.home ? (uses ? `Used by ${uses}. Kept on this phone only.` : 'Not used right now. Kept on this phone only.') : 'Tap to set it, while you’re home.'}
          onPress={() => setEditing(true)}
        />
        <SettingsRow icon="settings" title="Location access" sub={ACCESS[access]} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 }}>
          {access !== 'all' && <PillButton title="Open Glim’s settings" height={40} onPress={() => Linking.openSettings()} />}
          {s.home && <PillButton title="Forget home" kind="text" height={40} onPress={forget} />}
        </View>
      </View>
      {editing && (
        <HomeSheet
          initial={s.home}
          onClose={() => setEditing(false)}
          onSave={async (home) => {
            setEditing(false);
            const next = await saveRitualSettings({ home });
            setS(next);
            rememberSettings(next);
            await syncGeofence().catch(() => null);
          }}
        />
      )}
    </Section>
  );
}
