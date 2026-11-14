# Ambilight TV

Design for the Philips TV and Glim working together (2026-11-14). Status: **design + probe of
the real TV, no app code.**
Canvas: <https://claude.ai/artifact/L3zbSbEF6QvtF7JwSiTnqn> ("Glim Ambilight TV": the TV on the real plan,
2 to 3 options for each choice, the screens).

The TV already knows how to light the room (Ambilight on the wall, Ambilight+Hue for the lamps).
Glim's part is what the TV can't do: know **where** the TV and the lights are, set the evening
around it (Watching TV), make the TV one more light in moods, and keep the TV and Listening room
from fighting over the bridge's single stream.

## 1. What the TV exposed (tested 2026-11-14)

### The TV

| | |
|---|---|
| Model | **Philips 65OLED887/12** (2022 OLED+, Android TV), name "Télé" |
| Found by | Not visible while off (deep standby answers nothing). On: a sweep of the LAN for port 1926 found it at a DHCP address; it also answers on 1925, 8008 and 8009 (Chromecast built in). Before it was on, the **bridge** gave it away: its v1 whitelist holds an entry named `65OLED887/12`, created 2023-09-12 (Ambilight+Hue pairing), last used 2026-09-20. |
| API | JointSpace **6.1.0**, HTTPS on **1926** (self-signed). `http://…:1925/6/system` answers empty; `/1/` and `/5/` 404. |
| Without pairing | Only `GET /6/system`: name, menu language, country, `api_version`, `featuring` (`ambilight: [LoungeLight, Hue, Ambilight, HueStreaming]`, `pairing_type: digest_auth_pairing`, `secured_transport: true`), `os_type: MSAF_2019_P`, and model/serial/software **encrypted**. Everything else: 401. |
| Pairing | `POST /6/pair/request` (scope read/write/control, a device block with a random 16-char id) → the TV shows a **4-digit PIN for 60 s** and returns an `auth_key` + `timestamp`. `POST /6/pair/grant` with digest auth (user = device id, password = `auth_key`) and an HMAC-SHA1 signature of `timestamp + pin` (with the shared app key published in open-source clients) → `Pairing completed`. The first try timed out (the PIN went by before it was typed): give the PIN screen a visible countdown and a "New code" button. |
| Auth after | HTTP digest on every request. Credentials never expire (until the TV is reset or the pairing removed). |
| TLS | curl (macOS LibreSSL) works; **Python's `ssl` timed out in the handshake** on every authenticated call. Check the Android stack (OkHttp/Conscrypt) early: it is the first build risk. |
| Speed | One request: 70 to 230 ms with a new connection (digest = 2 round trips). On a kept-alive connection: **35 to 40 ms** (20 reads of `ambilight/measured` in 1.0 s). |

### Endpoints tried (paired)

