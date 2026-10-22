# hue-lab

A personal mobile app to control the maintainer's Philips Hue lights, talking to
the bridge over its local API (CLIP v2). Working name, to be renamed.

## Product goals

- **Main feature:** fully customizable home-screen widgets: room cards, light
  grid, scene buttons, and a **map widget** (the floor plan itself; tap a light
  to toggle it).
- **Map:** a floor plan of the home with the lights placed on it. Tap to toggle,
  drag for brightness, long-press for color. Setup: import a floor-plan image
  and trace it, then place lights with "blink and tap" (the app flashes a
  light, the user taps where it is).
- **Scenes:** never hardcode modes. Scenes are data: a large library of preset
  scenes, fully user-editable and user-creatable, plus map-aware presets that
  use light positions (e.g. night path bedroom → bathroom, gradient across the
  home, spotlight around a point).
- **Android Quick Settings tile.**
- **Automations:** sunrise wake-up, sleep fade, day rhythm (cool → warm white),
  turn lights on when arriving home (geofence). Prefer bridge-side automations
  so they run with the phone off.
- **Works away from home:** local bridge API on home Wi-Fi, Hue Remote API
  (cloud, OAuth2, same CLIP v2 shape) everywhere else. Same code path, two
  transports.
- **Customization is a core principle.** Widgets, scenes, automations: expose
  options and presets instead of fixed behavior.
- Out of scope for now: paint mode, tap dial remapping, music sync.

## Stack

- **Expo (React Native)**, Android first. Widgets via
  `react-native-android-widget` (written in JS). Over-the-air updates via EAS
  Update so most changes ship without reinstalling the APK.
- No local Android SDK on the maintainer's Mac: build APKs with EAS Build.
- iOS later: app code is shared; iOS widgets need a Swift WidgetKit target,
  kept isolated.

## Platforms

- **Android is the primary target.** Design, test and ship for Android first.
- **Keep iOS working where it's cheap.** Prefer cross-platform code and
  libraries; don't pick an Android-only approach when a cross-platform one costs
  about the same. Platform-specific pieces (e.g. home-screen widgets, which are
  native on both OSes) are fine, but keep them isolated so an iOS version can be
  added later.
- **Auto-update on deploy is a strong preference** (the maintainer's other app,
  Ream, is a PWA for this reason), but not a hard constraint. It must not block
  the main feature (widgets).

## Hue bridge

- Bridge `192.168.1.143` (ID `ecb5fafffe936332`), HTTPS with a certificate
  signed by Signify's private Hue root CA (not publicly trusted).
- A second bridge (`192.168.1.175`, ID `ecb5fafffeaca9c5`) appears in
  `discovery.meethue.com` but didn't answer on the local network.
- Auth: header `hue-application-key: $HUE_APP_KEY`. API base:
  `https://<bridge>/clip/v2/resource/...`.

## Secrets

- Real values live in `.env` (git-ignored). Template: `.env.example`.
- Never commit `.env`, the app key or the client key, and never bake them into
  a public build.

## Shipping: commit, push and deploy by default

The maintainer is the sole user and wants to iterate fast. **Don't ask before
committing, pushing or deploying.** After every piece of work:

1. Commit (stage only the relevant files, never `git add -A` blindly).
2. Push to `main`.
3. Deploy, if the change touches the shipped app, and watch the deploy run to
   success.
4. Report: what shipped, old → new version, and the run result.

Only hold off when the build is red, the work is knowingly incomplete, or the
maintainer says not to. When in doubt, ship. The exact deploy procedure will be
documented here once the stack and pipeline exist.
