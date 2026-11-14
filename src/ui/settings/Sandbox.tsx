import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, DevSettings, View } from 'react-native';

import { HueHttp } from '../../../modules/hue-http';
import { forgetBridge, getBridge } from '../../lib/hue/bridge';
import { resetSandbox, SANDBOX } from '../../lib/hue/sandbox';
import { refreshAllWidgets } from '../../widgets/task-handler';
import { PillButton, Section } from '../controls';
import { Txt } from '../text';

/** Wipes everything Glim Fresh knows (bridge pairing, map, moods, rituals, sandbox rooms) and restarts. */
async function startOver() {
  const b = await getBridge();
  if (b) await resetSandbox(b.id);
  await forgetBridge();
  await AsyncStorage.clear();
  await HueHttp.setTileConfig?.(null).catch(() => null);
  await HueHttp.setSleepPool?.(null).catch(() => null);
  refreshAllWidgets(null).catch(() => null);
  DevSettings.reload();
}

/** Settings → Bridge and connection, in Glim Fresh only: what the sandbox is, and starting over. */
export function SandboxSection() {
  if (!SANDBOX) return null;
  const confirm = () =>
    Alert.alert(
      'Start over from scratch?',
      'Glim Fresh forgets the bridge, the map, moods, rituals and the rooms made here, then restarts as on first launch. Your real Glim and the bridge stay as they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start over', style: 'destructive', onPress: () => startOver().catch((e) => Alert.alert('Couldn’t start over', String(e))) },
      ],
    );
  return (
    <Section title="Glim Fresh">
      <Txt size={14} tone="secondary">
        A sandbox for trying the first-time setup. It drives your real lights, but never changes the bridge: the rooms, groups, rituals
        and names you make here live only on this phone, and the bridge looks new to it. Rituals are saved but don’t run, and there’s
        no control away from home.
      </Txt>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        <PillButton title="Start over from scratch" kind="ghost" height={44} onPress={confirm} />
      </View>
    </Section>
  );
}
