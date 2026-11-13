import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, AppState, Linking, View } from 'react-native';

import { locationAccess, syncGeofence } from '../../lib/rituals/arrive';
import { loadRitualSettings, saveRitualSettings, type RitualSettings } from '../../lib/rituals/store';
import { PillButton, Section } from '../controls';
import { SettingsRow } from './parts';

const ACCESS = {
  all: 'Allowed all the time',
  foreground: 'Only while using Glim. Arriving home needs “Allow all the time”.',
  none: 'Off for Glim. Arriving home needs “Allow all the time”.',
};

/**
 * Settings → Home location: the circle around home that Arriving and Leaving home watch (set in
 * the Rituals tab, from where the phone is), the location access it needs, and forgetting it.
 */
export function HomeLocation() {
  const router = useRouter();
  const [s, setS] = useState<RitualSettings | null>(null);
  const [access, setAccess] = useState<keyof typeof ACCESS | null>(null);

  const load = useCallback(() => {
    loadRitualSettings().then(setS);
    locationAccess()
      .then(setAccess)
      .catch(() => setAccess('none'));
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
      // Coming back from Android's settings: the access may have changed.
      const sub = AppState.addEventListener('change', (st) => st === 'active' && load());
      return () => sub.remove();
    }, [load]),
  );
  if (!s || !access) return null;

  const uses = [s.arrive.enabled && 'Arriving home', s.leave.enabled && 'Leaving home'].filter(Boolean).join(' and ');
  const forget = () =>
    Alert.alert('Forget your home’s location?', 'Arriving and Leaving home turn off. You can set your home again from the Rituals tab, while you’re home.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: async () => {
          setS(await saveRitualSettings({ home: null, arrive: { ...s.arrive, enabled: false }, leave: { enabled: false } }));
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
          sub={s.home ? (uses ? `Used by ${uses}. Kept on this phone only.` : 'Not used right now. Kept on this phone only.') : 'Set it from Arriving home in the Rituals tab, while you’re home.'}
          onPress={() => router.push('/rituals')}
        />
        <SettingsRow icon="settings" title="Location access" sub={ACCESS[access]} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 }}>
          {access !== 'all' && <PillButton title="Open Glim’s settings" height={40} onPress={() => Linking.openSettings()} />}
          {s.home && <PillButton title="Forget home" kind="text" height={40} onPress={forget} />}
        </View>
      </View>
    </Section>
  );
}