| Endpoint | Result |
|---|---|
| `GET powerstate` | `{"powerstate":"On"}`, `"Standby"` right after standby. **~12 s after standby the TV leaves the network** (connection refused): Glim reads "unreachable" as off. |
| `POST powerstate {"powerstate":"Standby"}` | Works (TV off in < 2 s). |
| `POST powerstate {"powerstate":"On"}` | **Can't wake it**: the API is gone by then. Wake-on-LAN to its MAC (broadcast, ports 7 and 9) didn't wake it either. The TV has a "Switch on with network" setting (Wi-Fi and wired; readable and settable through `menuitems`), value not read yet (open question). |
| `GET activities/current` | The foreground Android app: `com.google.android.tvlauncher` (home), `com.netflix.ninja` (Netflix), `org.droidtv.playtv` (TV channels / inputs), after `org.droidtv.channels` (the channel list) for 3 s. Changes show within one poll. |
| `POST notifychange` | Answers **at once** (~0.6 s) with the asked keys (`powerstate`, `activities/current`…), every time: on this TV it is **not a long-poll**, just a batched read. No push from the TV. |
| `GET audio/volume` | `{"muted":false,"current":16,"min":0,"max":60}` |
| `GET ambilight/power` | `{"power":"On"}` (`POST` not tried yet). |
| `GET ambilight/topology` | `{"layers":"1","left":9,"top":28,"right":9,"bottom":18}` → **64 LED zones on 4 sides** (the menu has an "Ambilight bottom side" On/Off). |
| `GET ambilight/currentconfiguration` | `{"styleName":"FOLLOW_VIDEO","isExpert":false,"menuSetting":"STANDARD"}` |
| `GET ambilight/supportedstyles` | OFF, FOLLOW_VIDEO, FOLLOW_AUDIO (9 algorithms), FOLLOW_COLOR (MANUAL_HUE, AUTOMATIC_HUE), LOUNGE, MANUAL, EXPERT, GRID, FLAG, APP, GAMEBAR_STYLE_1..5 |
| `GET ambilight/measured` | Per-LED RGB of the picture's edges, by side. Real values on a TV channel (dark greys). Streaming apps: **pending** (see §9). |
| `GET ambilight/processed`, `cached` | **All zeros** while following video, on every screen tried. Only `measured` carries the picture on this firmware. |
| `POST ambilight/mode {"current":"manual"}` + `POST ambilight/cached {"r":233,"g":207,"b":159}` | Accepted; `cached` reads back the color on every LED. Per LED: `{"layer1":{"left":{"0":{…}},"right":{"0":{…}}}}` accepted, only those LEDs changed. ~0.1 s per write. Nobody looked at the wall. |
| `POST ambilight/currentconfiguration` FOLLOW_COLOR, expert, MANUAL_HUE, `color {hue, saturation, brightness}` (0–255) | Accepted, reads back. A non-expert `menuSetting: WARM_WHITE` was ignored. |
| Put back | `currentconfiguration` FOLLOW_VIDEO / STANDARD **and** `mode {"current":"internal"}`: the style alone left `mode: manual`. |
| `GET HueLamp/power` | `{"power":"Off"}` = Ambilight+Hue off. |
| `POST HueLamp/power {"power":"On"}` | The bridge area **"Entertainment area"** (type screen; only *Lumière du salon* in it) went `active` **~2.5 s** later, `active_streamer = {rtype: auth_v1, rid: <the TV's key>}`; the pendant reported `mode: streaming`. |
| `POST HueLamp/power {"power":"Off"}` | Area `inactive` within ~1 s: a clean stop. **The pendant stayed off, but ~12 s later its stored level and color had changed** (56% warm → 20% blue, the last frame). It would have come back on wrong. Glim put the old level and color back while it was off (works, as Listening room found). |
| `menuitems/settings/structure` + `current` | The whole TV menu (100 kB). Useful nodes: Ambilight+hue **On** (toggle), **Immersion** 0–10 (read-only here, 8), **Lounge Light+hue** On/Off, Ambilight **brightness** 0–10, bottom side, TV switch-off fade, Ambisleep, "Switch on with network". |
| Chromecast `:8008/setup/eureka_info` | Name only ("Télé"). Cast media status (`:8009`) not tried. |

Nothing above needed the TV's screen except the PIN. Credentials stay in the session's
scratchpad, never in the repo.

## 2. Screen colors on the lights

Three ways (canvas, board 2):

- **A. The TV streams (Glim is the remote).** Ambilight+Hue does the work: the TV sends its edge
  colors to its Hue area itself, phone off, at the TV's own rate and in sync with the picture.
  Glim turns it on and off (`HueLamp/power`, tested), shows when it runs (the bridge's
  `active_streamer` is the TV), and puts the lights back after (tested need). The TV's area
  today has **one light** (Lumière du salon), chosen in the TV's wizard; it knows nothing of the
  map.
- **B. Glim streams from the TV's colors.** Glim reads `ambilight/measured` (~25 reads/s
  possible) and drives the lights itself through the Entertainment API, map-aware: each light
  takes the edge of the picture that faces it, from the TV's place and the direction it faces on
  the map, fading with distance; lights behind the sofa take the average, softly. Full control of
  the look (Nocturne-calm smoothing, never a strobe), every color light of the room, not just the
  TV's area. Costs: the phone is in the loop (at home, on Wi-Fi, a foreground service all film
  long: estimated a few % battery an hour, unmeasured), latency TV → phone → bridge adds an
  estimated 60–120 ms to the TV's own path, `measured` on Netflix/YouTube is **not proven yet**
  (DRM apps can blank it), and it takes the bridge's only stream.
