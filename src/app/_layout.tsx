import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { theme } from '../ui/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'hue-lab' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair your bridge' }} />
        <Stack.Screen name="scan" options={{ headerShown: false }} />
        <Stack.Screen name="map" options={{ title: 'Map' }} />
        <Stack.Screen name="editor" options={{ title: 'Edit map' }} />
      </Stack>
    </>
  );
}
