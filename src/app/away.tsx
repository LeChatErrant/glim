import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getBridge, type BridgeConfig } from '../lib/hue/bridge';
import { cloudConfigured, disconnectCloud, finishCloudSignIn, getCloud, startCloudSignIn } from '../lib/hue/cloud';
import { useHome } from '../lib/hue/useHome';
import { Glow, IconButton, PillButton, Rule } from '../ui/controls';
import { Icon } from '../ui/icons';
import { StatusLine } from '../ui/onboarding';
import { Display, Label, Txt } from '../ui/text';
import { color } from '../ui/theme';

// Control from anywhere: connect a Hue account so lights and widgets work away from home, through
// Hue's cloud. Hue's sign-in comes back here (huelab://away?code=...&state=...), from this screen
// or from the onboarding step.

type Phase = 'loading' | 'off' | 'signing' | 'on';

export default function Away() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const { connection } = useHome();
  const [bridge, setBridge] = useState<BridgeConfig | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const b = await getBridge();
      setBridge(b);
      if (!b) return setPhase('off');
      if (params.error && handled.current !== params.error) {
        handled.current = params.error;
        setError(params.error === 'access_denied' ? 'Sign-in was cancelled.' : `Hue sign-in failed (${params.error}).`);
      }
      // Back from Hue's sign-in page with a code: finish once.
      if (params.code && params.state && handled.current !== params.code) {
        handled.current = params.code;
        setPhase('signing');
        setError(null);
        try {
          await finishCloudSignIn(b, params.code, params.state);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      setPhase((await getCloud(b.id)) ? 'on' : 'off');
    })();
  }, [params.code, params.state, params.error]);

  async function connect() {
    setError(null);
    try {
      await startCloudSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function disconnect() {
    if (!bridge) return;
    await disconnectCloud(bridge.id);
    setPhase('off');
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}>
      <Glow tint={color.champagne} cx={300} cy={40} rx={260} alpha={phase === 'on' ? 0.1 : 0.05} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, height: 48 }}>
        <IconButton icon="back" label="Back" onPress={close} />
        <Label tone="label">Connection</Label>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 26, paddingBottom: 16 }}>
        <View accessibilityRole="header">
          <Display size={34}>
            {'Control from\n'}
            <Display size={34} style={{ color: color.champagne }}>
              anywhere
            </Display>
          </Display>
        </View>
        <Txt tone="secondary" style={{ marginTop: 10 }}>
          {"Sign in with your Hue account and your lights, moods and widgets work away from home, through Hue's cloud. At home, the app still talks to your bridge directly."}
        </Txt>

        <View style={{ marginTop: 32, gap: 0 }}>
          <Rule />
          <RouteRow icon="wifi" title="At home" detail="Straight to your bridge · instant" active={connection === 'home'} />
          <Rule />
          <RouteRow icon="cloud" title="Away" detail={phase === 'on' ? "Through Hue's cloud · about a second" : 'Needs a Hue account'} active={connection === 'cloud'} />
          <Rule />
        </View>

        <View style={{ marginTop: 28, minHeight: 24, justifyContent: 'center' }}>
          {phase === 'loading' || phase === 'signing' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <ActivityIndicator color={color.champagne} size="small" />
              {phase === 'signing' && <Label>Connecting your Hue account</Label>}
            </View>
          ) : phase === 'on' ? (
            <StatusLine dot={color.connected} glow>
              Hue account connected
            </StatusLine>
          ) : null}
          {error && (
            <Txt size={13} tone="champagne" style={{ marginTop: 12, textAlign: 'center' }}>
              {error}
            </Txt>
          )}
          {!cloudConfigured && (
            <Txt size={13} tone="muted" style={{ marginTop: 12, textAlign: 'center' }}>
              {"Cloud access isn't set up in this build of the app."}
            </Txt>
          )}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 24, paddingTop: 8, gap: 4 }}>
        {phase === 'on' ? (
          <>
            <PillButton title="Done" kind="primary" onPress={close} />
            <PillButton title="Disconnect Hue account" kind="text" onPress={disconnect} />
          </>
        ) : (
          <PillButton
            title={error ? 'Try again' : 'Connect Hue account'}
            kind="primary"
            icon="cloud"
            onPress={connect}
            disabled={!cloudConfigured || !bridge || phase !== 'off'}
          />
        )}
      </View>
    </View>
  );
}

function RouteRow({ icon, title, detail, active }: { icon: 'wifi' | 'cloud'; title: string; detail: string; active: boolean }) {
  return (
    <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16 }} accessibilityState={{ selected: active }}>
      <Icon name={icon} size={20} tint={active ? color.champagne : color.secondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Display size={18} weight={400}>
          {title}
        </Display>
        <Txt size={13} tone="secondary">
          {detail}
        </Txt>
      </View>
      {active && <Label tone="champagne">Now</Label>}
    </View>
  );
}