- **C. The TV streams, Glim draws its area from the map (recommended).** A, plus: Glim makes one
  area of its own, **"Glim TV"** (`configuration_type: screen`), from the map: every color light
  of the TV's room (and chosen neighbours) with positions **in the TV's frame** (the TV at the
  front, +y; x from the viewer's left to right; height by light type, as Listening room does).
  The TV's Ambilight+Hue wizard is then pointed at "Glim TV" once, on the TV (Glim says how:
  Settings → Ambilight → Ambilight extension → Ambilight+hue → Configure). The TV gives each
  light the edge it faces: map-aware, phone off, the TV's own sync. Glim keeps the area's
  positions in step with the map (a hash, like Listening room) and never touches other areas.
  Open: whether the TV rereads positions at each start or caches them at configuration (§9).

**Pick C**, with B kept as a later "Glim style" if `measured` works on streaming apps and C's
look is too plain.

### Stream sharing (with Listening room)

One stream per bridge (`max_streams: 1`). The rule both designs follow:

1. Glim never takes a stream it didn't start. It reads `active_streamer`: Glim's own key,
   the TV's key (learned the first time Glim turns Ambilight+Hue on and sees who streams), or
   someone else (Hue Sync…).
2. **New with the TV paired:** Glim can ask the TV to stop. Listening room, while the TV
   streams: "Your TV is lighting the room. **Use the lights for music**" → `HueLamp/power Off`,
   wait for `inactive` (~1 s), start. Without the TV paired: only "Your TV is using the lights"
   (Listening room's current text).
3. Turning on screen colors while Listening room plays: "Music is playing on the lights. **Stop
   it and follow the TV**" → Listening room ends (its put-back), then `HueLamp/power On`.
4. Whoever ends a stream puts the lights back (tested on both sides): when the TV's stream
   ends, Glim rewrites the snapshot it took when it turned the TV's stream on (or, if the TV
   started it alone, the last state Glim saw before `mode: streaming`), with the ±5 rule (a light
   changed since is left alone).

## 3. Watching TV (movie mode)

What the TV shows (tested): **on / standby / gone** (gone ~12 s after standby) and **which app is
in front** (home screen, Netflix, TV channels…). Not shown: **play or pause.** JointSpace has no
media session; a frozen `measured` frame could hint at a pause but also matches a dark scene or
a still shot (to test, §9). So "lights come up gently on pause" is not promised.

Behavior (a ritual in the Rituals tab, "Watching TV", one sheet like Arriving home):

- **When the TV comes on** (and, optional, only after sunset): take a snapshot of the lights it
  will change, then apply **a mood** (default: the "Movie" preset on the TV's room, other rooms
  left alone) or **screen colors** (Ambilight+Hue on), or both: a mood for the room, screen
  colors for the TV's area.
- **While on the home screen or settings** (`tvlauncher`, `settings`): optional "lights a little
  up while browsing" (+15%, 2 s fade).
- **When the TV goes to standby or leaves the network:** put back the snapshot (±5 rule), or a
  chosen mood, or all off ("Bedtime"). 2 s fade, never `duration` with `on: false`.
- **Pause** (only if §9 shows a usable signal): lights rise to 40% over 3 s, fall back on play.

Where it runs, three ways (canvas, board 3):

- **A. The phone watches the TV (recommended).** In the existing Live sync service: while the
  phone is on home Wi-Fi, poll the TV every **10 s with the screen off, 5 s with it on**. When
  the TV is in deep standby a poll is a refused connection (2 ms, almost free); when on, one
  `notifychange` read (powerstate + activity, ~0.6 s, ~1 kB). The TV coming on is seen within
  ≤ 10 s, while it is still booting. Costs to measure: Wi-Fi wakeups with the screen off (a
  partial wake lock every 10 s), and whether the `connectedDevice` foreground service keeps
  network access in Doze. Away from home: off (the TV is local only).
- **B. Let Ambilight+Hue be the movie mode.** No service: the TV's area follows the picture
  whenever the TV is on (the TV's own "Ambilight+hue: On"). Glim only sets the area (option C
  above). Free, but nothing happens to the other lights, and nothing is put back.
- **C. Glim on the TV.** A tiny Android TV app on the TV itself (sideloaded): sees power and,
  maybe, real play/pause (media sessions), and talks to the bridge directly; no phone involved.
  A second app to build, sign and update, and Android TV may not grant media-session access to a
  sideloaded app. Kept as an idea.

## 4. The TV as a light

Ambilight's LEDs join moods like a light (canvas, board 4):

