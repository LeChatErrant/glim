import Constants from 'expo-constants';
import { Linking, View } from 'react-native';

import { Section } from '../controls';
import { Txt } from '../text';
import { SettingsRow } from './parts';

const REPO = 'https://github.com/LeChatErrant/glim';

/** Settings → About: the version and the commit this build was made from ("Glim 0.1.0 · a1b2c3d"). */
export function About() {
  const config = Constants.expoConfig;
  const commit = (config?.extra as { commit?: string | null } | undefined)?.commit;
  return (
    <Section title="About">
      <View>
        <SettingsRow icon="light" title={`Glim ${config?.version ?? ''}${commit ? ` · ${commit}` : ''}`.trim()} sub="A small, steady light for one home." />
        <SettingsRow icon="edit" title="Source code" sub="github.com/LeChatErrant/glim" onPress={() => Linking.openURL(REPO)} />
        <Txt size={12} tone="muted" style={{ marginTop: 8 }}>
          Talks to your Hue bridge on your Wi-Fi, and through Hue’s cloud when you’re away.
        </Txt>
      </View>
    </Section>
  );
}
