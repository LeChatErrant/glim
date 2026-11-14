# Window light

Status: **design**, 2026-11-14. Not built. Canvas:
<https://claude.ai/artifact/G9V6rrNyhv8BVchpGwtKjy> ("Glim small ideas", part 2).

Lights near a window take the light of the hour and the weather outside, the same sky the
Map tab draws around the house (`src/lib/weather/sky.ts`): apricot at sunrise, a clear blue
noon, coral at golden hour, a pearl grey when it's cloudy, a darker, cooler hour in the rain.
The inside follows the outside. In a storm, a rare and faint flicker, as if lightning were
seen through the curtains.

## Behavior

- **Which lights:** lights within 2 m of a window, in the window's room (windows are new on
  the map, see Windows below). Each one can be switched off or on by hand on its light screen
  ("Window light" row), and a light with no window nearby can join.
- **Never turns a light on or off, never touches brightness.** It only sets the color of window
  lights that are on. Brightness stays yours.
- **Steps back** when you take a light: a mood, a color picked by hand, the Hue app, a switch.
  The light shows "Window light paused" on its screen with "Back to window light"; turning
  the light off and on again also brings it back.
- **Turning on picks it up at once:** Glim's own room and group "turn on"
  (`planToggleRoom`/`planToggleZone`) sends window lights the color of the hour in the same
  request, so they don't come on in yesterday's color and then drift. Widget fast taps send a
  plain `on`; live sync sees the light come on and sends the color a second later (screen on),
  or the next tick does (screen off, up to 15 min).
- **Drifts, never jumps:** every 15 min the phone sends each window light the color of the
  moment with a 15 min transition, so the light glides through the day (Hue accepts transitions
  up to 100 min; verified).
- **Night:** a choice (below). Default: window light rests from the blue hour to sunrise, and
  the lights keep their own color.
