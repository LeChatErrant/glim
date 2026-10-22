# hue-lab: design spec

Handoff brief for the visual and interaction design of **hue-lab** (working
name), a personal Android app to control Philips Hue lights. This document
says *what* the app does and *what each screen needs*. The visual language,
layout and details are yours to propose.

---

## 1. Context

- **Who:** one person, the owner of the lights. No accounts, no sharing, no
  marketing screens. Design for a power user who wants speed and control.
- **Platform:** Android first (phone, portrait). iOS later, so avoid
  Android-only visual idioms that would have to be redesigned (a neutral,
  custom look beats strict Material 3).
- **Tech:** React Native (Expo). Home-screen widgets and the Quick Settings
  tile are rendered by Android with strict limits (see section 7).
- **Language:** UI in English. Room and light names come from the user's Hue
  setup and are in French. Design for names up to ~25 characters.

### What makes the app different

1. **Widgets first.** Most interactions should happen from the home screen
   without opening the app.
2. **The map.** The user scans the apartment with the camera (AR) in a few
   minutes, and the lights appear on a floor plan. The map is the app's home
   screen, its signature feature, and it also exists as a widget.
3. **Everything is customizable.** No hardcoded modes. Scenes, widgets and
   automations come with good presets, and everything can be edited or
   created.

---

## 2. The real home (use this data in the designs)

5 Hue rooms, 9 devices. "Color" = full color and white. "On/off" = smart plug,
no brightness or color.

| Room | Lights | Type |
|---|---|---|
| Salon | Lumière du salon | Pendant lamp, color |
| | Cuisine | Bulb, color |
| | Bureau | Hue Go (portable lamp on the desk), color |
| | Guirlande | String lights on a smart plug, on/off |
| Chambre | Lumière de la chambre | Pendant lamp, color |
| Table de nuit | Hue Play 1, Hue Play 2 | Light bars, color |
| Salle de bain | Salle de bain | Bulb, color |
| Terrasse | Terrasse | Wall lantern on a smart plug, on/off. Outdoors |

Also: 1 Hue tap dial switch (physical remote), and 2 existing scenes on the
bridge ("Base", "Lumineux").

The apartment is small. Assume Salon is the largest room and includes the
kitchen corner, Chambre and Salle de bain are next to it, and Terrasse is an
outdoor area along one side. "Table de nuit" is a Hue room but physically sits
inside Chambre (the bedside), so the map must allow a Hue room to live inside
another room's outline.

---

## 3. Design principles

1. **One tap to light.** The most common action (toggle a room, apply a
   favorite scene) is one tap from the home screen.
2. **The lights are the color.** The UI chrome stays neutral so the colors of
   the lights stand out. The light's real color and brightness should be
   visible wherever a light appears.
3. **Dark first.** The app is used most in the evening and at night. Dark
   theme is the default and must not flash bright. Light theme is still
   required.
4. **On/off is never color-only.** A light can be any color, including dark
   blue or deep red. On, off, and unreachable must differ by shape, fill or
   icon, not only hue.
5. **Defaults are great, depth is one level down.** Presets cover 90% of use.
   Customization lives behind an "Edit" or "Customize" action, never in the
   way.
6. **Fast and optimistic.** UI reflects the change instantly. Network latency
   (up to ~1 s over the cloud) never blocks the UI.

---

## 4. Navigation

Bottom navigation with 4 destinations, plus Settings from the top bar:

1. **Map** (home): the floor plan with all lights.
2. **Rooms:** list of rooms and lights, for precise control.
3. **Scenes:** library, favorites, editor.
4. **Automations:** wake-up, sleep, day rhythm, arriving home.

A persistent **connection indicator** shows how the app reaches the lights:
- **Home:** direct to the bridge on Wi-Fi (fast).
- **Cloud:** through Hue's cloud when away (slower, still works).
- **Offline:** neither works. Controls show the last known state, disabled
  with an explanation.

Keep it subtle in the first two states; only Offline deserves attention.

---

## 5. Screens

For each screen: purpose, content, interactions, and the states to design.

### 5.1 Onboarding (first launch only)

1. **Welcome:** one sentence about the app, "Get started".
2. **Find the bridge:** automatic search with a spinner. Results as a list (2
   bridges exist on this network; one may be unreachable, show it as such).
   States: searching, found, none found (with "Enter IP address").
3. **Press the link button:** illustration of the Hue bridge with its round
   button highlighted. A 30-second countdown ring. States: waiting, success,
   timed out (retry).
4. **Lights found:** summary "5 rooms, 9 lights" with the room list.
5. **Set up your map:** choose "Scan with camera" (recommended, ~3 min), "Draw
   it myself", or "Skip for now". Leads to 5.2.
