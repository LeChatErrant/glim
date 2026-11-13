import { Geist_400Regular, Geist_500Medium } from '@expo-google-fonts/geist';
import { Jost_200ExtraLight, Jost_300Light, Jost_400Regular } from '@expo-google-fonts/jost';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { color, font } from '../ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => null);

export default function RootLayout() {
  const [loaded, failed] = useFonts({ Jost_200ExtraLight, Jost_300Light, Jost_400Regular, Geist_400Regular, Geist_500Medium });
  const ready = loaded || !!failed;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => null);
  }, [ready]);

  if (!ready) return null;
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color.ground },
          headerTintColor: color.ivory,
          headerTitleStyle: { fontFamily: font.display, fontSize: 20 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: color.ground },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ headerShown: false }} />
        <Stack.Screen name="editor" options={{ title: 'Edit map' }} />
        <Stack.Screen name="light/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="mood" options={{ headerShown: false }} />
        <Stack.Screen name="away" options={{ headerShown: false }} />
        <Stack.Screen name="room/[id]" options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      </Stack>
    </>
  );
}