- **Storm flicker** (switch, default on): during a storm (Open-Meteo weather code 95 to 99, or
  `lightning_potential` above a threshold where the ICON-D2 model covers it), a window light
  that is on dips by a third for 120 ms, comes back, dips once more, faintly, at random 3 to
  12 min apart. Never two lights at once by more than 300 ms (lightning is one flash seen by
  all windows, a few hundred ms apart). Never while the phone says the home is asleep (a sleep
  fade running, or Do Not Disturb's bedtime).
- **Strength** (slider): how much of the sky's color the light takes. 0 = the light's own
  white, following the sun's white only; 100% = the map's sky color as is.

## Windows on the map (new)

The map has **no windows** today (`src/lib/map/map.ts`: rooms are outlines, lights are points;
the design spec's "windows in champagne" were never built). Three ways to know which lights
are by a window:

- **A. Windows drawn on the map (recommended).** A window is a stretch of one room wall:
  `{ wall, from, to }` (wall index in the outline, ends as 0..1 along it). Drawn as a champagne
  line over the hairline wall, as the design canvas always showed. Added in the 2D editor
  (select a wall → "Add window", drag its ends; the wall's length pill shows the window's
  width) and, later, in the AR scan (an optional step per room: "Tap both sides of each
  window"). A window moves with its wall when corners move (stored relative to the wall). Gives
  the map its windows for every other use (glows that face the window, a "dawn side").
- **B. A tag on the light** ("By a window" on the light screen). Quick, needs no map, but
  draws nothing and says nothing about where daylight comes from.
- **C. Guessed from the plan.** Lights within 1.2 m of an outer wall (a wall not shared with
  another indoor room; rooms facing Terrasse count). Zero setup, often wrong (inner walls with
  no window, a hallway), so it would still need A or B to correct.

A + the per-light switch covers every case: drawn windows choose the lights, the switch
overrides.

## Screens

- **Rituals tab:** a "Window light" card next to Day rhythm (it is an automation: the outside
  drives the lights). Card: a small strip of today's window colors from sunrise to night, a dot
  for now, "Bureau, Lumière du salon · following the sky", switch.
- **Window light sheet:** led by a sentence: *"Bureau and Lumière du salon take the light
  outside: rainy morning now."* Then: Lights (map with windows in champagne; tap to add or
  remove; "Add windows on the map" when there are none), Color (A/B/C below), Strength, At
  night (rest / moonlight), Storm flicker switch, and "Today" (the strip for today's weather,
  with Settings → Weather control's forced weather and time honored, for demos).
- **Light screen:** a "Window light" row (on / paused · Back to window light / off).
- **Map tab:** windows in champagne; a window light's glow is drawn in its real color as for any
  light. No extra badge.
- **2D editor:** "Add window" in a wall's bottom sheet.
- **Turning it off:** the card's switch (all), a light's row (one light), or simply taking the
  light (pauses it). Settings → Weather on the map off also stops it (it needs the home
  location and the weather).

## Options for the maintainer (canvas, part 2)

- **Color.** A **Sky color**: the map's `near` color as is (blue noon, coral sunset). Truest
  to the map, but saturated blue light at noon reads as a party, not daylight. B **Daylight
  white**: color temperature only, from the sun (2200 K sunrise, 5500–6500 K noon, 2700 K
  golden hour), the weather cooling and greying it. Calm, but no "hour" in it. C **Tinted
  daylight (recommended)**: the daylight white mixed with the sky color at the Strength
  setting (default 35%): you can tell sunrise from noon from a rainy morning, and the room
  still looks lit.
- **Who runs it.** A **Phone (recommended)**: an exact alarm every 15 min (like `PathOff.kt`,
  `setExactAndAllowWhileIdle`, on time in Doze, a few seconds of network) reads the weather
  (cached 20 min) and sends the colors, plus live sync while the screen is on. Follows the
  weather and the real sunrise/sunset; needs the phone on. B **Bridge**: a hidden zone with the
  window lights and a smart scene with up to 6 slots a day (like Day rhythm); runs with the
  phone off, but knows no weather, holds fixed times, turns the zone on when activated and
  stops at the first change. C **Both**: the bridge carries a clear-sky day, the phone
  recolors it for the weather when it can. Most work for little gain: the phone is almost
  always on.
- **At night.** A **Rest (recommended)**: lights keep their own color from the blue hour to
  sunrise. B **Moonlight**: a pale blue-white on clear nights, warmer under clouds.
  C **Follow the map**: the night navy as is (gloomy indoors).

## How it combines

- **Moods:** applying a mood that includes a window light takes it: window light pauses on that
  light. Map-aware moods (sweep, spotlight, room glow) too.
- **Day rhythm:** both want the same lights. A rhythm's smart scene must list every light of
  its room (bridge rule), so at each slot the bridge sets the window lights to the rhythm's
  white. Options: **A. Window light wins (recommended):** Glim knows the rhythm's scenes and
  slot times, so a window light showing exactly the rhythm's look for that light isn't "taken
  by hand": the next tick takes it back (the rhythm keeps the other lights of the room). B.
  Rhythm wins: rooms with a rhythm get no window light. C. Blend: window light uses the
  rhythm's white of the hour as its base white (instead of the sun's) and tints it. C is the
  nicest and the most code; A is good enough.
- **Sunrise ritual / sleep fade running:** window light leaves those lights alone until the
  ritual ends (the bridge reports `gts_state: started` for a sleep fade; a wake-up is known
  from its time).
- **Arriving home:** the mood it applies wins (that's a mood).
- **Widgets and tile:** nothing special; window lights show their real color.

## Data model

```ts
// src/lib/map/map.ts
type MapWindow = { id: string; wall: number; from: number; to: number }; // wall = edge points[wall] → points[wall+1]
type MapRoom = { /* … */ windows?: MapWindow[] };

// src/lib/rituals/windowLight.ts, per bridge
type WindowLight = {
  enabled: boolean;
  color: 'sky' | 'daylight' | 'tinted';   // default 'tinted'
  strength: number;                       // 0..1, default 0.35
  night: 'rest' | 'moon' | 'map';         // default 'rest'
  flicker: boolean;                       // default true
  /** Lights added or removed by hand, on top of the ones near a window. */
  include: string[];
  exclude: string[];
};
// Phone-side bookkeeping (huelab_fast, read by Kotlin): what was last sent per light, to tell
// "still following" from "taken" (same test as the Moods widget's showing check: readbackHexes).
type WindowSent = Record<string /* light rid */, { xy: [number, number]; at: number }>;
```

## Technical approach

- **The color** comes from `skyAt(weather, clockHour, sun)` (pure, already shared by the app
  and the widget), mixed into light: `daylightKelvin(sky)` (from `sky.alt`, `warm`, `cloud`)
  → xy, mixed with `sky.near` in linear light by the strength (`src/lib/tints.ts` has the
  mixing), gamut-clamped per light (`src/lib/hue/color.ts`). White-only lights get the white
  only.
- **Ticks:** `WindowTick.kt`, an exact alarm every 15 min while enabled (re-armed after boot
  and update like `PathOff.kt`). Native, so it runs with the app closed: it needs the colors.
  JS precomputes **today's 96 colors** (every 15 min, for the cached weather) into
  `huelab_fast` at app start, on weather refresh, and from the geofence and widget tasks that
  already run JS; Kotlin picks the slot. When the weather cache is older than 2 h, Kotlin
  falls back to the clear-sky colors (also precomputed). A tick: `GET light` (one request),
  then for each window light that is on and still following, `PUT color` with
  `dynamics.duration` 900000 (15 min). No light on → nothing sent.
- **Live sync** (screen on) applies at once when a window light comes on.
- **Flicker:** while the weather is a storm, each tick draws 1 to 3 flicker times in the next
  15 min and sets exact alarms for them (Doze allows about one per 9 min per app: some are
  dropped in deep sleep, which suits "rare"). A flicker is
  `dimming_delta {down, k}` + `{up, k}` with `duration 0`, k = a third of the light's level
  (relative, so the light's own level is kept; never more than level − 1, or the dip clamps at
  the minimum and the way back overshoots; verified).
- **Optional real lightning:** Open-Meteo's `lightning_potential` (ICON-D2, 15 min, central
  Europe; checked that it answers for Paris) can weight the flicker rate. Live strike data
  (Blitzortung) is possible for a personal app but not needed.
- Away from home: ticks go through Hue's cloud like every request (one `GET` + a few `PUT`s per
  15 min).

## What was verified (2026-11-14, real bridge)

- `dynamics.duration` 600000 (10 min) with a color: accepted; the light reports the *target*
  color at once (so "still following" compares to what was sent, not to a mid-fade value).
  3600000 and 6000000 (100 min) accepted, 6553500 refused.
- `dimming_delta` down 30 on a lamp at 40% → 9.9%, up 30 → 39.9%, with `duration 0`. A dip
  bigger than the level clamps at the minimum and the way back doesn't land on the old level.
- A light accepts color and brightness while off (bedroom lamp put back to 98.8%, 370 mirek,
  off) — used to pre-set a window light's color so it comes on right (optional, see open q 3).
- Open-Meteo `lightning_potential` hourly and 15-minutely answer for the home's area.
- The map model has no windows (`MapRoom` is `id, name, hueRoomId, points, outdoor`).
- **Not seen:** how tinted daylight looks on real lamps (colors in the canvas come from
  `skyAt` for today's sun in Paris).

## Limits

- Phone-side: with the phone off, window lights keep their last color (the bridge doesn't
  know the weather).
- Weather is Open-Meteo's current conditions at ~1 km; a passing shower can be missed.
- Window direction (east/west) isn't used: map coordinates aren't tied to north. A later
  "north" handle on the map could make east windows brighter in the morning.
- Gradient lights take one color.

## Open questions

1. Windows: A (draw them), B (tag), or C (guess)?
2. Color A/B/C and the default strength; night A/B/C.
3. Pre-set off window lights' color every tick (so a wall switch or the Hue app turns them on
   in the hour's color)? It costs one `PUT` per off light per tick and touches lights you
   aren't using. Default no.
4. Day rhythm: A, B or C?

## Build steps

1. Map: `MapWindow` on rooms, drawn in champagne (`FloorPlan.tsx`, widget `svg.ts`), "Add
   window" in the editor (`src/ui/editor/parts.tsx`), windows kept by `geometry.ts`
   transforms and wall edits (a removed corner drops or shortens the windows on its walls).
2. `src/lib/rituals/windowLight.ts`: settings per bridge, which lights, the day's 96 colors
   (`skyAt` + daylight + mix), sync to `huelab_fast`.
3. `WindowTick.kt`: exact alarm every 15 min, following check, `PUT`s through `FastRoute`;
   live sync hook; flicker alarms.
4. Glim's room/group turn-on adds the window color; moods mark lights taken.
5. UI: Rituals card + sheet, light screen row, map windows.
6. Test on the real lights through a day (forced weather and time from Settings → Weather
   control for a fast pass), a storm forced on, a mood taking a light, a rhythm slot.
