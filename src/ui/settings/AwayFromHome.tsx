import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { getBridge, type BridgeConfig } from '../../lib/hue/bridge';
import { cloudConfigured, disconnectCloud, getCloud, startCloudSignIn, watchCloud, type CloudAccount } from '../../lib/hue/cloud';
import { useHome } from '../../lib/hue/useHome';
import { PillButton, Rule, Section } from '../controls';
import { Icon, type IconName } from '../icons';
import { Display, Txt } from '../text';
import { color } from '../theme';

/**
 * Settings → Away from home: connect a Hue account so lights and widgets work through Hue's cloud
 * when the bridge doesn't answer. Shows which route requests take right now. Hue's sign-in page
 * comes back to /away (src/app/away.tsx), which finishes the sign-in.
 */
export function AwayFromHome() {
  const { connection } = useHome(15_000);
  const [bridge, setBridge] = useState<BridgeConfig | null>(null);
  const [account, setAccount] = useState<CloudAccount | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current: string | null = null;
    getBridge().then(async (b) => {
      setBridge(b);
      current = b?.id ?? null;
      setAccount(b ? await getCloud(b.id) : null);
    });
    const stop = watchCloud((bridgeId, next) => {
      if (bridgeId === current) setAccount(next);
    });
    return () => {
      stop();
    };
  }, []);

  async function connect() {
    setError(null);
    try {
      await startCloudSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const now =
    connection === 'home'
      ? { icon: 'wifi' as const, title: 'At home', detail: 'Straight to your bridge' }
      : connection === 'cloud'
        ? { icon: 'cloud' as const, title: 'Away', detail: "Through Hue's cloud · about a second per change" }
        : { icon: 'warning' as const, title: 'Offline', detail: account ? "Neither your bridge nor Hue's cloud answers" : "Your bridge doesn't answer" };

  return (
    <Section title="Away from home">
      <Txt size={14} tone="secondary">
        {"Connect your Hue account and your lights, moods and widgets work anywhere, through Hue's cloud. At home, the app still talks to your bridge directly."}
      </Txt>
      <View style={{ marginTop: 8 }}>
        <Rule />
        <Row icon={now.icon} label="Now" title={now.title} detail={now.detail} lit={connection !== 'offline'} />
        <Rule />
        <Row
          icon="cloud"
          label="Hue account"
          title={account ? 'Connected' : account === null ? 'Not connected' : '…'}
          detail={account ? accountDetail(account) : cloudConfigured ? 'Needed to reach your lights away from home' : "Cloud access isn't set up in this build of the app"}
          lit={!!account}
        />
        <Rule />
      </View>
      {error && (
        <Txt size={13} tone="champagne">
          {error}
        </Txt>
      )}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        {account ? (
          <PillButton title="Disconnect Hue account" kind="text" height={44} onPress={() => bridge && disconnectCloud(bridge.id)} />
        ) : (
          <PillButton
            title={error ? 'Try again' : 'Connect Hue account'}
            kind="primary"
            icon="cloud"
            height={44}
            onPress={connect}
            disabled={!cloudConfigured || !bridge || account === undefined}
          />
        )}
      </View>
    </Section>
  );
}

function Row({ icon, label, title, detail, lit }: { icon: IconName; label: string; title: string; detail: string; lit: boolean }) {
  return (
    <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 10 }} accessibilityLabel={`${label}: ${title}. ${detail}`}>
      <Icon name={icon} size={20} tint={lit ? color.champagne : color.secondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Display size={18} weight={400}>
          {title}
        </Display>
        <Txt size={13} tone="secondary">
          {detail}
        </Txt>
      </View>
    </View>
  );
}

function accountDetail(a: CloudAccount) {
  const parts: string[] = [];
  if (a.connectedAt) parts.push(`Since ${new Date(a.connectedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
  if (a.refreshedAt) parts.push(`renewed ${ago(a.refreshedAt)}`);
  return parts.length ? parts.join(' · ') : 'Reaches your bridge';
}

function ago(t: number) {
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