- **A. One color (recommended for moods).** A mood stores a color for the TV like for a lamp:
  `currentconfiguration` FOLLOW_COLOR, expert, MANUAL_HUE, hue/saturation/brightness (tested).
  Stays as the TV's style until something changes it. "Off" in a mood = Ambilight style OFF.
  **All off** turns Ambilight off too (and the TV's screen colors). Applying any mood that lights
  the TV's area turns Ambilight+Hue off first (or the TV would copy its LEDs onto the lamps).
- **B. Per side (map-aware moods).** Manual mode + `cached` per LED (tested): a sweep or a room
  glow continues onto the TV's wall: left side, top, right side each take the color the mood has
  there on the map. Lovely with sweeps, but manual mode may not survive an app change or a
  restart (untested); kept for sweeps only, after A.
- **C. Leave the TV out.** Only All off and Watching TV touch it. The simplest; no "TV" row in
  the mood editor.

Put back after a mood or All off: the TV's style before (read at apply, kept like a light's
snapshot); default FOLLOW_VIDEO / STANDARD + mode internal.

A smart-plug-like limit: when the TV is in deep standby Glim can't reach it, so a mood can't
light Ambilight as a lounge lamp with the TV off (the TV's own Lounge Light needs the TV awake).
The mood skips it quietly ("TV off: not changed").

## 5. The TV on the map

The TV is an object of the plan, not a light: a point, a **facing direction**, a width (65" ≈
1.45 m, from the model; editable), a room. Placed in the 2D editor (Add → TV, then drag; a
handle turns it; it snaps flat against the nearest wall, facing into the room) and, later, in
the AR scan ("Aim at the bottom of the TV, tap"). On the Map tab (canvas, board 1):

- **A. Wall wash (recommended).** A thin ivory bar against the wall, and behind it the Ambilight
  glow as a soft half-pool on the wall side, in the TV's live edge colors when on (from `measured`
  at the Map tab's pace, every 2 s, only while the Map tab is open), dark when off.
- **B. Screen and halo.** A small rectangle seen from above with a ring of 4 colored edges (the
  64 zones grouped), a faint cone toward the sofa.
- **C. A jewel.** Like a light marker, with a TV icon; the simplest, but it reads as a lamp.

Tap the TV: its sheet (power, screen colors, Ambilight style, Watching TV). It never takes a
light's tap area on the Map widget (the widget shows it as a dark bar, no glow animation).

## 6. Entry points

- **Settings → Your home → TV** (new section): "Find my TV" (needs the TV on: Glim sweeps for
  port 1926 and `_googlecast`, checks `/6/system`; the bridge's pairing list tells if a Philips
  TV is in the home even while it's off: "A Philips TV is paired with your bridge (65OLED887/12).
  Turn it on to connect it."). Then the PIN screen (4 big digit boxes, 60 s ring countdown,
  "New code"). Once paired: name, model, address, API, "Switch on with network" status,
  Forget TV.
- **Rooms tab:** the TV is a card in its room ("Télé · On · Netflix" / "Off"), with a toggle for
  screen colors and its Ambilight dot. Its sheet: Screen colors (Off / Follow the TV), Ambilight
  (Follow video / A color / Off), Turn off TV, Watching TV ritual link.
- **Map tab:** the TV marker (§5); a pill "Screen colors" over the plan while the TV streams.
- **Moods widget and Quick Settings tile:** a **"Screen colors"** button / target (tile label
  "Télé", subtitle "Following the TV" / "Off"), native like other fast taps: `HueLamp/power`
  from Kotlin (digest credentials in `huelab_fast`). Shown on only while the TV is reachable
  (otherwise "TV off").
- **Rituals tab:** "Watching TV" card (§3).

## 7. Data model

```ts
// Per bridge, like the map (AsyncStorage `tv:<bridgeId>`; secrets in SecureStore).
type Tv = {
  id: string;            // Glim's id for it (random), not the TV's encrypted serial
  name: string;          // from /6/system ("Télé")
  model?: string;        // from the bridge whitelist name when it looks like a model ("65OLED887/12")
  host: string;          // last known address; re-found by sweep when it changes (DHCP)
  mac?: string;          // from ARP, for Wake-on-LAN if "Switch on with network" works
  api: { major: number; minor: number };
  certPin: string;       // public key pinned at pairing (self-signed)
  topology: { left: number; top: number; right: number; bottom: number };
  hueStreamerId?: string; // the TV's auth id on the bridge, learned from active_streamer
  areaId?: string;        // the "Glim TV" entertainment area
  areaHash?: string;      // lights + positions in the TV frame, to know when to update it
};
// SecureStore `tv-auth:<bridgeId>:<tvId>` = { user, pass } (digest).

// In HomeMap (version stays 2, optional field):
type MapTv = { tvId: string; x: number; z: number; angle: number /* facing, degrees */; width: number };
// HomeMap.tvs?: MapTv[]

// Watching TV ritual (per bridge, phone-side like Arriving home):
type WatchingTv = {
  enabled: boolean;
  tvId: string;
  onStart: { mood?: string; screenColors: boolean; afterSunsetOnly: boolean };
  browsing: 'leave' | 'lift';
  onEnd: 'put-back' | { mood: string } | 'all-off';
};

// Moods: a TV entry next to lights (option A).
type MoodTv = { tvId: string; ambilight: 'off' | 'video' | { hue: number; saturation: number; brightness: number } };
```

## 8. Architecture

- **TV client in Kotlin** (`modules/hue-http`, next to `FastRoute.kt`): HTTPS with the TV's key
  pinned at pairing, digest auth, one kept-alive connection, a 3 s timeout (a TV in deep standby
  refuses at once). JS calls it through the module like bridge requests. Plain `fetch` can't do
  digest + self-signed.
- **Discovery:** TV on → `_googlecast._tcp` names + `/6/system` check, fallback sweep of the /24
  on port 1926 (~2 s). Address changes (DHCP): rediscover on the first refused poll after a
  long success streak; match by the TV's encrypted device id from `/6/system` (stable string).
- **TV watch** (Watching TV, §3 A): inside `LiveSync.kt` (already a foreground service), a
  10 s / 5 s poll while on home Wi-Fi (the bridge answers locally). Emits `onTv` to JS and runs
  the ritual natively when the app is dead: the batch to send on "TV on" and the put-back are
  written ahead to `huelab_fast`, as the sleep pool does.
- **Screen colors:** `HueLamp/power` from JS or Kotlin; the "Glim TV" area made and updated from
  the map through the bridge (`entertainment_configuration`, as Listening room); the snapshot
  and put-back shared with Listening room's code (one "stream owner" module).
- **Moods:** `planMood` gains the TV entry → one TV request per apply (`currentconfiguration`),
  sent last in a widget/tile batch (Kotlin knows it's a TV request by its route).

## 9. Open questions (need the TV on, some the maintainer)

1. **`measured` on Netflix and YouTube**, and whether a **pause** shows (frozen frame?). Test
   prepared: a recorder logging the app and the 4 edge averages 3 times a second while the
   maintainer plays, pauses, resumes on each app. Decides option B and pause behavior.
2. **"Switch on with network"**: its value; if on, does Wake-on-LAN or `powerstate On` wake the
   TV from deep standby? Decides whether Glim can turn the TV *on* (a "Movie" button that
   starts everything).
3. Does the TV's Ambilight+Hue **reread the area's positions** at each start, or keep what it
   saw in its wizard? Test: change "Entertainment area" positions (or point the TV at a test
   area), turn Ambilight+Hue on, watch which light takes which edge.
4. Android TLS to the TV (Python's handshake failed; curl works).
5. `ambilight/power` Off/On, and does manual mode survive an app change?
6. Where is the TV in the Salon, which wall, facing where? (The canvas uses a guess: the
   Salon's east wall, facing west.)
7. The Cast side: `:8009` media status shows play/pause for cast content only (YouTube cast,
   not the Netflix app on the TV). Worth it?

## 10. Build steps

1. TV client in Kotlin (digest, pinning, keep-alive), discovery, PIN pairing screen in
   Settings → Your home → TV. Prove TLS from Android first.
2. TV on the map: `HomeMap.tvs`, editor placement with facing handle, Map tab marker (wall wash),
   Rooms tab card and sheet (power, Ambilight style, screen colors toggle).
3. Screen colors: toggle, learn the TV's streamer id, put-back after its stream, the shared
   stream-owner rule with Listening room; then the "Glim TV" area from the map + the wizard hint
   (after open question 3).
4. The TV in moods (one color), All off turns Ambilight off, put back its style.
5. Watching TV ritual: TV watch in Live sync, sheet in the Rituals tab, native put-back.
6. Widget button / tile target "Screen colors".
7. Later, by the open questions: per-side Ambilight in sweeps, Glim's own screen-colors engine
   (option B), turning the TV on, pause.