6. **Control from anywhere (optional):** connect a Hue account so the app works
   away from home. "Connect" opens Hue's sign-in page; "Later" skips.
7. **Add a widget:** short visual explaining how to add a home-screen widget,
   with a "Done" button.

### 5.2 AR map scan (signature feature)

Goal: in about 3 minutes, produce an **approximately correct** floor plan
(room outlines and light positions). Precision is not the goal; speed and
delight are. One continuous camera session through the whole apartment, so
rooms line up with each other automatically.

**Flow:**

1. **Before you start:** a short illustrated checklist: turn on the lights,
   start in Salon, walk slowly. "Start scan".
2. **Find the floor:** camera view, instruction "Move your phone slowly over
   the floor". When the floor is detected, a subtle grid or dot pattern
   appears on it in AR and the app moves on by itself.
3. **Trace the room:** a reticle sits in the center of the screen, projected
   on the floor. The user aims at a corner where wall meets floor and taps
   **Add corner**. Each corner leaves a marker on the floor and a line to the
   previous one, drawn in AR. Corners snap to right angles by default
   (toggle). Close the room by aiming at the first corner or tapping "Finish
   room".
   - A **mini-map** in a corner of the screen shows the plan building up in
     2D.
   - **Undo** removes the last corner.
4. **Name the room:** a bottom sheet with chips for the Hue rooms (Salon,
   Chambre, Salle de bain, Terrasse, Table de nuit) plus "Other space" (for a
   hallway or anything without lights), with a name field.
5. **Place the lights in this room:** the sheet lists the lights of that Hue
   room. The user picks one; **the real light blinks** so they know which one
   it is. They aim the reticle at the floor right below it (or at its base for
   a lamp) and tap **Place**. A light marker appears in AR and on the
   mini-map. Repeat, or "Skip" lights they don't want to place now.
6. **Next room:** "Scan next room" (walk to it, the session keeps tracking) or
   "Finish scan".
7. **Review and fix:** a 2D editor of the result. Drag corners, drag lights,
   rename or reassign rooms, delete a room, nest a Hue room inside another
   room (Table de nuit inside Chambre), mark a room as outdoor (Terrasse,
   drawn differently). "Save map".

