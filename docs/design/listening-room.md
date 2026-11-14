# Listening room

Design for music sync in Glim (2026-11-14). Status: **design + feasibility probe, no app code.**
Canvas: <https://claude.ai/artifact/6nmX5MhtBFnkmTEKxmD59g> ("Glim listening room": the three
modes moving on the real plan, the Map tab options, the sheet and entry points, map → area and the
measured ending).
Probe script: [`listening-room-probe.py`](listening-room-probe.py) (`--drop` kills the stream
without stop, `--black-tail 1` ends on black frames, `--watch 12` reads the lights each second
after stop).

The lights follow music in real time through Hue's Entertainment API. The aim is calm and
luxurious (Nocturne), never a disco: light *breathes* with the music, beats are soft swells, and
the signature mode sends each beat across the floor plan from where the speaker stands, room by
room. Nobody else can do this last part: Glim knows where every light is.

## 1. What the probe proved (real bridge, 2026-11-14)

Run from the Mac on the home Wi-Fi, against bridge `ecb5fafffe936332`, on the 7 color lights.
All lights were put back afterwards; the probe areas were deleted.

| Question | Result |
|---|---|
| Does Glim keep the client key? | **No.** `pairOnce` (`src/lib/hue/bridge.ts:89`) sends `generateclientkey: true` but stores only `username`. The dev `.env` has one (`HUE_CLIENT_KEY`) from an earlier manual pairing. |
| Lights able to stream | Every color light has an `entertainment` service with `renderer: true`, 1 segment (no gradient lights here). Plugs have none. Bridge: `max_streams: 1`. |
| Existing areas | "Espace Musique" (music; Cuisine, Salon, Chambre) and "Entertainment area" (screen; Lumière du salon only, probably the Ambilight TV's). |
| Create an area from map positions | `POST /clip/v2/resource/entertainment_configuration` with `locations.service_locations` works, **~0.6 s**. The bridge numbers the channels itself (order differs from what was sent): read them back. |
| Start | `PUT {action: start}` **0.3–0.4 s**; status `active`, `active_streamer = {rtype: auth_v1, rid: <our key>}`. |
| DTLS | DTLS 1.2, `PSK-AES128-GCM-SHA256`, identity = app key, PSK = client key (hex), UDP 2100. Handshake **< 0.6 s** (openssl 3.6 `s_client`). |
| Frames | HueStream v2, RGB 16-bit, 25 Hz for 8 s: accepted, lights rendered (they ended on the streamed color, see below). |
| REST while streaming | Lights say `mode: "streaming"`; on / brightness / color stay **stale** (the app can't read the streamed look back: it must draw it from its own engine). |
| Stop | `PUT {action: stop}` ~1 s. |
| **Lights put back?** | **No.** Each light keeps the last streamed frame. REST shows it **1 to 9 s later**, one light at a time (off lights came back "on at 6%", the last frame's amber). Same after a dropped stream. |
| Drift, timed (all off before, no closing frame) | Chambre +1 s, Cuisine +4 s, Hue Play 2 +6 s, Bureau +7 s, Salon +8 s, Hue Play 1 +9 s: each "on at 6%". |
| Ending on black | 1 s of black frames before stop: lights that were off stayed off. A light that was on (blue 40%) ended **off** (brightness 0). So the end frame *is* the end state. |
| Brightness while off | A light accepts brightness and color while off (`on: false` first, then level + color) and keeps them: used to put lights back exactly. |
| Dropped stream (DTLS killed, no stop) | Status stays `active` ~9 s, then `inactive` by itself. Lights stay on the last frame. |
| Cloud | Not tried: the Entertainment API is local only (UDP to the bridge). |

Not proven here: the Android side (BouncyCastle DTLS, `AudioRecord`, foreground service rules),
the look in the room (nobody watched), and what happens when the TV starts streaming while Glim
streams (the TV was off).

## 2. Behavior

### Modes

Three modes. All effects are computed on the phone in **map meters** (not Hue's −1..1 space),
per light, 50 times a second.

- **Breathe** (default). Follows the music's energy slowly. A loudness envelope (attack ~1.5 s,
  release ~4 s) lifts brightness between a floor and the ceiling. Bass lifts the low lights
  (light bars, Hue Go, floor lamps), highs lift the high ones (pendants, ceiling): the home
  breathes from the floor up. The palette drifts across the lights, one step every 20–40 s
  (faster when the music is busy). Works on anything: ambient, jazz, a film.
- **Pulse.** Beats. Each detected beat is a soft swell (attack 80 ms, decay 400–700 ms), never a
  flash. Lights are split in two sets (left/right of the speaker) that answer each other on
  alternate beats; a strong downbeat swells both. The palette moves one color per bar. Once the
  tempo locks (autocorrelation of onsets), swells are scheduled on the *predicted* beat minus the
  measured latency, so they land with the sound.
- **Ripple** (the signature). Each beat starts a ring at the **speaker** placed on the map. The
  ring travels at 3 m/s (Slow 2, Lively 5) and lights a light as it passes (Gaussian, ring width
  ~1.2 m), fading with distance. Distance is the **walk through the home**, not the straight
  line: through shared walls (doorways) as worked out by `src/lib/map/route.ts`, so the ripple
  goes room by room (Salon → Chambre → Salle de bain), the way sound travels. Each ring takes the
  next palette color: rings of different colors follow each other across the plan. Option:
  "Straight line" (through walls) for open-plan homes.

### Palette

Where the colors come from (one choice):

1. **Your lights as they are** (default): the colors of the included lights at start. The room
   keeps its look and just moves. The calmest choice.
2. **A mood**: any of my moods, palette moods, presets or Hue-app moods (their tones / light
   colors become the palette).
3. **Album colors** (when the Album colors feature is on, sibling design): the now-playing
   album's palette, changing with the track with a 3 s crossfade.

White-only lights can't stream (not renderers): they are left as they are.

### Intensity and limits

One control, **Calm / Balanced / Lively**, sets motion depth, decay and ripple speed. Brightness
has its own ceiling slider (default: 80%).

Hard limits, not settings (calm and photosensitive-safe):

- Never black: a floor of 12–20% (by intensity) while music plays. Silence for 8 s →
  "Waiting for music": lights rest on the palette at the floor + 10%, still.
- At most **3 swells per second per light** (WCAG 2.3.1 general flash threshold); swells decay
  over ≥ 300 ms.
- Color never changes on a beat: hue moves only by palette steps with a ≥ 1.5 s crossfade.
  Brightness carries the beat.
- Auto gain over a rolling 10 s window: quiet vinyl and a loud TV give the same depth.

### Starting and ending

- **Start**: snapshot the included lights (on, brightness, color or white, effect, which mood
  showed), make sure the area matches the map, start it, open DTLS, fade in from the snapshot to
  the music over 1.5 s (streamed, so the first frame equals what the lights already show).
- **Stop** (button, notification, tile, widget, a ritual, a tap on an included room): stream a
  1.2 s crossfade from the music to the **snapshot** (off lights → black), `stop`, then rewrite
  the snapshot over REST (on lights: on + level + color, `duration: 0`; off lights: `on: false`
  first, then level + color while off), check again at +10 s and fix stragglers (the probe saw
  late reports). A light whose mood was a living mood gets its mood reapplied.
- **Stream dropped** (Wi-Fi lost, phone killed): the bridge ends it in ~9 s and the lights stay
  on the last frame. The snapshot is kept in `huelab_fast` until a put-back succeeds; the next
  service start, app start or live sync reconnection puts the lights back if nobody changed them
  since (same ±5 rule as path auto-off).
- **Someone else streams** (`active_streamer` isn't Glim's key: the TV's Ambilight, Hue Sync):
  Glim never takes the stream. The control shows "Your TV is using the lights" and Start is off.
  If the area turns `inactive` under Glim (another streamer took over), Glim ends quietly without
  putting lights back (they belong to the other streamer now).

## 3. Map → entertainment area

Glim makes and keeps **one area of its own**, "Glim listening room" (`configuration_type:
music`), created at the first Start and updated behind the scenes. The user never sees Hue's
area editor. Other areas (the Hue app's, the TV's) are never changed.

- **Which lights**: lights with an `entertainment` renderer service, placed on the map, in the
  chosen rooms (whole home by default). Never plugs, never white-only lights (not renderers),
  never unplaced lights (they'd have no position). Unreachable lights stay in (they rejoin
  silently).
- **Channel limit**: HueStream v2 carries up to 20 channels; a gradient light takes one per
  segment (up to 7). Over 20: keep an even spread (farthest-point sampling from the speaker) and
  say "16 of 24 lights take part" on the sheet. This home: 7 channels.
- **Positions** (for Hue's records and other apps; Glim's own effects use map meters):
  normalize the whole map's bounds into −1..1 keeping its aspect (the probe's numbers: Salon
  pendant at x 0.34, Salle de bain at −0.82). +y ("front") points from the plan's center toward
  the speaker. Height by light type: pendant, ceiling, spot 0.8; bulb 0.5; lantern 0.3; table,
  Go, candle −0.2; floor lamp 0.2; light bar, strip −0.6; string 0.
- **When it's updated**: a hash of (lights, positions rounded to 5 cm, speaker) is stored with
  the area id. Start compares it; if different, `PUT locations` before `start` (~0.6 s, shown as
  "Setting up your listening room…" only the first time). Deleted with "Forget listening room" in
  Settings and on Disconnect bridge.
- **Speaker**: a point on the map (and its room). Placed on the Listening room sheet's map (tap,
  then drag); shown on the Map tab while playing and in the 2D editor as a small marker you can
  drag. Default: the center of the room with the most included lights. AR: an optional last step
  of a scan, "Where does the music come from?" (aim at the speaker, tap), later.

## 4. Audio

| | **Room microphone** (recommended default) | **This phone's sound** |
|---|---|---|
| API | `AudioRecord`, source `UNPROCESSED` (or `VOICE_RECOGNITION`: no AGC) | `AudioPlaybackCaptureConfiguration` (Android 10+), usages MEDIA, GAME, UNKNOWN |
| Catches | Everything in the room: the speaker, Spotify Connect, Cast, TV, vinyl, a guitar | Only audio this phone plays itself |
| Consent | Microphone permission once ("Glim listens to the room's music to light it; nothing is recorded or sent") | MediaProjection dialog **every session**, foreground service type `mediaProjection` |
| Fails when | Very quiet music far from the phone; talking near the phone | Music cast to a speaker (the phone plays nothing), apps that opt out (`allowAudioPlaybackCapture=false`), calls |
| Latency | + sound travel (~3 ms per meter) | none |

The mic catches the maintainer's real setups (speaker, TV, vinyl) and needs no dialog each time,
so it is the default; "This phone's sound" is a second choice for headphones-free phone playback.
Audio never leaves the phone, nothing is stored.

**Analysis** (Kotlin, in the service): 48 kHz mono, 1024-point FFT (Hann), hop 512 (10.7 ms).
Per hop: band energies (bass 20–150 Hz, mids 150–2 kHz, highs 2–8 kHz), RMS loudness, spectral
flux. Onsets: flux above a moving median (1 s) × k + floor, 120 ms refractory. Tempo:
autocorrelation of the onset envelope over 6 s, 70–180 BPM, locked when stable for 4 beats.
Own radix-2 FFT (≈60 lines): no library.

**Latency budget** (sound → light):

| Step | Typical |
|---|---|
| Sound to phone (3 m) | 9 ms |
| `AudioRecord` buffer | 10–20 ms |
| Hop + onset decision | 11–22 ms |
| Wait for the next frame (50 Hz) | 0–20 ms |
| Wi-Fi UDP to bridge | 5–15 ms |
| Bridge → Zigbee → bulb (≈25 Hz to the lights) | 40–60 ms |
| **Total** | **≈ 80–150 ms** |

Hue's own sync aims at < 100 ms. With slow attacks and Breathe as default, 150 ms reads as "with
the music". Pulse and Ripple lead by the measured latency once the tempo locks.

## 5. Streaming (Android)

- **DTLS**: Android's `SSLEngine` has no DTLS. Use **BouncyCastle** (`org.bouncycastle:bctls-jdk18on`
  + `bcprov-jdk18on`): `DTLSClientProtocol` with a `PSKTlsClient` limited to
  `TLS_PSK_WITH_AES_128_GCM_SHA256`, over a `DatagramSocket` (`UDPTransport`). Pure Java, the
  usual choice of Hue entertainment libraries on the JVM; R8 shrinks it (keep rules for the
  crypto providers it loads by reflection). Alternative: mbedTLS through JNI (smaller, NDK build,
  more work). Not tried on Android yet: first build step.
- **Frames**: HueStream v2, color space **xy + brightness** (`0x01`), since Glim's colors are xy
  within gamut C already. Full state every frame, sequence byte incremented, sent at **50 Hz**
  (the bridge forwards ~25 Hz; sending faster covers lost UDP packets). ≈ 9 KB/s.
- **Service**: a new foreground service in `modules/hue-http` (`ListeningService`), type
  `microphone` (+ `mediaProjection` for phone sound), notification "Listening room · Salon,
  Chambre · Ripple" with Stop. Runs with the screen off (music plays with the screen off):
  partial wake lock + `WIFI_MODE_FULL_LOW_LATENCY` Wi-Fi lock. Native owns everything while it
  runs (audio, engine, stream, put-back); JS hands it a plan and listens to events.
- **Home Wi-Fi only**: no cloud route for streaming. Away (transport on the cloud, or the bridge
  doesn't answer locally): the control says "Only at home, on the home Wi-Fi".
- **Keys**: the client key is a secret like the app key: `BridgeConfig.clientKey` in
  SecureStore and in `huelab_fast` for the service.
- **Live sync** keeps running; its event stream reports the area's status, so the app sees a
  takeover or a timeout at once.

## 6. Screens

- **Listening room sheet** (`src/app/listening.tsx`): the map of the included rooms with the
  speaker marker (drag) and a live preview of the mode on the glows; mode cards (Breathe, Pulse,
  Ripple, each with a tiny moving preview); palette row (Your lights as they are, moods, Album
  colors); rooms (whole home / pick); Calm / Balanced / Lively; brightness ceiling; sound
  (Room microphone / This phone's sound); Start. While playing the button becomes Stop and a thin
  champagne level line moves under the title.
- **Map tab while playing**: the glows follow the engine (native sends the per-light state at
  ~15 fps to the app), the speaker sits on the plan as a small ring with two arcs, Ripple's rings
  are drawn expanding from it along the walk, clipped to rooms. The headline says "The house is
  listening". A pill at the bottom: "♪ Ripple · Stop".
- **Entry points**: a "Listen" chip on the Map tab (top right, next to the weather pill), a card
  in the Moods tab's "On your map" section, a Moods widget button and a Quick Settings tile kind
  (`listen`), both toggling with the last settings. Widget and tile starts need the microphone
  service to start from the background: see open questions.
- **Icon**: a dot (the speaker) with two concentric arcs, drawn in the night-path style
  (hairline, glowing dot).
- **Settings → Your home → Listening room**: speaker, sound source, Forget listening room (deletes
  the area on the bridge).

## 7. Data model

```ts
// src/lib/listening/settings.ts, stored per bridge: `listening:<bridgeId>`
type ListeningSettings = {
  mode: 'breathe' | 'pulse' | 'ripple';
  palette: { kind: 'current' } | { kind: 'mood'; moodId: string } | { kind: 'album' };
  intensity: 'calm' | 'balanced' | 'lively';
  ceiling: number;              // max brightness, 0..100
  roomIds: string[] | null;     // map room ids; null = whole home
  speaker: FloorPoint & { roomId: string | null };  // map coordinates (meters)
  rippleThroughWalls?: boolean; // default false: walk through doorways
  source: 'mic' | 'phone';
  area?: { id: string; hash: string };  // Glim's entertainment_configuration
};

// handed to the native service at start (JSON)
type ListeningPlan = {
  areaId: string;
  channels: {
    channel: number; lightId: string;
    x: number; z: number; height: number;  // map meters, height -1..1
    walk: number;                          // meters from the speaker through doorways
    side: 0 | 1;                           // Pulse's call-and-answer set
  }[];
  palette: { x: number; y: number }[];     // xy, gamut C
  mode: ListeningSettings['mode']; intensity: ListeningSettings['intensity']; ceiling: number;
  snapshot: { lightId: string; on: boolean; bri: number; xy?: { x: number; y: number }; mirek?: number; moodId?: string }[];
};
```

`BridgeConfig` gains `clientKey?: string`.

## 8. Architecture and code layout

- `src/lib/hue/bridge.ts`: keep `success.clientkey` at pairing. Existing pairings have none:
  the first Start asks once, "Press the button on your bridge to let Glim stream" (one new
  pairing, new app key + client key, same bridge, saved over the old config).
- `src/lib/hue/entertainment.ts`: read areas, `ensureListeningArea(plan)` (create / update /
  delete), start, stop, `activeStreamer()`.
- `src/lib/listening/`: `settings.ts`, `plan.ts` (map → channels, walk distances via `route.ts`,
  heights by `lightType`, Hue positions, hash), `useListening.ts` (state from native events).
- `modules/hue-http/.../listening/`: `ListeningService.kt` (FGS, locks, notification, lifecycle),
  `Audio.kt` (AudioRecord / playback capture, FFT, features, onsets, tempo), `Engine.kt` (modes →
  per-channel xy + brightness, limits), `HueStream.kt` (BouncyCastle DTLS, frame encoder,
  reconnect), `PutBack.kt` (end crossfade, REST rewrite, recheck, pending put-back in
  `huelab_fast`).
- `src/app/listening.tsx`, `src/ui/ListeningOverlay.tsx` (Map tab rings and speaker), a Moods
  widget button kind and a tile kind.

## 9. Limits

- Home Wi-Fi only. One stream per bridge: while the TV's Ambilight+Hue streams, no Listening room
  (and the other way round).
- Lights that are streaming ignore REST commands: widgets, the tile, moods and rituals can't
  change them meanwhile. Glim's own taps on an included room end the session first.
- Bridge rituals (sleep fade, sunrise, day rhythm) firing during a session: the lights are
  streaming, so they probably do nothing. To test; Glim could end the session at a sleep fade's
  start time.
- Mic quality varies by phone placement; talking near the phone makes Pulse twitch (Breathe
  hides it).
- Battery: mic + FFT + 50 Hz UDP with the screen off: estimated a few % per hour; to measure.

## 10. Open questions

1. Can a widget tap or the Quick Settings tile start a `microphone` foreground service on
   Android 15/16 (while-in-use permission restrictions)? If not, they open the sheet and start
   from there.
2. Does Spotify allow playback capture? (Matters only for "This phone's sound".)
3. What does the TV do when it starts Ambilight+Hue while Glim streams: refused, or takes over?
   (Shared with the Ambilight TV design.)
4. Do bridge behaviors run on streaming lights?
5. Hue's area channel limit with gradient lights, and whether a light can be in two areas
   streaming at different times (it can be listed in several; only one streams).

## 11. Build steps

1. Keep the client key at pairing; "press the button once" flow for existing pairings.
2. `HueStream.kt` with BouncyCastle: handshake + a test pattern from a hidden debug button
   (the probe's wave, on device). Measure handshake time and frame loss.
3. `ensureListeningArea` from the map (create, update by hash, forget) + start/stop + put-back,
   tested with the probe's sequence (lights on and off before, clean stop, killed stream).
4. `Audio.kt` with the mic: features, onsets, tempo; a debug readout of BPM and levels.
5. `Engine.kt`: Breathe, then Pulse, then Ripple (walk distances), with the limits.
6. `ListeningService` (screen off, notification, locks, drop recovery).
7. Listening room sheet, Map tab overlay (rings, speaker, glows from engine events).
8. Moods tab card, Map tab chip, Moods widget button, tile kind; Settings section.
9. "This phone's sound" (playback capture), Album colors palette once that feature lands.
10. AR "Where does the music come from?" step.
