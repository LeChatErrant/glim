import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { discoverBridges, pairOnce, saveBridge, type DiscoveredBridge } from '../lib/hue/bridge';
import { fetchSnapshot } from '../lib/hue/client';
import { Body, Button } from '../ui/components';
import { theme } from '../ui/theme';

const PAIR_WINDOW_S = 30;

export default function Pair() {
  const [bridges, setBridges] = useState<DiscoveredBridge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<DiscoveredBridge | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PAIR_WINDOW_S);
  const cancelled = useRef(false);

  useEffect(() => {
    discoverBridges()
      .then(setBridges)
      .catch((e) => setError(`Couldn't search for bridges: ${e}`));
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function startPairing(bridge: DiscoveredBridge) {
    setPairing(bridge);
    setError(null);
    const deadline = Date.now() + PAIR_WINDOW_S * 1000;
    while (!cancelled.current && Date.now() < deadline) {
      setSecondsLeft(Math.ceil((deadline - Date.now()) / 1000));
      const result = await pairOnce(bridge);
      if (result.ok) {
        await saveBridge(result.config);
        await fetchSnapshot().catch(() => null);
        router.replace('/');
        return;
      }
      if (result.reason === 'error') {
        setError(result.message ?? 'Pairing failed');
        setPairing(null);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!cancelled.current) {
      setError('Timed out. Press the button on the bridge, then try again.');
      setPairing(null);
    }
  }

  if (pairing) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 20, justifyContent: 'center' }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '600' }}>Press the button on your bridge</Text>
        <Body muted>It's the large round button on top of the Hue bridge. The app connects as soon as you press it.</Body>
        <Text style={{ color: theme.text, fontSize: 48, fontWeight: '200' }}>{secondsLeft}s</Text>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <Body muted>Bridges on this network:</Body>
      {!bridges && !error && <ActivityIndicator color={theme.text} />}
      {bridges?.length === 0 && <Body>No bridge found. Make sure you're on your home Wi-Fi.</Body>}
      {bridges?.map((b) => (
        <View key={b.id} style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, gap: 12 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Hue Bridge {b.id.slice(-6)}</Text>
          <Body muted>
            {b.ip} · {b.reachable ? 'reachable' : "doesn't answer on this network"}
          </Body>
          <Button title="Pair" primary disabled={!b.reachable} onPress={() => startPairing(b)} />
        </View>
      ))}
      {error && <Text style={{ color: theme.danger }}>{error}</Text>}
    </ScrollView>
  );
}