**States and errors to design:**
- Camera permission request (with a reason).
- Floor not found yet (after ~10 s: tips such as "Add more light", "Aim at a
  textured floor").
- Tracking lost while walking (pause overlay: "Point back at a place you
  already scanned").
- Device without AR support: skip straight to the manual editor.
- Light already placed (show it, allow moving it).
- Exit mid-scan (keep progress or discard).

**Manual fallback, "Draw it myself":** the same 2D editor as step 7, starting
empty. Add rectangular rooms, resize them, snap to a grid, then place lights
by dragging them from a tray. The "blink" helper is also available here (tap a
light in the tray to blink it).

The map can be rescanned or edited anytime from Settings or from the Map
screen.

### 5.3 Map (home screen)

The floor plan, filling most of the screen, with every placed light.

**Light markers** must show at a glance: on/off, color, brightness, type
(color vs on/off plug), unreachable. Suggestion only: a glow in the light's
color whose size or intensity follows brightness, a hollow marker when off, a
distinct shape for plugs. Your call.

**Interactions:**
- **Tap a light:** toggle it.
- **Drag up/down on a light:** brightness (live value shown while dragging).
- **Long-press a light:** opens the light sheet (5.5).
- **Tap inside a room (not on a light):** toggles the whole room.
- **Long-press a room:** opens the room sheet (5.6).
- **Lasso or two-finger select:** select several lights, then act on them
  together (on/off, brightness, color, apply scene).
- Pinch to zoom and pan (the plan should fit the screen by default).

**Also on this screen:**
- A row of **favorite scenes** (chips or small cards) for one-tap use.
- **All off** action, always reachable.
- An **Edit map** entry point.

**States:** map not set up (empty state inviting to scan, with "Draw it
myself" as secondary), loading, offline, some lights unreachable, a selection
active.

### 5.4 Rooms

A list of rooms, each showing its lights. Fallback for precise control and
for people who don't want the map.

- **Room row:** name, on/off switch, brightness slider for the whole room, a
  compact preview of its lights' current colors, count ("3 of 4 on").
- Expand a room to see individual light rows (name, type icon, switch,
  brightness).
- Tap a light to open the light sheet; tap the room title for the room sheet.

States: all off, mixed, unreachable light, plug-only room (Terrasse: no
brightness).

### 5.5 Light sheet

Bottom sheet for one light. Content depends on its capabilities:

- **Color lights:** on/off, brightness, a **Color** tab (color wheel or
  picker) and a **White** tab (warm ↔ cool temperature), recent colors, and
  "Blink" to identify it.
- **On/off lights** (plugs): on/off only, and blink. No empty space where the
  other controls would be.
- Footer: rename (writes to the Hue bridge), move on map.

### 5.6 Room sheet

Like the light sheet, for a whole room: on/off, brightness, apply a color or
white temperature to all its lights, the room's scenes, and the list of its
lights.

### 5.7 Scenes

**Principle:** scenes are data. There are no fixed modes; a large preset
library ships with the app, and everything can be duplicated and edited.

**Library screen:**
- **Favorites** at the top (these also feed widgets and the Map screen).
- **Preset categories**, e.g.:
  - Everyday: Bright, Read, Relax, Dimmed, Nightlight
  - Focus: Concentrate, Energize, Daylight
  - Evening: Sunset, Candlelight, Cozy, Movie
  - Color: Aurora, Tropical, Neon, Ocean, Forest
  - **Map-aware** (see below)
- **My scenes:** user-created ones.
- **Scenes from the Hue app** ("Base", "Lumineux"), shown as their own group.

**Scene card:** name, a preview of its colors (palette or swatches), and for
map-aware scenes a tiny map preview. Tap = apply to its target. Long-press or
"..." = edit, duplicate, favorite, delete.

**Applying a scene** asks nothing by default: each scene has a default target
(a room, several rooms, or the whole home). A quick "Apply to..." option
exists.

**Map-aware scenes** use the light positions from the map. Each is a
generator with parameters:
- **Night path:** a dim warm trail between two rooms (e.g. Chambre → Salle de
  bain). Parameters: from, to, brightness, auto-off after N minutes.
- **Gradient sweep:** a color gradient across the home along a direction.
  Parameters: 2–3 colors, direction (drag an arrow on the map).
- **Spotlight:** pick a point on the map; lights get brighter the closer they
  are. Parameters: point, radius, color.
- **Zone glow:** one color per room, picked on the map.

**Scene editor:**
- Name, icon, default target.
- Mode A, **per light:** each light in the target with its own state
  (on/off, color or white, brightness). Shown on the map *and* as a list.
- Mode B, **palette:** pick 1–5 colors and a brightness; the app spreads them
  across the lights.
- Mode C, **map generator:** parameters of a map-aware scene, with the map as
  the main editing surface.
- Options: transition time (instant ↔ slow fade), animated (colors slowly
  drift, with a speed).
- **Live preview:** the real lights update while editing, with a clear way to
  restore what was on before.
- Save, or save as new.

### 5.8 Automations

A list of automations with an on/off toggle each and a one-line summary of
the next run ("Tomorrow 7:00, Chambre"). Tap to edit. Each type has presets
and an editor:

1. **Sunrise wake-up:** lights slowly brighten before a wake-up time.
   Parameters: time, days of the week, target (default Chambre + Table de
   nuit), duration (10–60 min), final brightness and color temperature. Runs
   on the bridge, so it works with the phone off.
2. **Sleep fade:** lights dim to off over a duration. Started manually (from
   the app, a widget or the Quick Settings tile) or at a scheduled time.
   Parameters: target, duration (5–60 min), starting state.
3. **Day rhythm:** white lights follow the time of day (cool and bright
   during the day, warm and dim in the evening). Parameters: which lights, a
   curve over 24 hours (presets: Natural, Night owl, Early bird; editable
   curve with drag points), apply only when a light is turned on or
   continuously.
4. **Arriving home:** when the phone enters the area around home, turn on a
   scene. Parameters: home location and radius (map picker), scene, only
   after sunset (toggle), active hours. Can also do **Leaving home:** all off
   when leaving.

Design an onboarding moment for location permission ("Allow all the time" is
required; explain why in plain words).

### 5.9 Widget configuration

When the user adds a widget, a configuration screen opens (Android standard).
It must also be reachable later from inside the app ("Widgets" in Settings),
listing placed widgets.

Per widget type, options include: what it controls (rooms, lights, scenes,
the map), order, label visibility, size behavior, style (e.g. solid,
translucent, tinted by the light color), and corner style. Show a **live
preview** of the widget at the top of the configuration screen.

### 5.10 Settings

- **Bridge:** name, IP, connection status, re-link.
- **Away from home:** Hue account connected or not, connect/disconnect.
- **Home location:** used by Arriving home (map picker, radius).
- **Map:** rescan, edit, reset.
- **Lights and rooms:** rename (writes to the bridge), hide from the app.
- **Widgets:** list of placed widgets and their configuration.
- **Appearance:** theme (dark, light, system), accent.
- **About:** version and build ("hue-lab 0.3.1 · a1b2c3d").

---

## 6. Home-screen widgets

The main feature. Each type comes in several sizes (in Android grid cells,
columns × rows). Design each size, in dark and light, plus states.

1. **Single light / single room, 1×1:** one big toggle. Shows color and
   on/off. Tap toggles.
2. **Room card, 2×1 and 2×2:** room name, on/off, current colors, and a
   brightness control made of **steps** (e.g. 25 / 50 / 75 / 100 % or − / +),
   since widgets can't have sliders. 2×2 adds favorite scenes for that room.
3. **Light or room grid, 4×1 and 4×2:** up to 4 or 8 tiles, each a room or a
   light (user's choice), showing color and on/off. Tap toggles.
4. **Scene buttons, 4×1 and 2×2:** 2–8 scenes (user's choice), each showing
   its palette. Tap applies. Optionally includes "All off" and "Sleep fade".
5. **Map widget, 4×2, 4×3, 4×4:** the floor plan drawn small, lights shown in
   their current color and state. **Tap a light to toggle it**, tap inside a
   room to toggle the room. Light tap targets at least ~40 dp; when the plan
   is too dense at small sizes, the widget falls back to room-level taps.
   Optional strip of 2–3 scene buttons along the bottom.

**Widget states for every type:** normal, all off, partially on, updating
(just tapped, waiting for confirmation), a light unreachable, offline (last
known state, muted, with a small indicator), not configured yet.

---

## 7. Platform constraints

### Widgets (Android RemoteViews)

- **Building blocks only:** rectangles with rounded corners, text, icons,
  images. Custom shapes, blur and gradients are only possible as a pre-drawn
  image. The map in the map widget is rendered as an image.
- **Interactions:** tap only. No drag, no long-press, no sliders, no
  animation.
- **Sizes:** the user can resize widgets. Each design should say how it
  adapts between its sizes.
- **Corners:** Android 12+ clips widgets to the system corner radius.
- **Theme:** follows the system dark/light setting. Optionally uses the
  user's Material You wallpaper colors as an accent (design both with and
  without).
- **Fonts:** system font only.

### Quick Settings tile

- One tile, user picks what it controls (a room, the whole home, a scene, or
  sleep fade).
- Monochrome 24 dp icon, a label, an optional subtitle (e.g. "3 lights on").
- Two states only: active and inactive. Tap toggles, long-press opens the
  app.
- Provide the icon set for the tile (room, all lights, scene, sleep).

### AR camera view

- The camera feed fills the screen; all UI is an overlay. It must stay
  readable over any background (bright windows, dark corners).
- One-handed use while walking: primary actions within thumb reach at the
  bottom.

### Accessibility

- Touch targets at least 48 dp in the app.
- Text contrast WCAG AA in both themes, including over the camera view.
- On/off and reachable/unreachable never conveyed by color alone (see
  principle 4).

---

## 8. Visual direction

Open to your proposal. Starting points:

- **Mood:** calm, premium, a little playful during the AR scan. Not a clone
  of the Philips Hue app.
- **Palette:** neutral chrome, near-black dark theme. The only saturated
  colors on screen should usually be the lights themselves.
- **Light representation:** a consistent visual for "a light" used across
  the map, lists, widgets and scene previews. It must work tiny (widget grid)
  and large (light sheet).
- **Icons for light types:** pendant lamp, bulb, portable lamp (Hue Go),
  light bar (Hue Play), string lights, wall lantern, smart plug.
- **Motion:** quick, soft transitions when a light changes (~200–300 ms).
  AR markers should feel tactile when placed.

---

## 9. Deliverables requested

1. Visual direction: palette, type, light representation, light-type icons,
   both themes.
2. Onboarding (5.1), all steps.
3. AR scan flow (5.2), every step and error state, plus the manual editor.
   **Highest priority after widgets.**
4. Map screen (5.3) with its states and the light and room sheets (5.5,
   5.6).
5. Rooms (5.4).
6. Scenes: library, card, editor in its 3 modes, map-aware generators (5.7).
7. Automations: list and the 4 editors, location permission moment (5.8).
8. Widgets: every type and size, dark and light, all states (6), plus the
   configuration screen (5.9). **Highest priority.**
9. Quick Settings tile and its icon set (7).
10. Settings (5.10).
11. A clickable prototype of: scan → review → map → toggle a light → add a
    map widget.

Use the real rooms and light names from section 2 everywhere.

---

## 10. Out of scope for now

Music sync, a "paint" mode for coloring lights on the map, remapping the
tap dial switch, multiple homes, multiple users, tablets and landscape.
