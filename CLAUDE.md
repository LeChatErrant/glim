# hue-lab

A personal mobile app to control the maintainer's Philips Hue lights, talking to
the bridge over its local API (CLIP v2). Working name, to be renamed.

**Prototype for the maintainer, built to be sellable.** Ship fast for one home,
but never in a way that would need a rewrite to sell it later (see
[Keep it sellable](#keep-it-sellable)).

## Product goals

- **Main feature:** fully customizable home-screen widgets: room cards, light
  grid, scene buttons, and a **map widget** (the floor plan itself; tap a light
  to toggle it).
- **Map:** a floor plan of the home with the lights placed on it. Tap to toggle,
  drag for brightness, long-press for color.
- **AR map scan: the maintainer's favorite feature, in scope now (not later).**
  One continuous AR session (ARCore on Android, ARKit on iOS) through the whole
  home: detect the floor, tap room corners on the floor (snap to right angles),
  name each room from the Hue rooms, then place lights (the real light blinks,
  the user aims at the floor below it and taps). Goal: an *approximately*
  correct simple layout in ~3 minutes. Speed over precision; keep it simple.
  Then a 2D review editor. Fallback: draw the plan manually in the same editor.
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
- **Every feature listed above will be implemented.** Out of scope for now:
  paint mode, tap dial remapping, music sync.
- The full screen-by-screen spec is in [docs/design-spec.md](docs/design-spec.md)
  (written as a handoff to Claude Design). Keep it in sync when scope changes.

## Decisions log

- 2026-10-22: Native app (Expo), not a PWA. A PWA can't create Android widgets,
  and browsers can't reach the bridge (untrusted certificate, Chrome blocks
  public sites from calling local IPs).
- 2026-10-22: Away-from-home control via the Hue Remote API. The OAuth client
  secret stays server-side (EAS Hosting API route), never in the app bundle.
- 2026-10-22: AR scan is part of the first map phase, not a later extra.
- 2026-10-22: Prototype for personal use, but keep it sellable (paid app, Hue
  Essentials-style). Repo stays private, no open-source license. Main
  competitor feature: Hue SpatialAware (official app, 2026) does an AR room scan
  and position-aware scenes, but needs a Bridge Pro, works per room, and only
  supports some presets. Our edge: whole-home map, map widget, user-editable
  map-aware scenes, any bridge.
- 2026-10-22: Design goes through Claude Design first, using
  docs/design-spec.md, before building screens.
- 2026-10-22: Visual direction chosen: **Nocturne** (bold, toned down). See
  [Design direction](#design-direction). Rejected: Blueprint (technical),
  Pebble (playful), a "refined" sans-only Nocturne, and a serif display font
  (felt like too much).

## Design direction

Mockups: <https://claude.ai/artifact/Bnj4VnNDWgakb7nFkTRQ8W> (map, other homes,
light control, AR scan, widgets). Goal: luxury, about light, that anyone likes.
**The map is the main selling point.**

- **Palette:** near-black ground `#050506`, warm ivory text `#F2E8D8`, muted
  `#8F887D`, one champagne accent `#E9CF9F`. Hairlines (1px, ivory at 10–24%)
  instead of filled cards. The only saturated colors are the lights.
- **Type:** Jost light (300) for headlines, names and big numbers; Geist for UI
  text; small spaced capitals (Geist 500, 9–10px, 0.16em) for labels. No serif.
- **Map:** rooms are free polygons (scanned homes aren't rectangles), walls as
  hairlines, windows in champagne, door swings. Each light casts a glow clipped
  to its room's walls, shaped by its type: pendant = wide soft pool, bulb =
  round pool, Hue Go = small pool, light bar = wash along the wall, string
  lights = row of beads with small glows, wall lantern = half pool away from the
  wall. Size and strength follow brightness; off = dark.
- **Light markers:** small jewel (color core, dark gap, ivory ring, glow); smart
  plugs are diamonds, light bars are capsules; off = hollow outline. Selected
  light: champagne ring + floating label (name · type · level).
- **Ambient:** a faint warm glow at the top of the screen that fades as lights
  turn off. Headline reacts to the house ("The house is warmly lit").
- **Night path icon:** dashed trajectory with 3 glowing dots ("constellation").
  The maintainer loves it: keep it as the recurring map-aware scene symbol.
- **Naming:** bottom nav says "Rituals" for automations (suggested, not yet
  confirmed by the maintainer).

## Build order

1. App skeleton, bridge pairing, rooms and lights control, 1 room widget.
2. Map: AR scan + 2D editor + map screen + map widget prototype.
3. Scenes: preset library, editor, map-aware generators, scene widget.
4. Cloud access (Remote API) and arriving/leaving home geofence.
5. Quick Settings tile, sunrise wake-up, sleep fade, day rhythm.

## Stack

- **Expo (React Native)**, Android first. Widgets via
  `react-native-android-widget` (written in JS). Over-the-air updates via EAS
  Update so most changes ship without reinstalling the APK.
- iOS later: app code is shared; iOS widgets need a Swift WidgetKit target,
  kept isolated.

## Code layout

- `src/app/`: Expo Router screens. `src/lib/hue/`: bridge pairing and CLIP v2
  client. `src/lib/map/`: floor plan model and SVG rendering. `src/widgets/`:
  home-screen widgets and their task handler (registered in `index.ts`).
- `modules/hue-http/`: local Expo module (Kotlin). HTTPS to the bridge with
  certificate pinning (CN must equal the bridge ID; public key pinned at
  pairing). All bridge calls go through it; plain `fetch` can't reach the
  bridge.
- `modules/ar-scan/`: local Expo module (Kotlin + ARCore). Camera view, floor
  detection, reticle cast on the floor, right-angle snapping, AR overlay of
  outlines and light markers. JS owns the scan logic (`src/app/scan.tsx`).
- `android/` is generated by `expo prebuild` and git-ignored. Configure native
  behavior in `app.json`, config plugins, or the local modules.
- The UI look (`src/ui/theme.ts`) is a placeholder; restyle it to match
  [Design direction](#design-direction).

## Local Android builds

The Android SDK is installed via Homebrew (`android-commandlinetools`), with
JDK 21 from `openjdk@21`:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$PATH"
npx expo prebuild --platform android --no-install   # after native config changes
(cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
npx expo start --dev-client   # JS changes reload live over USB (adb reverse tcp:8081 tcp:8081)
```

The maintainer's phone is a Pixel 11 Pro XL (ARCore supported), connected over
USB debugging. Use `adb exec-out screencap -p > shot.png` to check the screen
and `adb logcat` for native errors.

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

## Keep it sellable

Cheap rules now, so selling later is extra work and not a rewrite. None of these
should slow down the prototype; if one does, ask.

- **No home-specific data in code.** Bridge IP/ID, room and light names live in
  storage, discovered at runtime. The values under "Hue bridge" below are for
  dev and testing only.
- **Multi-bridge-ready data model.** Key stored data (maps, scenes, widgets) by
  bridge ID, even though the maintainer uses one.
- **Handle what the maintainer doesn't own.** Unknown light types, gradient
  strips, no rooms, 50+ lights: degrade gracefully, never crash.
- **User-facing strings in English**, kept easy to extract for i18n (French
  next). No French in UI code.
- **Dependencies:** permissive licenses only (MIT, Apache, BSD). No GPL/AGPL.
- **Naming:** the final name must not contain "Philips" or "Hue" as its own
  brand ("… for Hue" style only, per Signify's brand rules). Pick it before the
  first Play Store upload: the package ID `io.lechaterrant.huelab` is permanent
  once published.

## Hue bridge

- Bridge `192.168.1.143` (ID `ecb5fafffe936332`), HTTPS with a certificate
  signed by Signify's private Hue root CA (not publicly trusted).
- A second bridge (`192.168.1.175`, ID `ecb5fafffeaca9c5`) appears in
  `discovery.meethue.com` but didn't answer on the local network.
- Auth: header `hue-application-key: $HUE_APP_KEY`. API base:
  `https://<bridge>/clip/v2/resource/...`.
- Display names: use the **device** name (`device.metadata.name`), not the
  light resource name, which is often a default like "Hue color lamp 3".
- Home: 5 rooms (Salon, Chambre, Table de nuit, Salle de bain, Terrasse),
  9 lights (2 are on/off smart plugs: Guirlande, Terrasse), 1 tap dial switch.
  "Table de nuit" sits physically inside Chambre.

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
