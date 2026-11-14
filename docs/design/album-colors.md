# Album colors

Design for the first of the music and TV integrations (2026-11-14): **the song
playing on the phone sets the lights from its album art.** Any player that shows
a media notification (Spotify, Deezer, YouTube Music, SoundCloud, a Cast or
Spotify Connect session). Design only: no app code yet.

Canvas with the options to pick from: <https://claude.ai/artifact/3CtPqqR1rXYomywXv7CeY2>
("Glim album colors"; sample covers drawn for it, home data real). Recommended picks are marked **(default)** below.

Sibling designs, same day: Listening room (Hue Entertainment, real-time beat
sync), Ambilight TV, Sunrise-follows-alarm / Window light / Notification glow.
Album colors is the calm one: **one look per track, no beat**. When the
Listening room is on, Album colors gives it its palette (see Open questions).

## In one paragraph

Turn on **Follow the music** (Moods tab card, a Moods widget button or the
Quick Settings tile). From then on, each new track sets the lights of the
chosen target (whole home by default) to 3 to 5 colors taken from its cover,
spread like a palette mood, slowly drifting (a living mood) by default. Pausing
holds the colors; after 15 min without music it stops following and puts the
lights back as they were before it started. It runs only when the sound plays
out loud (phone speaker, Cast, a Bluetooth speaker), not on headphones. It
works with the phone locked and away from home, from native code.

## Source: what's playing

- **API.** A `NotificationListenerService` (`GlimMedia`, in the `hue-http`
  module's manifest) is the key that unlocks
  `MediaSessionManager.getActiveSessions(component)` and
  `addOnActiveSessionsChangedListener`. Glim never reads notifications
  themselves: it only uses the listener as the permission for media sessions.
  Each active `MediaController` gets a `MediaController.Callback`:
  `onMetadataChanged` (title, artist, album, art) and `onPlaybackStateChanged`
  (playing, paused, stopped). `getPlaybackInfo().playbackType` tells a Cast or
  Connect session (`PLAYBACK_TYPE_REMOTE`) from local playback.
- **Art.** `METADATA_KEY_ALBUM_ART`, else `METADATA_KEY_ART`, else
  `METADATA_KEY_DISPLAY_ICON` (bitmaps); else `..._ALBUM_ART_URI` /
  `..._ART_URI` loaded through `ContentResolver` (some players only give a URI).
  Players often send the metadata first and the art a moment later: wait up to
  1.5 s for art before deciding there is none.
- **Verified on the maintainer's phone** (Pixel 11 Pro XL, Android 17,
  `adb shell dumpsys media_session`, 2026-11-14): Spotify
  (`com.spotify.music`, paused, metadata with 18 keys: "Carnival Of Doom",
  The Supreme Team), SoundCloud (7 keys, stopped) and Netflix (no metadata)
  have sessions. TikTok was the last app to play audio and has **no media
  session**: apps like it are invisible to this feature (fine: not music).

### Permission moment (shared with Notification glow)

