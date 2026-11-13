# Glim

A personal mobile app to control the maintainer's Philips Hue lights, talking to
the bridge over its local API (CLIP v2). Product name: **Glim** (see
[Decisions log](#decisions-log)). Repo `LeChatErrant/glim`, local folder
`~/Work/glim` (`~/Work/hue-lab` is a symlink kept for older sessions). A few
internal IDs still say `hue-lab`/`huelab` (see 2026-11-12).

**A personal app for the maintainer's home.** Not a product: no store release
or sale planned. The repo is public so anyone can read it or build it for
their own lights (see 2026-11-12 in the [Decisions log](#decisions-log)).

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
- 2026-10-22: Prototype for personal use. Closest official feature: Hue
  SpatialAware (2026) does an AR room scan and position-aware scenes, but
  needs a Bridge Pro, works per room, and only supports some presets. Glim's
  take: whole-home map, map widget, user-editable map-aware moods, any bridge.
  2026-11-12: **Glim won't be sold.** The repo is public, with a README for
  visitors; no store release planned. No license on purpose (all rights
  reserved): don't add one.
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
  half pool).
  2026-11-12: renamed everywhere users see it: app name, launcher and
  adaptive icons (jewel mark, `scripts/icons.mjs`), splash (`#050506` + mark),
  deep link `glim://` (`huelab://` still accepted), the app's name on the
  bridge (`glim#android`, new pairings only), server sign-in page, the Hue developer
  app (shown on Hue's sign-in page), docs, GitHub repo, local folder (after a move, delete the `.cxx` CMake caches before
  building: they hold absolute paths). Kept on purpose, internal only: package ID `io.lechaterrant.huelab`
  (a new ID installs a separate app without the map and pairing), Expo slug `hue-lab` (tied to the EAS project),
  SharedPreferences `huelab_fast`, the `hue-http` module.
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
  own orientation (long-press the widget → configure). 2026-10-27: no
  buttons over the widget's map (room-by-room arrows and turn removed): the
  configuration screen is enough.
- 2026-10-26: String lights, bars and lanterns can be oriented in the 2D editor
  (handle; strings also get a length); default is along the nearest wall.
  2026-10-27: lightstrips too, at their real length (default 2 m; a line with
  a wash along it), stretched like strings. A strip or string within 1.2 m of
  a wall and not turned by hand runs along the walls, around corners
  (`src/lib/map/wallPath.ts`): each end stretches along the outline, the light
  sits at the middle (no extra stored data), "Straight" turns it back into a
  line.
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
- 2026-10-27: Control from anywhere (Hue Remote API). Every request goes
  straight to the bridge; if it doesn't answer and a Hue account is connected,
  the app switches to the cloud route (`src/lib/hue/transport.ts`), kept across
  app and widget starts, and tries the bridge again every 20 s and on app
  resume. The bridge app key from pairing works through the cloud, so no
  second pairing. Sign-in: the app opens our server's `/api/hue/login`, Hue
  calls back `/api/hue/callback`, which hands the code to `glim://away`
  (`src/app/away.tsx`); the app swaps it through `/api/hue/token` (adds the
  client secret) and checks the account reaches *this* bridge. Tokens per
  bridge in SecureStore, refreshed ahead of expiry. Widget fast taps fall back
  to the cloud in Kotlin (token synced to `huelab_fast`). Polls slow to 10 s
  on the cloud. The server is its own small Expo project in `server/`:
  exporting API routes from the app itself fails, because Expo Router
  evaluates every app screen in Node. Not yet: live sync (event stream) away
  from home; widgets redraw on taps and every 30 min there.
- 2026-10-27: Settings is the 5th tab (`src/app/(tabs)/settings.tsx`), one
  component per section in `src/ui/settings/`, each mounted with one line.
  **Bridge** (`Bridge.tsx`): the bridge's name, model, software, address
  and ID, and Disconnect bridge (forgets it and its Hue account link; map,
  moods and widget settings stay, keyed by bridge ID, and come back on
  re-pairing). **Away from home** (`AwayFromHome.tsx`): the route in use now
  and the Hue account (connected since, last token renewal), Connect /
  Disconnect. Hue's Remote API exposes no account name, so the app can't
  say "connected as …".
- 2026-10-27: **The outside on the map** (canvas
  <https://claude.ai/artifact/MKhL1BqDP4Peeh95xcXX2v>, "Glim weather map"):
  a sky band at the top of the Map tab (sun crossing it, moon, clouds) and the
  weather around the house, cozy and lofi. Ground colors follow the hour
  (peach and rose sunrise, sunny sage noon, amber then plum sunset, indigo
  night), on a clock stretched to today's real sunrise and sunset; the
  weather recolors them (grey, rain-teal, storm-violet, snow-blue, fog-pale).
  The far outside fades to dark (pale grey in fog), a band around the house
  stays, so the home feels sheltered. Outdoor rooms stay rooms of the plan:
  the dark outdoor floor, no paving, planks or bricks (they matched nothing
  real), tinted by the light of the hour. The weather *lands* there
  while it passes by in the garden, each effect with its own twin: garden
  streaks and slow rings vs quick splash crowns, eave drips, puddles holding
  the lights and a gloss on the wet floor; falling flakes vs flakes settling
  into the cover (drifts, glitter); fog banks vs low lamp-lit mist;
  cloud shadows vs autumn leaves; fireflies
  (moths circling a lit lamp: removed 2026-11-12, they looked odd); string lights sway in a storm. Everything moves (rain, snow, fog, clouds, ripples, fireflies,
  golden dust, lightning). Live weather: Open-Meteo (no key, CC BY 4.0,
  credited in Settings) at the home's location, taken once with coarse
  location only, rounded to ~1 km, per bridge. Settings → Weather control
  forces a weather and/or a time of day (moments, a slider, "a day in a
  minute") for testing and demos; the Map tab's weather pill says when it's
  set by hand. Widgets animate too (see 2026-11-12).
  2026-10-27, later: **we only see around the house.** The outside beyond a
  band around the rooms (clear by the walls, then a soft fade over 62 dp in
  the app, 32 dp on the widget, rounding corners and filling notches) is
  the screen's own black, as if blind past a few steps from the walls
  (`darknessSvg`). No sky band, sun, moon or stars any more: the band carries
  the *ambience* of the hour, not a realistic view (the sky's colors all
  around: blue at noon, orange at golden hour, navy at night; duller under
  clouds), and the weather happens inside it. Settings → "Weather on the map"
  off brings back the plain black map and hides location and Weather control.
- 2026-11-12: **The outside is calm, and the widget plays it smoothly.**
  Everything moves slowly (snow, fireflies, leaves); lightning is rare
  and uneven (app: 10 to 30 s apart, near or far). The Map widget no longer
  flips a loop of frames (choppy at 5 to 10 fps, and the loop showed): two
  still images (ground; outdoor floors, rim and the dark) with animated
  vectors between and over them, played by the launcher at the screen's rate.
  Each animation is a ProgressBar layout written by `scripts/widget-fx.mjs`
  (run it, then rebuild): full fields (one vector per weather: one big vector
  is cheaper to redraw than three) and placed ones (fireflies, rings,
  drips, settling flakes, leaves) in variants with their own period and
  phase, so nothing moves in step and the scene never visibly loops.
  `WidgetOutside.kt` adds them as stable views in `glim_fx` (in the app's
  override of the library's `rn_widget.xml`, written by
  `plugins/with-fast-widgets.js`): a redraw keeps them running. Placing them
  needs Android 12 (older: full fields only).
- 2026-11-12: **Daytime weather looks**, picked from options
  (<https://claude.ai/artifact/Ww2BdTupJwwwvASaH1m9vT>, "Glim weather looks"):
  the ground's colors are written per hour in `sky.ts` and always saturated
  (a greyish hour reads as fog): rose sunrise, periwinkle, aqua morning,
  cerulean noon, violet, coral golden hour (palette replaced by **weather
  colors**, below). Cloudy is a **pearl sky**:
  silvery, tinted by the hour, with the same calm life as a clear day (see
  the rollback below). Fog is a
  **milky veil**: past the band the world dissolves into the fog's color
  instead of black, long banks roll by, lamps glow out into the mist.
- 2026-11-12: **Map widget: weather corner and background.** Top left, the
  weather's icon and a big "11°" in Jost light (the weather's name when set
  by hand), picked from options
  (<https://claude.ai/artifact/R5mTAmHer3T6xpayqURJZb>, "Glim weather looks,
  round 2"). Each Map widget picks its background in its configuration
  screen: Black (default), See-through (the garden fades into the
  wallpaper, `bandMask`), Smoked glass (a dark card at 55%). Animations
  can't be clipped, so on the last two the weather falls across the whole
  widget; text gets a soft shadow on See-through. Lamps spill only a little
  light past the walls (small pools sharing one budget, faded with the
  band; a fainter house halo): at night the garden stays night.
- 2026-11-12: **Weather looks, round 2 and 3: tried, then rolled back.**
  A snow cover in the hour's light, ink blue rain, rose and lilac fog and
  cloudy at low sun, and dandelion seeds on cloudy days (options:
  <https://claude.ai/artifact/R5mTAmHer3T6xpayqURJZb>,
  <https://claude.ai/artifact/SRoDdzNe9UNqw3oJNxDZHH>) all shipped, then the
  maintainer disliked every one on real renders
  (<https://claude.ai/artifact/4PhaMEeUGXqee1d75NQ2Fv>). Snow, rain and fog
  are back to the earlier look. Cloudy keeps its pearl colors and now has
  **the same animations as clear** (golden dust, fireflies): no
  leaves, seeds or wisps (rollback check:
  <https://claude.ai/artifact/KyANrWN4djtdYr1qdM4nJa>). Every visual change
  now comes with a before/after of real renders.
- 2026-11-12: **Weather colors**, picked from three palettes per weather
  (<https://claude.ai/artifact/6FhBExVDbYTHiBnnaN7Qa1>, "Glim weather
  colors"). Greying the clear sky for each weather turned warm hours to mud,
  so each weather now has **its own colors, written hour by hour** in
  `sky.ts` (only rain still derives from clear). Clear: **two-tone skies**,
  the horizon's color by the walls and the zenith's further out (apricot to
  periwinkle, mint to blue, bright sky to deep blue, gold to magenta, coral
  to indigo). Cloudy: a **low ceiling**, even slate warm by the house, with
  the still mottling of a cloud base (`cloudBaseSvg`) and lamps glowing a
  little by day. Rain: the **wet hour**, clear's colors darker and cooler.
  Storm: **charcoal blue**. Snow: **icy blue** (flakes get a soft dark edge
  to show on it; the snow day's cloud shadows are gone). Fog: **deep blue
  mist**, navy past the house. Moths around outdoor lamps are removed.
- 2026-11-13: **Mood presets and night paths.** Presets
  (`src/lib/moodPresets.ts`, Everyday, Focus, Evening, Color) are palettes
  spread round the lights of the room or group picked under "For" on the
  Moods tab (or the whole home), in their order across the map so
  neighbours differ. White-only lights take the preset's white; Candlelight
  and Fireside play the Hue effect where the light has it; smart plugs are
  left as they are. Long-press keeps a preset as my mood (light by light).
  **Paths** (`src/lib/map/route.ts`): from one map room to another. Rooms link
  where their walls face each other (parallel, overlapping, at most 0.45 m
  apart for wall thickness, at least 0.6 m long; rooms touching at a corner
  don't link) or where one sits inside the other; the route goes through the
  middle of each shared wall (shortest walk, outdoor rooms cost 5 m extra).
  Lights within 1.6 m of the route in the rooms walked (and rooms inside
  them) light up, at least the nearest one in each room; never plugs. A path
  is stored as a recipe (`Mood.path`) and worked out at each apply, so it
  follows map changes. Options: warm white, amber or red, brightness, other
  lights left or turned off. Not yet: auto-off after N minutes (needs a
  bridge-side timer, with rituals), gradient sweep, spotlight, room glow,
  the mood editor, the mood widget, scenes from the Hue app.
- 2026-11-13: **Moods widget** (4×1, resizable): mood buttons, each its
  colors as glowing dots (a path gets the night path mark) and its name (two
  lines when the tile is tall enough). Up to 8, picked in order on its
  configuration screen (long-press → Settings): my moods, paths, presets
  (whole home), All off. Default: my moods and paths, then Relax, Bright,
  Nightlight, Movie, All off last; a small widget keeps All off as its last
  button. Tap = `FAST_APPLY_MOOD`: the tap carries `fastBatch` (one
  [path, body] per light, built at render) and Kotlin sends it at once, the
  first request finding the route, the rest 4 at a time. A button has a
  champagne edge while the lights look like it (on/off, brightness ±4,
  color, white in white mode); the tapped one is held for 4 s.
  `registerWidgetConfigurationScreen` takes one screen: `WidgetConfig.tsx`
  picks the screen by widget name.

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

Goal: luxury, about light, that anyone likes. **The map is the main
feature.**

- **Palette:** near-black ground `#050506`, warm ivory text `#F2E8D8`, muted
  `#8F887D`, one champagne accent `#E9CF9F`. Hairlines (1px, ivory at 10–24%)
  instead of filled cards. The only saturated colors are the lights.
- **Type:** Jost light (300) for headlines, names and big numbers; Geist for UI
  text; small spaced capitals (Geist 500, 9–10px, 0.16em) for labels. No serif.
- **Map:** rooms are free polygons (scanned homes aren't rectangles), walls as
  hairlines, windows in champagne, door swings. Each light casts a glow clipped
  to its room's walls, shaped by its type: pendant = wide soft pool, bulb =
  round pool, Hue Go = small pool, light bar = wash along the wall, lightstrip
  = glowing line at its real length with a wash along it (turning at corners
  when it runs along the walls), string
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

- `src/app/`: Expo Router screens; `src/app/(tabs)/` holds the 5 tabs (Map,
  Rooms, Moods, Rituals, Settings) with a custom floating tab bar. `src/lib/hue/`: bridge
  pairing and CLIP v2 client; screens read the home through `useHome()`
  (one shared store for every screen: cached state first, polling while
  focused, refresh on bridge events, optimistic `act(plan)`). `src/lib/map/`: floor
  plan model, glow geometry (`glow.ts`: which walls clip a light, nested
  rooms) and the widget SVG. `src/lib/lights.ts`: light shapes from Hue
  archetypes, labels, headline mood. `src/lib/moods.ts` (saved moods, paths,
  `planLights`) and `src/lib/moodPresets.ts` (the preset library);
  `src/lib/map/route.ts` routes paths through the map. `src/widgets/`: home-screen widgets and
  their task handler (registered in `index.ts`), plus the Map widget's
  configuration screen (`MapWidgetConfig.tsx`, per-widget `settings.ts`) and
  its outside (`outside.ts`).
- `src/lib/weather/`: the outside. `sky.ts` (colors of the hour, recolored by
  the weather; pure), `scene.ts` (SVG pieces shared by the app and the
  widget, seamless particle tiles, widget frame loops), `source.ts` (Open-Meteo,
  home location, forced weather/time, `useOutside()`). `src/ui/Outside.tsx`
  draws it behind the Map tab (static SVG + Animated layers).
- `src/lib/hue/transport.ts` picks the route (bridge or Hue's cloud) for every
  CLIP v2 request; `src/lib/hue/cloud.ts` holds the Hue account (sign-in,
  tokens, Remote API requests). `server/`: separate Expo project, API routes
  only, deployed to EAS Hosting (see [Cloud access](#cloud-access)).
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
  Bridge connections stay pooled (no `disconnect()`; the bridge keeps idle
  ones for minutes), and live sync opens one when the screen turns on, so a
  tap skips the TCP + TLS handshakes (~15 ms instead of 130 to 430 ms).
  Widget taps that turn lights on send `dynamics.duration: 0` (no fade).
  **Never send a duration with `on: false`:** Hue then dims the light to its
  minimum on the way out, and it comes back on at ~0% (2026-11-13: every
  widget "off" did this for a day, the glows on the map shrank to nothing).
- A tap may carry several requests: `fastBatch`, a JSON array of [path, body]
  (moods, one request per light; `moodRequests` in `src/lib/moods.ts`).
- **Map widget tap areas** (`src/lib/map/hitAreas.ts`): the widget library
  stacks tap areas sorted by id *as text* (`0-10` before `0-2`), so
  overlapping areas are unreliable. The plan is cut into non-overlapping
  rectangles on an 8 dp grid: each light owns ~26 dp around it (split with
  neighbours, kept in its room), the rest follows each room's real outline.
  Tap feedback is a small round glow (`glim_touch`, written by the plugin
  over the library's `rn_widget_clickable.xml`), not a rectangle ripple.
- **Widget redraws flicker**, so `task-handler.tsx` skips a redraw identical
  to one made in the last 15 s, and holds a tapped state for 4 s (the bridge
  reports a room's lights one by one), then checks the real state once.
- **Live sync** (`modules/hue-http/.../LiveSync.kt`): foreground service on
  `/eventstream/clip/v2`, started from JS at app start, on widget taps, after
  boot and after an app update. It broadcasts `APPWIDGET_UPDATE` (widgets
  refetch in JS) and emits `onChange` to the running app.
- `modules/ar-scan/`: local Expo module (Kotlin + ARCore). Camera view, floor
  detection, reticle cast on the floor, right-angle snapping, AR overlay of
  outlines and light markers. JS owns the scan logic (`src/app/scan.tsx`).
- `android/` is generated by `expo prebuild` and git-ignored. Configure native
  behavior in `app.json`, config plugins, or the local modules.
- `src/ui/settings/`: one component per Settings section.
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

## Code rules

- **No home-specific data in code.** Bridge IP/ID, room and light names live in
  storage, discovered at runtime. The values under "Hue bridge" below are for
  dev and testing only.
- **Handle any setup, not just this home.** Several bridges (stored data is
  keyed by bridge ID), unknown light types, gradient strips, no rooms, 50+
  lights: degrade gracefully, never crash.
- **User-facing strings in English.**

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

## Cloud access

Away-from-home control needs our token server (`server/`) and a Hue developer
app. One-time setup, in this order:

1. `cd server && npm install && npx eas-cli login && npx eas-cli init`, then
   `npm run deploy` and pick the subdomain. Live: `https://glim-server.expo.app`
   (Expo project `@lechaterrant/glim-server`). Routes answer 503 until step 3.
   If the production URL says "No worker deployment was found", run
   `npx eas-cli deploy:alias --prod --id <deployment id>`.
2. On <https://developers.meethue.com> → Remote Hue API appids → add an app
   with callback URL `https://<subdomain>.expo.app/api/hue/callback`. Note the
   ClientId and ClientSecret.
3. `npx eas-cli env:set production --name HUE_CLIENT_ID --visibility
   plaintext`, same for `HUE_CLIENT_SECRET` with `--visibility sensitive`
   (not `secret`: `eas deploy` can't read secret variables, so the server
   would never get it), then `npm run deploy` again.
4. Set `expo.extra.cloudServer` in `app.json` to the server URL and rebuild.
   With it empty, onboarding skips the cloud step and the connection screen
   (tap the status badge) says cloud access isn't set up.

Redeploy the server with `cd server && npm run deploy` after changing it. The production URL
can keep serving the previous deployment for about a minute.

## Secrets

- Real values live in `.env` (git-ignored). Template: `.env.example`.
- **The repo is public.** Never commit `.env`, the app key, the client key or
  the Hue client secret, and never bake them into a build.

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
