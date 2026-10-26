# hue-lab

A personal mobile app to control the maintainer's Philips Hue lights, talking to
the bridge over its local API (CLIP v2). Product name: **Glim** (see
[Decisions log](#decisions-log)); `hue-lab` is the repo's working name.

**Prototype for the maintainer, built to be sellable.** Ship fast for one home,
but never in a way that would need a rewrite to sell it later (see
[Keep it sellable](#keep-it-sellable)).

## Product goals

- **Main feature:** fully customizable home-screen widgets: room cards, light
  grid, mood buttons, and a **map widget** (the floor plan itself; tap a light
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
  **Scanning is error-prone: every step must be undoable** (one Undo that walks
  back through corners, rooms, names and lights), placed points must stay
  visible (numbered corners, a Start marker with an off-screen arrow), and
  near-misses are forgiven (closing within 0.4 m snaps; Finish room merges a
  last corner within 0.6 m of the first).
- **Map from scratch, in several sessions.** Never assume the Hue setup already
  exists: a user may unbox their lights and set everything up from this app.
  The scan can create Hue rooms, offers lights that are in no room, and offers
  to move a light into the room it was placed in. The map is saved after every
  change; a later scan continues it by matching 2 already-scanned corners
  (rigid 2D transform, `src/lib/map/geometry.ts`). Once lined up, the scan also
  edits the saved map in AR: redraw a room (keeps its name, Hue room and
  lights) or move any light. "Edit map" offers AR or the 2D editor. Maps are stored per bridge,
  in map coordinates (first scanned wall along +x).
- **2D map editor** (`src/app/editor.tsx`): draw rooms by hand when AR isn't
  available, and fine-tune scanned maps (drag corners/rooms/lights, add or
  delete corners, assign rooms, wall lengths shown, snapping to other corners,
  undo, turn with two fingers or ⟳ Turn). Every change is saved immediately.
  The editor shows the map in its saved orientation, and turning it there
  turns the Map tab too.
- **Moods** (Hue calls them scenes): never hardcode modes. Moods are data: a
  large library of preset moods, fully user-editable and user-creatable, plus map-aware presets that
  use light positions (e.g. night path bedroom → bathroom, gradient across the
  home, spotlight around a point).
- **Android Quick Settings tile.**
- **Rituals** (automations): sunrise wake-up, sleep fade, day rhythm (cool →
  warm white), turn lights on when arriving home (geofence). Prefer
  bridge-side rituals so they run with the phone off.
- **Works away from home:** local bridge API on home Wi-Fi, Hue Remote API
  (cloud, OAuth2, same CLIP v2 shape) everywhere else. Same code path, two
  transports.
- **Customization is a core principle.** Widgets, moods, rituals: expose
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
  map-aware moods, any bridge.
- 2026-10-22: Setup must work from a fresh, unconfigured bridge; scans can span
  several sessions; a manual 2D editor is required (AR isn't always available,
  and scans need fine-tuning).
- 2026-10-22: Design goes through Claude Design first, using
  docs/design-spec.md, before building screens.
- 2026-10-22: Visual direction chosen: **Nocturne** (bold, toned down). See
  [Design direction](#design-direction). Rejected: Blueprint (technical),
  Pebble (playful), a "refined" sans-only Nocturne, and a serif display font
  (felt like too much).
- 2026-10-22: Name chosen: **Glim** (old word for a small, steady light). Mark:
  the app's own jewel light marker (warm core, dark gap, ivory ring, glow);
  wordmark in lowercase Jost 300. Canvas with all options:
  <https://claude.ai/artifact/YXKHZbWT6s5PGMcXcQTZQJ>. Alternatives kept for
  later: Lightmap (room-glow mark), Nocturne (night-path constellation mark),
  Oriel (glowing arched window), Candela (open ring), Lucerna (wall lantern
  half pool). Store and trademark availability not yet checked: do it before
  renaming the package ID.
- 2026-10-23: Our own vocabulary, not Hue's (Hue's "scene" confuses people).
  See [Vocabulary](#vocabulary).
- 2026-10-26: Widgets follow the bridge live: a foreground service ("Live
  widgets" notification, type connectedDevice) listens to the bridge's event
  stream while the screen is on and redraws widgets on any change (physical
  switch, Hue app). Screen off = disconnected; screen on = reconnect + redraw.
- 2026-10-26: A device's kind comes from Hue's product data (a smart plug is
  a plug), its look from the device archetype the user picks ("What is it?",
  written to the bridge). Every light type has an icon (`src/lib/lightIcons.ts`)
  shown in its marker; unreachable = dashed amber ring + strike-through.
- 2026-10-26: Map orientation is saved with the map (twist or Turn left/right);
  pinch zooms, drag pans. Each Map widget can show a subset of rooms and its
  own orientation (long-press the widget → configure); its ‹ › buttons zoom
  room by room (the on/off button then switches that room) and ⟳ turns it.
- 2026-10-26: String lights, bars and lanterns can be oriented in the 2D editor
  (handle; strings also get a length); default is along the nearest wall.
  Glows breathe slowly in the app, never on widgets.
- 2026-10-26: Three separate ideas, kept apart in the UI: **rooms/groups** say
  *which* lights; a **mood** saves *how* a room or group looks, light by light;
  a **favorite** is just a color (or white) kept first in every color row
  (★ to keep the current one, long-press to add/remove). No brightness in
  favorites.
- 2026-10-26: Hue's built-in effects (candle, fire, sparkle, prism, opal,
  glisten, underwater, cosmos, sunbeam, enchant) via `effects_v2`: Effects tab
  on the light screen (with speed), Effect row on room/group sheets, saved in
  moods. Picking a color ends an effect. Candle/fire glows flicker on the map.
- 2026-10-26: Moods v1: "Save as mood" on a room or group sheet keeps each
  light's state (on/off, color or white, brightness); tap to apply, long-press
  to update/rename/delete. Stored per bridge (`src/lib/moods.ts`), applied with
  one request per light. The Moods tab lists them by room/group; each light's
  color can be kept as a favorite. Presets and map-aware moods come next.
- 2026-10-26: Continuing a map starts with its own screen ("Where do you start
  from?"): tap two corners on a full plan (any two, far apart is best; 2026-10-27,
  replaced "pick a corner, flip the wall"), then mark corner 1 and corner 2
  on the floor with a live "2.4 m of 3.1 m" readout. The AR view always shows
  a visor (ring + ticks, dashed when aiming at nothing); every placed point
  ripples on the floor and buzzes; the rubber band shows its length.
- 2026-10-26: Rooms are optional. Lights in no room show as their own cards in
  the Rooms tab ("On their own"), not inside a fake room. "Part of" on a light
  opens a picker: one room (or none, or a new one) and any groups. Room and
  group light pickers list lights under their room.
- 2026-10-26: Lights in a mapped room but not placed in it are never placed
  automatically (lights in unmapped rooms or no room are not "missing"). The
  Map tab shows a dashed note ("Hue Play 1 and Hue Play 2 aren't on your map")
  with Place (on screen: the editor opens on the light picker and each light
  lands in its room; or with the camera) and Not now (hides those lights, per
  bridge; a newly missing light shows the note again).

## Vocabulary

Use these words in UI, docs and code. Hue terms appear only in the bridge
client (`src/lib/hue/`) and when mapping to it.

- **Mood** = Hue scene: a look for some lights, from one light to the whole
  home. Our own data, not tied to one room; bridge scenes are only created
  behind the scenes when a ritual must run on the bridge. **Living mood** =
  dynamic scene.
- **Group** = Hue zone. **Room** stays Room.
- **Path:** a map-aware mood that follows a route (night path).
- **Ritual** = automation.
- **Light** for lamps, bulbs and strips; **Plug** for smart plugs;
  **Switch / Sensor** for Hue accessories.
- **Bridge** stays (printed on the box), shown in setup and settings only.

## Design direction

Two canvases:
- **Implementation target:** <https://claude.ai/artifact/Dx8ryX9uZt4sECfUHSJfUE>
  ("Nocturne app design"): every screen, state and widget in detail, organized
  in pages (Foundations, Onboarding, Map, AR scan, Lights & rooms, Scenes,
  Rituals, Widgets & tiles, Settings). Build from this one.
- **Exploration:** <https://claude.ai/artifact/Bnj4VnNDWgakb7nFkTRQ8W> ("design
  directions"): the chosen Nocturne direction plus the **Celestial** test (night
  blue, star trails around a pole star, star-chart ring around the map, lights
  as 4-point stars linked by constellation lines, astrolabe light dial). The
  maintainer likes Celestial and wants to keep the idea within reach (a future
  theme or variant), but it is not the target now.

Goal: luxury, about light, that anyone likes. **The map is the main selling
point.**

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
  The maintainer loves it: keep it as the recurring map-aware mood (Path) symbol.

## Build order

1. App skeleton, bridge pairing, rooms and lights control, 1 room widget.
2. Map: AR scan + 2D editor + map screen + map widget prototype.
3. Moods: preset library, editor, map-aware generators, mood widget.
4. Cloud access (Remote API) and arriving/leaving home geofence.
5. Quick Settings tile, sunrise wake-up, sleep fade, day rhythm.

## Stack

- **Expo (React Native)**, Android first. Widgets via
  `react-native-android-widget` (written in JS). Over-the-air updates via EAS
  Update so most changes ship without reinstalling the APK.
- iOS later: app code is shared; iOS widgets need a Swift WidgetKit target,
  kept isolated.

## Code layout

- `src/app/`: Expo Router screens; `src/app/(tabs)/` holds the 4 tabs (Map,
  Rooms, Moods, Rituals) with a custom floating tab bar. `src/lib/hue/`: bridge
  pairing and CLIP v2 client; screens read the home through `useHome()`
  (one shared store for every screen: cached state first, polling while
  focused, refresh on bridge events, optimistic `act(plan)`). `src/lib/map/`: floor
  plan model, glow geometry (`glow.ts`: which walls clip a light, nested
  rooms) and the widget SVG. `src/lib/lights.ts`: light shapes from Hue
  archetypes, labels, headline mood. `src/widgets/`: home-screen widgets and
  their task handler (registered in `index.ts`), plus the Map widget's
  configuration screen (`MapWidgetConfig.tsx`, per-widget `settings.ts`).
- `modules/hue-http/`: local Expo module (Kotlin). HTTPS to the bridge with
  certificate pinning (CN must equal the bridge ID; public key pinned at
  pairing). All bridge calls go through it; plain `fetch` can't reach the
  bridge.
- **Widget taps are native-first.** Widget providers extend
  `FastWidgetProvider` (`modules/hue-http`, wired by
  `plugins/with-fast-widgets.js`). A tap with a `FAST_*` click action carries
  the bridge request (`fastPath`, `fastBody`) and is sent from Kotlin at once
  (~0.35 s tap to light); JS only redraws. Going through the widget library's
  WorkManager + JS path took ~1.2 s. New widget actions that change lights
  should use `FAST_*`. Bridge credentials for this live in app-private
  SharedPreferences (`huelab_fast`), synced from JS at pairing and app start.
- **Live sync** (`modules/hue-http/.../LiveSync.kt`): foreground service on
  `/eventstream/clip/v2`, started from JS at app start, on widget taps, after
  boot and after an app update. It broadcasts `APPWIDGET_UPDATE` (widgets
  refetch in JS) and emits `onChange` to the running app.
- `modules/ar-scan/`: local Expo module (Kotlin + ARCore). Camera view, floor
  detection, reticle cast on the floor, right-angle snapping, AR overlay of
  outlines and light markers. JS owns the scan logic (`src/app/scan.tsx`).
- `android/` is generated by `expo prebuild` and git-ignored. Configure native
  behavior in `app.json`, config plugins, or the local modules.
- `src/ui/`: the Nocturne UI kit. `theme.ts` (tokens, fonts), `text.tsx`
  (`Label`, `Display`, `Txt`), `controls.tsx` (pill buttons, switch, slider,
  connection badge, SVG `Glow`), `icons.tsx`, `FloorPlan.tsx` (the map and the
  `Jewel` light marker). Fonts (Jost, Geist) load at startup in
  `src/app/_layout.tsx`, one family name per weight. Build new screens from
  these, not from the older `components.tsx` (still used by scan, editor and
  pairing until they are restyled). The design canvas says "Scenes": the app
  says **Moods** (see [Vocabulary](#vocabulary)).

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

Release build (what the maintainer should run day to day: JS is much faster):
`(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a)`,
then `adb install -r android/app/build/outputs/apk/release/app-release.apk`. R8
shrinking is on: libraries that use reflection need keep rules in
`expo-build-properties` → `extraProguardRules` in `app.json` (WorkManager broke
widgets until kept). If widgets go blank after an install, check `adb logcat`
for `WM-` errors first.

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
- **Multi-bridge-ready data model.** Key stored data (maps, moods, widgets) by
  bridge ID, even though the maintainer uses one.
- **Handle what the maintainer doesn't own.** Unknown light types, gradient
  strips, no rooms, 50+ lights: degrade gracefully, never crash.
- **User-facing strings in English**, kept easy to extract for i18n (French
  next). No French in UI code.
- **Dependencies:** permissive licenses only (MIT, Apache, BSD). No GPL/AGPL.
- **Naming:** the final name is a standalone brand with no "Hue" or "Philips"
  in it. Mention Hue only in descriptive text ("works with Philips Hue" in the
  store subtitle/description), never in the logo or icon, plus a "not affiliated
  with Signify" line. Third-party apps using "for Philips Hue" in their name
  have had trademark complaints on the App Store. Verify against the current
  Hue developer terms before publishing. The name is Glim; switch the package
  ID (`io.lechaterrant.huelab` today) before the first Play Store upload, as
  it is permanent once published.

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