Notification access is one switch in Android for both Album colors and
Notification glow, so it gets **one shared screen**, `NotificationAccess`,
reused by both features, listing what each uses it for and what Glim never
does ("Glim never reads, keeps or sends your notifications' text. Album colors
only looks at what's playing.").

**Restricted settings (verified).** Glim is installed with `adb install`
(installer `com.android.shell`) and Android 17 treats notification access as a
*restricted setting* for such apps: the switch is greyed out until the user
goes to App info → ⋮ → **Allow restricted settings**. `appops get
io.lechaterrant.huelab ACCESS_RESTRICTED_SETTINGS` already shows a rejection
(`rejectTime` 14 h before this check): someone tried and hit the wall. So the
moment is two steps, and Glim detects which one it is at:

1. **"Allow Glim to ask"**: shown only while restricted. Button opens App info
   (`Settings.ACTION_APPLICATION_DETAILS_SETTINGS`); a 3-line illustrated hint
   shows ⋮ → Allow restricted settings (and the fingerprint/PIN Android asks).
2. **"Let Glim see what's playing"**: button opens
   `Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` with Glim's
   component (straight to Glim's switch, not the whole list).

Back in the app (`AppState` active), Glim re-checks
`NotificationManager.isNotificationListenerAccessGranted(component)` and
continues where the user was. Canvas options: **A. One screen, steps appear
as needed (default)**, B. A sheet over the Moods tab, C. A Settings row only.

**Denied or revoked.** Nothing breaks: the Now playing card becomes a dashed
"Album colors needs to see what's playing · Allow" row; the widget button and
tile show "Allow" and open the permission screen. No nagging: asked only when
the user turns the feature on.

## Palette extraction

Kotlin, on the listener's background thread (the art must be read where it
arrives, with the screen off), result stored and sent to JS for the card.

1. Scale the art to 48×48 (bitmaps from players are up to 1024 px; Android
   scales metadata bitmaps already).
2. Convert pixels to OKLab; drop **near-blacks** (L < 0.18), **near-whites**
   (L > 0.93) and **greys** (chroma C < 0.04) from the color pool, but count
   them.
3. Cluster the remaining pixels (k-means, k = 6, seeded from a fixed 6-bucket
   hue split so the same cover always gives the same colors), merge clusters
   closer than ΔE 0.08.
4. Score each cluster by `share^0.5 × chroma` (the "vivid" weighting): a small
   bright detail beats a large dull area, but a big field still counts.
5. Keep the top 3 to 5 (5 only if each is at least 3% of the color pool).
6. Make them light-worthy: lift lightness to at least L 0.62 and chroma to at
   least 0.09 while keeping hue (a navy cover becomes a blue the bulbs can
   show), then clamp into gamut C (`readbackHexes` logic in
   `src/lib/hue/color.ts`).

**Covers with little or no color** (color pool under 6% of pixels): a black and
white cover, a grey photo, an all-black sleeve. Options on the canvas:
**A. Warm whites (default)**: the cover's light distribution becomes 2 or 3
whites (2200 K, 2700 K, and 4000 K if there is a lot of white), so a stark
cover gives a quiet, warm room. B. One tint: the one faint hue there is
(sepia, a blue cast), lifted. C. Keep the last colors.

**Style** (a setting, canvas options): **Vivid (default)** as above; Faithful
(score by share only, no lift beyond what bulbs need: closer to the cover,
duller in the room); Soft (Vivid, then chroma × 0.6 and a warm bias: easier
evenings).

**Mapping to Glim's moods.** The result is a `Palette` (`src/lib/moodPresets.ts`):
`tones` = the colors as `{ hex }` (or `{ kelvin }` for a colorless cover),
`brightness` from the feature, `white` = the white closest to the first color
(`whiteFor`). It is spread with **`presetLights`** (colors go round the lights
in map order, white-only lights take the closest white, plugs left alone), so
an album look is exactly a palette mood made for this track. "Keep as mood"
on the card saves it as one (`Mood.palette`, named after the album).

## Behavior

- **On / off.** `Follow the music` is a switch. Turning it on captures the
  target's lights (`captureLights`, the "before" look), then applies the
  current track if one plays. Turning it off puts the before look back (option)
  or leaves the lights as they are (option); default **put back**.
- **Target.** Whole home (default), a room or a group: the same "For" picker
  as presets. Lights in no room are included for the whole home.
- **Brightness.** One slider, default 70%. Each light keeps the palette tone's
  brightness relative to it.
- **Per track.** A new track = a new title + artist + album (art alone
  changing is the same track). Transition: **2 s (default)**, Instant, 10 s.
  Same album as the last track: nothing is sent (no flash between tracks of an
  album).
- **How it plays** (canvas options): **A. Living (default)**: Hue's dynamic
  scene, the colors drift slowly over the lights (speed Slow); B. Still: one
  color per light, as `presetLights` spreads it; C. Main color: the strongest
  color on every light, the others on the ones nearest the middle of the map.
- **Pause and stop** (canvas options): **A. Hold (default)**: paused keeps the
  colors; after **15 min** with nothing playing it stops following and puts
  the before look back. B. Dim: paused dims to 30% of the album level, play
  brings it back. C. Put back at once on pause.
- **Out loud only (default on).** Follows only when the audio goes to the
  phone speaker, a wired or Bluetooth **speaker**, a car, or a Cast / Connect
  session (`PLAYBACK_TYPE_REMOTE`). Not on headphones or earbuds (you're
  listening alone, maybe out of the house). Detection:
  `AudioManager.getDevices(GET_DEVICES_OUTPUTS)` + the active route; wired
  headset, `TYPE_BLE_HEADSET`, `TYPE_HEARING_AID` = headphones,
  `TYPE_BLE_SPEAKER` = speaker. **Classic Bluetooth can't be told apart
  (verified):** the maintainer's Sony headphones report
  `bt_a2dp` "LE_WH-1000XM3" with device class `0x1f00` (uncategorized).
  So the first time music plays on a new Bluetooth device, the card asks once:
  "Is LE_WH-1000XM3 headphones or a speaker?" with a guess from its name
  (`WH-`, `Buds`, `AirPods`, `Pods` → headphones) pre-picked. Answers are kept
  per device (Settings → Album colors → Audio devices). Options: **A. Out loud
  only (default)**, B. Always.
- **Away from home.** Follows only while at home by default (the bridge
  answers on Wi-Fi): music in the car shouldn't recolor an empty flat. With
  out loud only, a car's Bluetooth would otherwise count as a speaker. A
  switch allows "away too" (through Hue's cloud).
- **Players.** Every player by default; Settings lists the players seen so far
  with a switch each (e.g. skip a podcast app).
- **Turning lights off by hand** (a switch, the Hue app, another mood) while
  following: Glim notices through live sync (or the next track's read) and
  stops following for that session, so it never fights the user. The card says
  "Stopped: Salon was changed by hand · Follow again".

## Where it runs: native, through `FastRoute.kt`

The listener lives in the app's process and gets callbacks with the screen
off, so the whole loop is Kotlin, like widget taps: **JS writes the config;
Kotlin listens, extracts, applies.**

- `GlimMedia.kt` (NotificationListenerService): sessions, playback state, audio
  route, debounce, extraction (`AlbumPalette.kt`), and apply.
- **Apply.** JS can't spread a palette from Kotlin, so JS writes everything
  Kotlin needs to `huelab_fast` (rewritten when the target, map or lights
  change, like `setTileConfig`): the target's lights in map order with
  kind (color / white-only / plug) and min mirek, the hidden scene per room,
  and the before look. Kotlin repeats `presetLights`' rule (a few lines: round
  robin, white-only gets the nearest white).
- **Living (default).** One hidden scene per room or group the target covers,
  **made once** ("Glim album", skipped by `isGlimScene`) and **re-paletted per
  track**: `PUT scene/{id}` with the new `actions` + `palette`, then `PUT
  scene/{id}` `recall: dynamic_palette`. **Tested on the real bridge
  (2026-11-14, Salon):** POST scene 327 ms; recall 380 ms, the three color
  lights showed the action colors with `dynamics.status: dynamic_palette`;
  PUT of a new palette 455 ms and accepted, but lights already playing kept
  the old colors (scene went `inactive`) until recalled again (280 ms), then
  showed the new ones; the plug, given a no-op `dynamics`, stayed off. The
  test scene was deleted and the lights put back off at their levels.
- **Still.** One `PUT light/{id}` per light (`FastRoute.sendAll`, 4 at a
  time): 265 to 440 ms each locally in the same test.
- **Cost per track** (the maintainer's home, whole home): living = 2 requests
  × 3 rooms with color lights (Salon, Chambre, Salle de bain; Terrasse is a
  plug only, skipped) = **6**; still = **7** (the color lights). A
  4-minute-track evening of 4 hours ≈ 60 tracks ≈ 360 to 420 requests. Hue's
  only published Remote API limit is **50,000 calls a day** for the developer
  app (developers.meethue.com terms), and Glim's dev app has one user: no
  problem even away. Live sync's cloud poll (every 15 s) costs more than this.
- **Fast skipping.** Apply 1.2 s after the last track change (a skip through 6
  tracks sends one look). A look is never sent less than 4 s after the last
  one; the newest wins.
- **Doze.** Callbacks arrive with the screen off; network from the listener
  in deep Doze is **not verified**. While music plays the phone is rarely in
  deep Doze, but the build must test a whole album with the screen off. Fallback
  if it fails: while following and playing, keep the Live sync foreground
  service up (its notification says "Following the music"), which already has
  network with the screen off.

## Entry points and screens (all on the canvas)

1. **Moods tab: Now playing card**, first on the tab while music plays or the
   feature is on. Cover, track and artist, the colors as overlapping orbs (the
   palette editor's orbs), the target, and the switch. Canvas options: **A.
   Sleeve (default)**: cover left, text and orbs right, one row; B. Halo: cover
   centered with the colors glowing around it; C. Band: a thin full-width strip
   with the colors as a gradient, cover small. Long-press or ⋯: Keep as mood,
   Settings.
2. **Album colors sheet** (tap the card): For (target), Brightness, How it
   plays, Per track, When paused, Out loud only, Away from home, Style.
3. **Moods widget button** "Album colors": its dots are the current track's
   colors (or a dashed ring when not following); a tap toggles following
   (`FAST_ALBUM`); the champagne edge while following.
4. **Quick Settings tile** target "Album colors": label "Album colors",
   subtitle the track ("Carnival Of Doom") or "Off"; tap toggles.
5. **Settings → Your home → Album colors**: the same options, Audio devices,
   Players, Notification access.
6. **The permission screen** (shared with Notification glow).

## Data model

```ts
// src/lib/albumColors.ts (per bridge, AsyncStorage + mirrored to huelab_fast)
export type AlbumColors = {
  on: boolean;
  targetId: string | null;               // null: whole home
  brightness: number;                    // 1–100
  play: 'living' | 'still' | 'main';
  speed: number;                         // living, Hue's 0–1 (default 0.15)
  transition: number;                    // ms, per track
  style: 'vivid' | 'faithful' | 'soft';
  colorless: 'whites' | 'tint' | 'keep'; // black-and-white covers
  onPause: 'hold' | 'dim' | 'restore';
  stopAfter: number;                     // min with nothing playing (15)
  outLoud: boolean;
  away: boolean;
  offRestores: boolean;                  // turning off puts the before look back
  players: Record<string, boolean>;      // package → follow (absent: yes)
  devices: Record<string, 'headphones' | 'speaker'>; // Bluetooth address → kind
  scenes?: { group: string; scene: string }[];     // hidden "Glim album" scenes
};

// Written by Kotlin, read by the app and widgets
export type NowPlaying = {
  player: string; title: string; artist: string; album: string;
  art: string | null;                    // file:// 256 px JPEG in the cache
  tones: string[];                       // hex, or [] when following stopped
  kelvins?: number[];                    // a colorless cover
  playing: boolean; following: boolean; out: 'speaker' | 'headphones' | 'cast';
  stopped?: 'by-hand' | 'silence' | 'away';
};
```

## Edge cases

- **No art:** keep the last colors for an album-less track (radio, a voice
  memo); the card shows a plain disc with the track's name.
- **Podcasts and audiobooks:** a podcast cover is a logo, not a mood. Skip
  sessions whose metadata says a podcast (`METADATA_KEY_GENRE` "Podcast", or
  the player's podcast queue) and known podcast apps by default; they can be
  switched on in Players.
- **Fast skipping:** debounce 1.2 s, at most one look per 4 s.
- **Several players at once:** follow the session that is playing; if two
  play, the most recently started (Android's own session order); a paused
  session never overrides a playing one.
- **White-only lights:** take the white nearest each tone (`whiteFor`), like
  presets. **Plugs:** never touched (a look has nothing for a plug); with
  living, they get the no-op `dynamics` in the scene (tested).
- **Unreachable lights:** skipped, as with presets.
- **A Cast session from another phone** isn't on this phone: not followed.
- **Ambilight TV or Listening room running:** they win; Album colors pauses
  (see Open questions).

## Limits

- Android only (iOS has no API for another app's now playing).
- Classic Bluetooth headphones vs speakers needs one answer per device.
- Restricted settings: one extra step on an adb or sideloaded install.
- Living drift isn't seen in a test without someone in the room (same as
  living moods): the bridge reports the status.

## Open questions for the maintainer

1. Card: Sleeve, Halo or Band?
2. How it plays: Living, Still or Main color?
3. Black-and-white covers: warm whites, one tint, or keep the last colors?
4. When paused: hold, dim or put back?
5. Out loud only by default, and only at home by default?
6. Should Album colors feed the Listening room's palette when both are on?

## Build steps

1. `GlimMedia.kt` listener + manifest entry; `isGranted` / open settings
   bridge in `HueHttpModule`; the shared `NotificationAccess` screen with the
   restricted-settings step.
2. `AlbumPalette.kt` (OKLab, k-means, scoring, lift, colorless) with a JVM
   unit test on the canvas's sample covers.
3. `src/lib/albumColors.ts`: store, `setAlbumConfig` writing `huelab_fast`
   (lights in map order, scenes, before look), hidden scene per room.
4. Apply path in Kotlin (living and still), debounce, pause/stop timers,
   out-loud detection and the per-device question.
5. Now playing card + sheet on the Moods tab, Settings section.
6. Moods widget button (`FAST_ALBUM`) and tile target.
7. Test on the real lights: Spotify on the phone speaker, a Bluetooth speaker,
   headphones (should not follow), a Cast session, a whole album with the
   screen off (Doze), away through the cloud, fast skipping.
