# Glim

<img src="assets/icon.png" alt="Glim icon" width="96" align="right">

**Your home, in light.** An Android app for Philips Hue lights, built around a
floor plan of your home: scan it with your phone's camera, see every light
glowing where it really is, and tap the plan to control them, from the app or
from a home-screen widget.

Glim is a personal project, built for one home and shared as-is. It talks to
the Hue bridge directly over its local API (CLIP v2), with an optional route
through Hue's cloud when you're away.

> Works with Philips Hue. Not affiliated with or endorsed by Signify.

## What it does

- **AR floor plan scan.** Walk through the home in one AR session: tap room
  corners on the floor, name each room, then aim at the floor under each
  light (it blinks) to place it. About three minutes for a rough plan. Every
  step can be undone, and a scan can be continued later.
- **2D map editor.** Draw rooms by hand when AR isn't available, or fine-tune
  a scan: drag corners and lights, wall lengths, snapping, undo.
- **The map.** Rooms as hairline walls, each light casting a glow shaped by its
  type (pendant pool, lightstrip along the wall, string-light beads...), clipped
  to its room. Tap a light to toggle it, drag for brightness, long-press for
  color.
- **The outside.** A band of garden around the house that follows the hour and
  the live weather (rain, snow, fog, storms, fireflies), from
  [Open-Meteo](https://open-meteo.com).
- **Home-screen widgets.** A Rooms widget and a Map widget (the floor plan
  itself, animated weather included). Taps reach the bridge from native code
  in about a third of a second, and widgets follow changes made anywhere
  (switches, other apps) live.
- **Moods.** Save how a room looks, light by light, and bring it back with a
  tap. Hue's built-in effects (candle, fire, sparkle...) included.
- **Away from home.** Connect a Hue account and the same controls work over
  Hue's Remote API when the bridge isn't on your network.

**Not built yet:** rituals (sunrise wake-up, sleep fade, day rhythm, lights on
when you arrive), a preset mood library and map-aware moods (a night path from
bedroom to bathroom), a Quick Settings tile, iOS.

## Build it

You need a Hue bridge (v2) on your network and an Android phone. The AR scan
needs [ARCore support](https://developers.google.com/ar/devices); everything
else works without it.

Tools: Node 20+, JDK 21, the Android SDK, and `adb`.

```bash
npm install
npx expo prebuild --platform android --no-install
(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a)
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Open the app on the same Wi-Fi as the bridge, press the bridge's button when
asked, and you're paired. No keys to configure.

For development, build `assembleDebug` instead and run `npx expo start
--dev-client` for live reload.

### Away-from-home access (optional)

Hue's Remote API needs an OAuth client whose secret must stay off the phone,
so it goes through a tiny token server in [`server/`](server/) (Expo API
routes, deployed to EAS Hosting). Setting it up takes a Hue developer account
and four steps, written out in [CLAUDE.md → Cloud access](CLAUDE.md#cloud-access).
Without it, the app works on your home network only.

## How it's put together

- **Expo / React Native** app, Expo Router screens in `src/app/`.
- `src/lib/hue/`: pairing and the CLIP v2 client. Every request picks a route
  (bridge or cloud) in `transport.ts`.
- `src/lib/map/`: floor plan model, glow geometry, the widget's SVG.
- `src/lib/weather/`: colors of the hour, weather scenes, Open-Meteo.
- `src/widgets/`: home-screen widgets
  ([react-native-android-widget](https://github.com/sAleksovski/react-native-android-widget)).
- `modules/hue-http/`: Kotlin module for HTTPS to the bridge with certificate
  pinning, native widget taps, and the live event-stream service.
- `modules/ar-scan/`: Kotlin + ARCore camera view, floor detection and AR
  overlay. The scan logic itself lives in JS (`src/app/scan.tsx`).
- `server/`: the OAuth token server.

[CLAUDE.md](CLAUDE.md) holds the full product notes, decisions log and design
direction; [docs/design-spec.md](docs/design-spec.md) is the screen-by-screen
spec.

## Credits

- Weather data by [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Fonts: [Jost](https://fonts.google.com/specimen/Jost) and
  [Geist](https://vercel.com/font) (SIL Open Font License).
- Philips Hue is a trademark of Signify.
