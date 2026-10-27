import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { forgetBridge, getBridge, type BridgeConfig } from '../../lib/hue/bridge';
import { send } from '../../lib/hue/transport';
import { useHome } from '../../lib/hue/useHome';
import { refreshAllWidgets } from '../../widgets/task-handler';
import { PillButton, Rule, Section } from '../controls';
import { Icon } from '../icons';
import { Display, Txt } from '../text';
import { color } from '../theme';

type BridgeInfo = { name: string; model?: string; software?: string };

/** What the bridge says about itself: its device name, model and software version. */
async function bridgeInfo(b: BridgeConfig): Promise<BridgeInfo | null> {
  const r = await send(b, 'bridge', 'GET');
  const owner = (JSON.parse(r.body || '{}') as { data?: { owner?: { rid?: string } }[] }).data?.[0]?.owner?.rid;
  if (!owner) return null;
  const d = await send(b, `device/${owner}`, 'GET');
  const device = (JSON.parse(d.body || '{}') as { data?: { metadata?: { name?: string }; product_data?: { product_name?: string; software_version?: string } }[] }).data?.[0];
  if (!device) return null;
  return { name: device.metadata?.name || device.product_data?.product_name || 'Bridge', model: device.product_data?.product_name, software: device.product_data?.software_version };
}

/** Settings → Bridge: which bridge the app talks to, and disconnecting it. */
export function Bridge() {
  const router = useRouter();
  const { snapshot } = useHome(15_000);
  const [bridge, setBridge] = useState<BridgeConfig | null>(null);
  const [info, setInfo] = useState<BridgeInfo | null>(null);

  useEffect(() => {
    getBridge().then((b) => {
      setBridge(b);
      if (b) bridgeInfo(b).then(setInfo).catch(() => null);
    });
  }, []);

  function disconnect() {
    Alert.alert(
      'Disconnect this bridge?',
      'The app forgets the bridge and its Hue account link. Your map, moods and widget settings stay on this phone: pair the same bridge again to get them back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await forgetBridge();
            refreshAllWidgets(null).catch(() => null);
            router.replace('/pair');
          },
        },
      ],
    );
  }

  if (!bridge) return null;
  const counts = snapshot ? `${snapshot.lights.length} lights · ${snapshot.rooms.length} rooms` : null;
  const details = [info?.model && info.model !== info.name ? info.model : null, info?.software ? `Software ${info.software}` : null].filter(Boolean).join(' · ');

  return (
    <Section title="Bridge">
      <View>
        <Rule />
        <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 10 }}>
          <Icon name="bridge" size={20} tint={color.champagne} />
          <View style={{ flex: 1, gap: 2 }}>
            <Display size={18} weight={400}>
              {info?.name ?? 'Bridge'}
            </Display>
            {!!details && (
              <Txt size={13} tone="secondary">
                {details}
              </Txt>
            )}
            <Txt size={13} tone="secondary">
              {`${bridge.ip} · ID ${bridge.id}`}
            </Txt>
            {counts && (
              <Txt size={13} tone="secondary">
                {counts}
              </Txt>
            )}
          </View>
        </View>
        <Rule />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        <PillButton title="Disconnect bridge" kind="text" height={44} onPress={disconnect} />
      </View>
    </Section>
  );
}
